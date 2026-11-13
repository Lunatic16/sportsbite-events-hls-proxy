/**
 * SportsBite schedule API client.
 *
 * Upstream: https://sportsbite.org/api/schedule (no key, CORS enabled)
 * Docs:      https://sportsbite.org/api
 *
 * The API allows 60 requests/minute per IP and recommends server-side caching
 * with 60s polling + ETag conditional requests. This client implements:
 *   - a shared in-memory cache with a 60s TTL (all visitors share it)
 *   - ETag / If-None-Match conditional revalidation (304 keeps cached body)
 *   - stale-on-error fallback for 429 / 503 responses
 */

export const SCHEDULE_UPSTREAM = "https://sportsbite.org/api/schedule";

export interface SBTeam {
  name: string;
  logo: string | null;
}

export interface SBTournament {
  name: string;
  logo: string | null;
}

export interface SBStream {
  /** Opaque server id, e.g. "s-d9c58f36c05b501f8cc2" */
  id: string;
  name: string;
  embed_url: string;
  quality?: string | null;
  language?: string | null;
}

export interface SBEvent {
  id: string;
  slug: string;
  title: string;
  sport: string;
  tournament: SBTournament;
  starts_at: string;
  timestamp: number;
  date: string;
  kickoff_time: string;
  status: "upcoming" | "live";
  teams: { home: SBTeam; away: SBTeam };
  embed_url: string | null;
  watch_url: string;
  streams: SBStream[];
}

export interface SBPagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface SBScheduleResponse {
  version: string;
  timezone: string;
  pagination: SBPagination;
  events: SBEvent[];
}

export interface ScheduleQuery {
  sport?: string;
  date?: string;
  status?: "all" | "live" | "upcoming";
  page?: number;
  limit?: number;
}

export interface CachedSchedule {
  body: SBScheduleResponse;
  etag: string | null;
  fetchedAt: number;
  fromCache: boolean;
}

// Overridable via env (used by docker-compose): SCHEDULE_CACHE_TTL_MS.
const parsedTtl = Number(process.env.SCHEDULE_CACHE_TTL_MS);
const CACHE_TTL_MS =
  Number.isFinite(parsedTtl) && parsedTtl >= 5_000 && parsedTtl <= 600_000
    ? Math.trunc(parsedTtl)
    : 60_000;
const STALE_MAX_MS = 15 * 60_000;
const REQUEST_TIMEOUT_MS = 12_000;

const cache = new Map<string, CachedSchedule>();

export function buildQueryString(query: ScheduleQuery): string {
  const sp = new URLSearchParams();
  if (query.sport) sp.set("sport", query.sport);
  if (query.date) sp.set("date", query.date);
  if (query.status && query.status !== "all") sp.set("status", query.status);
  if (query.page && query.page > 1) sp.set("page", String(query.page));
  if (query.limit && query.limit !== 50) sp.set("limit", String(query.limit));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function validQuery(q: ScheduleQuery): boolean {
  if (q.sport !== undefined && !/^[a-z0-9-]{1,40}$/.test(q.sport)) return false;
  if (q.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(q.date)) return false;
  if (q.status !== undefined && !["all", "live", "upcoming"].includes(q.status)) return false;
  if (q.page !== undefined && (!Number.isInteger(q.page) || q.page < 1 || q.page > 10000)) return false;
  if (q.limit !== undefined && (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 100)) return false;
  return true;
}

/**
 * Fetch the schedule with caching. Throws `ScheduleError` with a mapped
 * message when the upstream fails and no cached copy is available.
 */
export async function getSchedule(query: ScheduleQuery = {}): Promise<CachedSchedule> {
  if (!validQuery(query)) {
    throw new ScheduleError(400, "Invalid schedule query parameters");
  }
  const key = buildQueryString(query) || "(default)";
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) {
    return { ...hit, fromCache: true };
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "SportsRelay/1.0 (+https://github.com/sportsrelay)",
  };
  if (hit?.etag) headers["If-None-Match"] = hit.etag;

  try {
    const res = await fetch(`${SCHEDULE_UPSTREAM}${key === "(default)" ? "" : key}`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    if (res.status === 304 && hit) {
      const refreshed: CachedSchedule = { ...hit, fetchedAt: now, fromCache: false };
      cache.set(key, refreshed);
      return refreshed;
    }

    if (res.status === 429) {
      if (hit && now - hit.fetchedAt < STALE_MAX_MS) return { ...hit, fromCache: true };
      throw new ScheduleError(429, "Upstream rate limit reached — try again shortly.");
    }

    if (res.status === 503) {
      if (hit && now - hit.fetchedAt < STALE_MAX_MS) return { ...hit, fromCache: true };
      throw new ScheduleError(503, "Schedule temporarily unavailable upstream.");
    }

    if (!res.ok) {
      throw new ScheduleError(res.status, `Upstream schedule request failed (${res.status}).`);
    }

    const body = (await res.json()) as SBScheduleResponse;
    const entry: CachedSchedule = {
      body,
      etag: res.headers.get("etag"),
      fetchedAt: now,
      fromCache: false,
    };
    cache.set(key, entry);
    return entry;
  } catch (err) {
    if (err instanceof ScheduleError) throw err;
    // Network/timeout failure — serve stale if we have it.
    if (hit && now - hit.fetchedAt < STALE_MAX_MS) return { ...hit, fromCache: true };
    throw new ScheduleError(502, "Could not reach the SportsBite schedule upstream.");
  }
}

export class ScheduleError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ScheduleError";
  }
}
