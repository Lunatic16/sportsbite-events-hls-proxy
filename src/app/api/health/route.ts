import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health
 *
 * Liveness/readiness probe for Docker HEALTHCHECK, Kubernetes and uptime
 * monitors. Deliberately does NOT contact upstream APIs so container
 * health never flaps when sportsbite.org has a transient blip.
 * Append ?deep=1 to additionally ping the schedule upstream.
 */
export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get("deep") === "1";

  const body: Record<string, unknown> = {
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    runtime: process.env.NODE_ENV ?? "development",
  };

  if (deep) {
    try {
      const res = await fetch("https://sportsbite.org/api/schedule?limit=1", {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
      body.upstream = { schedule: res.ok ? "reachable" : `http_${res.status}` };
    } catch (err) {
      body.upstream = {
        schedule: "unreachable",
        detail: err instanceof Error ? err.message : "unknown error",
      };
    }
  }

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
