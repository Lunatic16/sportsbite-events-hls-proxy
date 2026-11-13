/**
 * Copy text to the clipboard with graceful degradation.
 *
 * `navigator.clipboard` only exists in secure contexts (HTTPS or localhost).
 * SportsRelay is frequently served over plain HTTP — e.g. `http://192.168.1.10:3000`
 * on a LAN or `http://relay.local:3000` on a home server — where the async
 * Clipboard API is undefined and `navigator.clipboard.writeText` throws.
 *
 * Strategy:
 *   1. Modern async Clipboard API (HTTPS / localhost).
 *   2. Hidden textarea + `document.execCommand("copy")` legacy fallback,
 *      which still works in every current browser as long as the call runs
 *      inside a user gesture (all call sites are click handlers).
 *
 * Returns `true` when the text was copied. When every strategy fails the
 * caller should surface the text for manual copying (e.g. open the URL).
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  // 1) Modern async Clipboard API — secure contexts only.
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or write failure — fall through to the legacy path.
    }
  }

  // 2) Legacy fallback for plain-HTTP origins.
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
