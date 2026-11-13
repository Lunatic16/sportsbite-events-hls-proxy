import { NextRequest } from "next/server";
import { decodeUpstream, proxyHlsResource } from "@/lib/hls-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/hls?u=<base64url of upstream https url>
 *
 * Universal HLS relay: playlists are rewritten so every nested URI
 * (variants, segments, keys, maps) also resolves through this route.
 * Segment traffic is streamed straight through from the signed CDN.
 */
export async function GET(request: NextRequest) {
  const upstream = decodeUpstream(request.nextUrl.searchParams.get("u"));
  if (!upstream) {
    return Response.json({ error: "Missing or malformed u parameter" }, { status: 400 });
  }
  return proxyHlsResource(request, upstream);
}
