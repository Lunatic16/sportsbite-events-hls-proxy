/**
 * Asset proxy helpers — artwork (team crests / tournament logos) is relayed
 * through /api/img so every client request stays same-origin.
 *
 * Encoding is browser-safe (TextEncoder + btoa) because this module is
 * imported by client components; no Node polyfills are assumed.
 */

const ALLOWED_SUFFIX = "sportsbite.org";

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64u: string): string {
  const padded = b64u.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return h === ALLOWED_SUFFIX || h.endsWith(`.${ALLOWED_SUFFIX}`);
}

export function decodeAssetUrl(raw: string): URL | null {
  try {
    const url = new URL(fromBase64Url(raw));
    if (url.protocol !== "https:" || !hostAllowed(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

/** Rewrite a SportsBite artwork URL into a same-origin relay URL. */
export function proxyAsset(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || !hostAllowed(u.hostname)) return null;
    return `/api/img?u=${toBase64Url(url)}`;
  } catch {
    return null;
  }
}
