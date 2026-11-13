/**
 * HLS relay engine for SportsBite streams.
 *
 * Upstream chain (discovered from the public embed player):
 *   1. master playlist   https://embed.sportsbite.org/selfhost/play/{streamId}?raw=1
 *      -> single variant  /selfhost/cdn/{streamId}.m3u8?raw=1
 *   2. media playlist    https://embed.sportsbite.org/selfhost/cdn/{streamId}.m3u8?raw=1
 *      -> segment lines   /selfhost/hls/{streamId}/{hash}_main_segNNNN.ts#r2=<signed-cdn-url>&sh=<sha>&origin=<path>
 *   3. segments          the plain origin path 404s in practice; the signed
 *                        `r2` CDN URL inside the URI fragment is the real host.
 *
 * This module therefore:
 *   - proxies playlists and rewrites every URI (lines + URI="" attributes)
 *     so all client traffic flows through /api/hls?u=<base64url>
 *   - decodes the #r2= fragment server-side and fetches segments from the
 *     signed CDN, falling back to the origin path
 *   - enforces an HTTPS + hostname allowlist (static domains + hosts learned
 *     from previously proxied playlists) so it never becomes an open proxy
 */

export const EMBED_ORIGIN = "https://embed.sportsbite.org";
export const PLAYLIST_CT = "application/vnd.apple.mpegurl";

const STATIC_ALLOWED_SUFFIXES = ["sportsbite.org", "cr7goated.site"];
const UPSTREAM_TIMEOUT_MS = 15_000;
const SEGMENT_TIMEOUT_MS = 60_000;
const REFERER = "https://embed.sportsbite.org/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Hosts observed inside r2= fragments of playlists we proxied in this process. */
const learnedHosts = new Set<string>();

// Optional ops override, e.g. HLS_EXTRA_ALLOWED_HOSTS="cdn-a.example,cdn-b.example"
const envHosts = (process.env.HLS_EXTRA_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function suffixMatch(host: string): boolean {
  const h = host.toLowerCase();
  return STATIC_ALLOWED_SUFFIXES.some((d) => h === d || h.endsWith(`.${d}`));
}

function isAllowedBaseHost(hostname: string): boolean {
  return suffixMatch(hostname) || envHosts.includes(hostname.toLowerCase());
}

function isAllowedFallbackHost(hostname: string): boolean {
  return (
    suffixMatch(hostname) ||
    envHosts.includes(hostname.toLowerCase()) ||
    learnedHosts.has(hostname.toLowerCase())
  );
}

export function isPlaylistUrl(url: URL): boolean {
  return url.pathname.toLowerCase().endsWith(".m3u8");
}

/* ------------------------------- codec ---------------------------------- */

export function encodeUpstream(url: string): string {
  return `/api/hls?u=${Buffer.from(url, "utf8").toString("base64url")}`;
}

export function decodeUpstream(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const url = new URL(decoded);
    if (url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/* ---------------------------- playlist rewrite --------------------------- */

function rewriteUri(uri: string, base: URL): string {
  try {
    const abs = new URL(uri, base);
    if (abs.protocol !== "https:") return uri;
    if (!isAllowedBaseHost(abs.hostname)) return uri;
    return encodeUpstream(abs.href);
  } catch {
    return uri;
  }
}

/** Rewrite every URI in an m3u8 playlist so it points back at this proxy. */
export function rewritePlaylist(text: string, upstreamUrl: URL): string {
  const base = upstreamUrl;
  // Learn r2 CDN hosts from segment fragments so later segment fetches pass validation.
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const hashIdx = trimmed.indexOf("#");
    if (hashIdx >= 0) {
      for (const m of trimmed.slice(hashIdx + 1).matchAll(/(?:^|&)r2=([^&]+)/g)) {
        try {
          const u = new URL(decodeURIComponent(m[1]));
          if (u.protocol === "https:") learnedHosts.add(u.hostname.toLowerCase());
        } catch {
          /* ignore malformed fragment */
        }
      }
    }
  }

  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        // EXT-X-KEY / EXT-X-MAP / EXT-X-MEDIA / EXT-X-I-FRAME-STREAM-INF carry URI="…"
        return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="${rewriteUri(uri, base)}"`);
      }
      return rewriteUri(trimmed, base);
    })
    .join("\n");
}

/* ------------------------------ upstream fetch --------------------------- */

interface SegmentMeta {
  r2: string | null;
  origin: string | null;
}

function parseFragmentMeta(url: URL): SegmentMeta {
  const meta: SegmentMeta = { r2: null, origin: null };
  if (!url.hash) return meta;
  const frag = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  for (const part of frag.split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq);
    const v = decodeURIComponent(part.slice(eq + 1));
    if (k === "r2") meta.r2 = v;
    if (k === "origin") meta.origin = v;
  }
  return meta;
}

function upstreamHeaders(range?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": UA,
    Referer: REFERER,
    Origin: EMBED_ORIGIN,
    Accept: "*/*",
  };
  if (range) h.Range = range;
  return h;
}

async function rawFetch(url: string, range?: string | null, timeoutMs = UPSTREAM_TIMEOUT_MS): Promise<Response> {
  return fetch(url, {
    headers: upstreamHeaders(range),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
    redirect: "follow",
  });
}

/**
 * Fetch an upstream resource. For segments the signed r2 CDN URL is tried
 * first (the plain origin path 404s), falling back to the origin path.
 */
async function fetchUpstream(
  url: URL,
  range: string | null,
): Promise<{ res: Response; via: string }> {
  const timeoutMs = isPlaylistUrl(url) ? UPSTREAM_TIMEOUT_MS : SEGMENT_TIMEOUT_MS;
  if (!isPlaylistUrl(url)) {
    const meta = parseFragmentMeta(url);
    if (meta.r2) {
      try {
        const r2Url = new URL(meta.r2);
        if (r2Url.protocol === "https:" && isAllowedFallbackHost(r2Url.hostname)) {
          const res = await rawFetch(r2Url.href, range, timeoutMs);
          if (res.ok) return { res, via: `cdn:${r2Url.hostname}` };
          // fall through to origin path
        }
      } catch {
        /* malformed r2 — ignore */
      }
    }
    if (meta.origin) {
      try {
        const o = new URL(meta.origin, EMBED_ORIGIN);
        if (isAllowedBaseHost(o.hostname)) {
          const res = await rawFetch(o.href, range, timeoutMs);
          if (res.ok) return { res, via: "origin" };
        }
      } catch {
        /* ignore */
      }
    }
  }
  const res = await rawFetch(url.href, range, timeoutMs);
  return { res, via: "direct" };
}

/* ------------------------------ proxy core ------------------------------- */

const PASS_THROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

export async function proxyHlsResource(request: Request, upstream: URL): Promise<Response> {
  // SSRF guard: the primary host must always be in the static allowlist.
  if (!isAllowedBaseHost(upstream.hostname)) {
    return Response.json({ error: "Host not allowed" }, { status: 403 });
  }

  const range = request.headers.get("range");
  let res: Response;
  let via: string;
  try {
    ({ res, via } = await fetchUpstream(upstream, range));
  } catch {
    return Response.json({ error: "Upstream fetch failed" }, { status: 504 });
  }

  if (!res.ok || !res.body) {
    const status = res.status === 404 || res.status === 425 ? res.status : 502;
    return Response.json(
      {
        error:
          status === 404
            ? "Stream resource not found upstream (may have ended or not started yet)."
            : status === 425
              ? "Kickoff is more than 30 minutes away — the stream window is not open yet."
              : `Upstream returned ${res.status}.`,
        upstream: res.status,
      },
      { status },
    );
  }

  const ct = res.headers.get("content-type") ?? "";
  const looksLikePlaylist =
    isPlaylistUrl(upstream) || ct.includes("mpegurl") || ct.includes("application/x-mpegurl");

  if (looksLikePlaylist) {
    const text = await res.text();
    const rewritten = rewritePlaylist(text, upstream);
    return new Response(rewritten, {
      status: 200,
      headers: {
        "Content-Type": PLAYLIST_CT,
        "Cache-Control": "no-store",
        "X-Relay-Upstream": via,
      },
    });
  }

  // Binary passthrough (TS / fMP4 segments, keys, init maps) — stream it.
  const headers = new Headers();
  for (const name of PASS_THROUGH_HEADERS) {
    const v = res.headers.get(name);
    if (v) headers.set(name, v);
  }
  headers.set("Cache-Control", res.status === 200 ? "public, max-age=86400, immutable" : "no-store");
  headers.set("X-Relay-Upstream", via);
  return new Response(res.body, { status: res.status, headers });
}

/* ----------------------------- master entry ------------------------------ */

const STREAM_ID_RE = /^s-[a-z0-9]{4,32}$/i;

export function buildMasterUpstream(streamId: string): URL | null {
  if (!STREAM_ID_RE.test(streamId)) return null;
  return new URL(`${EMBED_ORIGIN}/selfhost/play/${encodeURIComponent(streamId)}?raw=1`);
}
