/**
 * Dynamic M3U playlist generation for IPTV players (TiviMate, IPTV Smarters,
 * VLC, Kodi, Jellyfin, Emby, …).
 *
 * GET /playlist.m3u8 renders every schedulable SportsBite event as a channel
 * whose channel URL points back at the relay (/api/hls/play/{streamId}), so
 * any IPTV player can watch through the proxy without touching upstream
 * hosts. The playlist is regenerated on every request; the schedule data
 * itself comes from the shared 60s cache, so refreshes are cheap.
 */

import { NextRequest } from "next/server";
import { getSchedule, type SBEvent } from "@/lib/sportsbite";
import { proxyAsset } from "@/lib/asset-proxy";

export type PlaylistStatus = "all" | "live" | "upcoming";

export interface PlaylistQuery {
  sport?: string;
  date?: string;
  /** Which events become channels. Default "all" (live first, then upcoming). */
  status: PlaylistStatus;
  /** Maximum number of events to include (each spans one upstream page fetch). */
  maxEvents: number;
  /** "first" = one channel per event; "all" = one channel per stream server. */
  servers: "first" | "all";
}

const DEFAULT_MAX_EVENTS = 300;
const PAGE_LIMIT = 100; // upstream max page size
const MAX_PAGES = 10; // hard cap on upstream requests per playlist build
/** Kickoffs with status "upcoming" are kept for this long after their start time. */
const START_GRACE_MS = 20 * 60_000;

const KICKOFF_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function parsePlaylistQuery(request: NextRequest): PlaylistQuery {
  const sp = request.nextUrl.searchParams;

  const status = ["all", "live", "upcoming"].includes(sp.get("status") ?? "")
    ? (sp.get("status") as PlaylistStatus)
    : "all";

  const parsedLimit = Number(sp.get("limit"));
  const maxEvents =
    Number.isFinite(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 1000
      ? Math.trunc(parsedLimit)
      : DEFAULT_MAX_EVENTS;

  return {
    sport: sp.get("sport") ?? undefined,
    date: sp.get("date") ?? undefined,
    status,
    maxEvents,
    servers: sp.get("servers") === "all" ? "all" : "first",
  };
}

/**
 * Absolute base URL for links written into the playlist. IPTV players live
 * outside the browser, so entries must be absolute. Resolution order:
 *   PLAYLIST_BASE_URL env  >  x-forwarded-host/proto  >  request host
 */
export function resolveBaseUrl(request: NextRequest): string {
  const env = process.env.PLAYLIST_BASE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");

  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host") ||
    request.nextUrl.host;

  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host) ? "http" : "https");

  return `${proto}://${host}`;
}

function absoluteUrl(base: string, path: string): string {
  return `${base}${path}`;
}

function tsToMs(timestamp: number): number {
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

/**
 * Collect events across enough upstream pages to satisfy maxEvents.
 * Every page goes through the shared cache — for page 1 this is usually the
 * exact same cache entry the dashboard uses, costing zero upstream calls.
 */
export async function collectPlaylistEvents(
  query: PlaylistQuery,
): Promise<{ events: SBEvent[]; total: number; fetched: number }> {
  const events: SBEvent[] = [];
  let total = 0;
  let upstreamPages = 1;
  const maxPages = Math.min(Math.ceil(query.maxEvents / PAGE_LIMIT), MAX_PAGES);

  for (let page = 1; page <= Math.min(upstreamPages, maxPages); page += 1) {
    const res = await getSchedule({
      sport: query.sport,
      date: query.date,
      status: query.status,
      page,
      limit: PAGE_LIMIT,
    });
    total = res.body.pagination?.total ?? total;
    upstreamPages = res.body.pagination?.pages ?? upstreamPages;
    events.push(...res.body.events);
  }

  return { events, total, fetched: events.length };
}

function sanitizeText(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/"/g, "").trim();
}

/** "american-football" -> "American Football" (same style as the dashboard). */
function sportLabel(sport: string): string {
  return sport
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** "15 Nov, 14:30" — kickoff time in UTC for upcoming channels. */
function formatKickoffUtc(timestamp: number): string {
  return KICKOFF_FMT.format(new Date(timestamp)).replace(",", "");
}

function streamSuffix(stream: SBEvent["streams"][number]): string {
  return [stream.name, stream.quality, stream.language]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(" · ");
}

export interface PlaylistOptions {
  baseUrl: string;
  servers: "first" | "all";
  /** Hard cap on channels' source events after filtering + sorting. */
  maxEvents?: number;
}

/**
 * Build the M3U document. Lines use CRLF per the extended-M3U convention for
 * maximum player compatibility. Live events sort first, then upcoming by
 * kickoff time; events whose kickoff passed without going live are dropped
 * (finished fixtures should not become dead channels).
 */
export function buildM3U(events: SBEvent[], opts: PlaylistOptions): string {
  const now = Date.now();

  const entries = events
    .filter((e) => {
      // Live always stays; anything else must not have blown past its kickoff
      // window (finished fixtures would only become dead channels).
      if (e.streams.length === 0) return false;
      if (e.status === "live") return true;
      return tsToMs(e.timestamp) >= now - START_GRACE_MS;
    })
    .sort((a, b) => {
      const rank = (e: SBEvent) => (e.status === "live" ? 0 : 1);
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      return tsToMs(a.timestamp) - tsToMs(b.timestamp);
    })
    .slice(0, opts.maxEvents && opts.maxEvents > 0 ? opts.maxEvents : undefined)
    .flatMap((event) => {
      const streams = opts.servers === "all" ? event.streams : event.streams.slice(0, 1);
      return streams.map((stream) => {
        const baseTitle =
          sanitizeText(event.title) ||
          sanitizeText(`${event.teams?.home?.name ?? "TBD"} vs ${event.teams?.away?.name ?? "TBD"}`) ||
          sanitizeText(event.slug);
        const kickoff =
          event.status === "live" ? "" : ` (${formatKickoffUtc(tsToMs(event.timestamp))} UTC)`;
        const liveMark = event.status === "live" ? "[LIVE] " : "";
        const suffix = opts.servers === "all" ? ` · ${streamSuffix(stream)}` : "";
        const name = sanitizeText(`${liveMark}${baseTitle}${kickoff}${suffix}`);

        const logoRel = proxyAsset(
          event.tournament?.logo || event.teams?.home?.logo || event.teams?.away?.logo,
        );

        return {
          name,
          group: sanitizeText(sportLabel(event.sport) || "Sports"),
          tvgId: sanitizeText(stream.id),
          tvgName: sanitizeText(baseTitle),
          logo: logoRel ? absoluteUrl(opts.baseUrl, logoRel) : null,
          url: absoluteUrl(opts.baseUrl, `/api/hls/play/${stream.id}`),
        };
      });
    });

  const lines: string[] = [
    "#EXTM3U",
    `# SportsRelay IPTV playlist — regenerated every request. Channels relay through this server.`,
  ];

  for (const entry of entries) {
    const attrs = [
      `tvg-id="${entry.tvgId}"`,
      `tvg-name="${entry.tvgName}"`,
      entry.logo ? `tvg-logo="${entry.logo}"` : null,
      `group-title="${entry.group}"`,
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(`#EXTINF:-1 ${attrs},${entry.name}`);
    lines.push(entry.url);
  }

  return lines.join("\r\n") + "\r\n";
}
