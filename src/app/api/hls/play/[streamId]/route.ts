import { NextRequest } from "next/server";
import { buildMasterUpstream, proxyHlsResource } from "@/lib/hls-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/hls/play/{streamId}
 *
 * Entry point for players. Resolves a SportsBite stream server id
 * (e.g. "s-d9c58f36c05b501f8cc2") to the upstream master playlist and
 * serves it fully rewritten — hand this single URL to hls.js / Safari.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ streamId: string }> },
) {
  const { streamId } = await ctx.params;
  const upstream = buildMasterUpstream(streamId);
  if (!upstream) {
    return Response.json({ error: "Invalid stream id format" }, { status: 400 });
  }
  return proxyHlsResource(request, upstream);
}
