/** A bare Web Store extension id: lowercase, anchored, nothing else on the
 *  line. Uppercase is not a real id (Chrome never mints one), so it is not
 *  accepted here even though it would otherwise shape-match (review). */
const EXT_ID = /^[a-p]{32}$/;

/** Whitespace JS `String.trim()` does not remove (U+0085, NEL) or normalizes
 *  differently (U+00A0, NBSP), while the backend's Rust `trim()` strips both
 *  — removed here first so a link that looks refused cannot slip past as
 *  something else once it reaches the backend (SEC-08). */
const OUTER_WHITESPACE = /^[\s\u0085 ]+|[\s\u0085 ]+$/g;

/** Trims a pasted link the same way on both sides of the wire: every
 *  Unicode whitespace character JS's own `trim()` does not touch, plus the
 *  ordinary ones it does (SEC-08). */
export function normalizeExtensionLink(raw: string): string {
  return raw.replace(OUTER_WHITESPACE, "");
}

/** Whether a normalized link may be downloaded at all: a bare (lowercase)
 *  Web Store id, or a URL whose parsed protocol is exactly `https:`. The
 *  link is parsed with `URL`, not pattern-matched as a string, so a link
 *  that merely starts with the right characters (or hides its real scheme
 *  behind whitespace `trim()` does not remove) cannot pass as https when it
 *  is not (SEC-08). Put in one place so every caller agrees with it. */
export function extensionLinkAllowed(link: string): boolean {
  if (EXT_ID.test(link)) return true;
  try {
    return new URL(link).protocol === "https:";
  } catch {
    return false;
  }
}

/** A `/detail/<id>` path, an optional slug before the id (the real store
 *  keeps the extension's name there; only the id after it is load-bearing). */
const DETAIL_PATH = new RegExp(`/detail/(?:[^/]+/)?${EXT_ID.source.slice(1, -1)}(?:$|[/?#])`);

/** True only for a link that really is a Chrome Web Store extension page, or
 *  a bare (lowercase) extension id. The link is parsed and normalized with
 *  `new URL()` first, so a look-alike host
 *  (`chromewebstore.google.com.evil.com`), a userinfo trick
 *  (`chromewebstore.google.com@evil.com`), or a path that only looks like it
 *  is under `/webstore/…` before `..` segments resolve it away, cannot pass
 *  as the real store the way a raw string-prefix match would (SEC-08). */
export function isStoreLink(link: string): boolean {
  if (EXT_ID.test(link)) return true;
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "chromewebstore.google.com") return DETAIL_PATH.test(u.pathname);
  if (host === "chrome.google.com") return u.pathname.startsWith("/webstore/") && DETAIL_PATH.test(u.pathname);
  return false;
}
