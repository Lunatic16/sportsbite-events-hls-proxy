import { NextRequest, NextResponse } from "next/server";
import { ScheduleError, getSchedule, type ScheduleQuery } from "@/lib/sportsbite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/schedule?sport=&date=&status=&page=&limit=
 *
 * Cached reverse proxy for https://sportsbite.org/api/schedule.
 * All visitors share one upstream request per 60s per query, so the public
 * 60 req/min rate limit is effectively never hit from the UI.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;

  const num = (k: string): number | undefined => {
    const v = sp.get(k);
    if (v === null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : NaN;
  };

  const query: ScheduleQuery = {
    sport: sp.get("sport") ?? undefined,
    date: sp.get("date") ?? undefined,
    status: (sp.get("status") as ScheduleQuery["status"]) ?? undefined,
    page: num("page"),
    limit: num("limit"),
  };

  try {
    const { body, fromCache, etag, fetchedAt } = await getSchedule(query);
    const res = NextResponse.json(body);
    res.headers.set("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.headers.set("X-Relay-Cache", fromCache ? "HIT" : "MISS");
    res.headers.set("X-Relay-Fetched-At", new Date(fetchedAt).toUTCString());
    if (etag) res.headers.set("X-Relay-ETag", etag);
    return res;
  } catch (err) {
    const status = err instanceof ScheduleError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected relay error.";
    return NextResponse.json({ error: message }, { status });
  }
}
