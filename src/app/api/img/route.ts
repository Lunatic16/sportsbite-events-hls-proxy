import { NextRequest } from "next/server";
import { decodeAssetUrl } from "@/lib/asset-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/img?u=<base64url of image url>
 *
 * Small asset relay for schedule artwork (team crests, tournament logos).
 * The public API serves images from sportsbite.org; proxying them keeps all
 * client traffic same-origin, adds an immutable cache layer, and works
 * behind networks that block third-party hosts.
 */

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("u");
  if (!raw) return Response.json({ error: "Missing u parameter" }, { status: 400 });

  const url = decodeAssetUrl(raw);
  if (!url) return Response.json({ error: "Malformed u parameter" }, { status: 400 });

  try {
    const res = await fetch(url.href, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://sportsbite.org/",
        Accept: "image/*",
      },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok || !res.body) {
      return Response.json({ error: `Upstream image ${res.status}` }, { status: 502 });
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/webp",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return Response.json({ error: "Upstream fetch failed" }, { status: 504 });
  }
}
