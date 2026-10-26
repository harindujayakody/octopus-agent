// Chrome's own bookmarks file (`Bookmarks` in a profile folder, no
// extension), read into the launcher's flat list. No imports: node --test runs it.

/** One bookmark from the file: its name and its address, as Chrome wrote them. */
export type ChromeMark = { title: string; url: string };

/** What the file holds: the bookmarks to bring in, in Chrome's order, and how many it had. */
export type ChromeFile = {
  /** Every bookmark with an address a profile opens, repeats included. */
  marks: ChromeMark[];
  /** Every bookmark in the file. */
  found: number;
  /** Bookmarklets, empty addresses and others that open no page. */
  skipped: number;
};

/** Chrome's roots, in the order its bookmark manager shows them. */
const ROOTS = ["bookmark_bar", "other", "synced"];

type Node = { type?: unknown; name?: unknown; url?: unknown; children?: unknown };
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);
const isFolder = (v: unknown): v is Node & { children: unknown[] } => isNode(v) && Array.isArray(v.children);

/** An address a profile can open: a scheme with "//" (https, chrome, file).
 *  A bookmarklet (javascript:), mailto: or data: is not one. */
const opensAPage = (url: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(url);

/** The file's bookmarks, folders flattened, or null when the text is not
 *  Chrome's bookmarks file ({"roots": {"bookmark_bar": …}, "version": 1}). */
export function readChromeBookmarks(text: string): ChromeFile | null {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!isNode(doc) || !isNode((doc as { roots?: unknown }).roots)) return null;
  const roots = (doc as { roots: Record<string, unknown> }).roots;
  // The known roots first, then any other folder a later Chrome adds.
  const keys = [...ROOTS.filter((k) => k in roots), ...Object.keys(roots).filter((k) => !ROOTS.includes(k))];
  const folders = keys.map((k) => roots[k]).filter(isFolder);
  if (!ROOTS.some((k) => isFolder(roots[k]))) return null;

  const marks: ChromeMark[] = [];
  let found = 0;
  let skipped = 0;
  // Depth first, each folder's children in their order: Chrome's own order.
  const stack: unknown[] = [...folders].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (isFolder(node) && node.type !== "url") {
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
      continue;
    }
    if (!isNode(node) || node.type !== "url") continue;
    found++;
    const url = typeof node.url === "string" ? node.url.trim() : "";
    if (!url || !opensAPage(url)) { skipped++; continue; }
    marks.push({ title: typeof node.name === "string" ? node.name.trim() : "", url });
  }
  return { marks, found, skipped };
}

/** An address as it compares: the parsed URL ("https://a.com" is "https://a.com/"), else as written. */
export function urlKey(url: string): string {
  const u = url.trim();
  try { return new URL(u).href; } catch { return u; }
}

/** The marks not here yet, each address once. `already`: those here before
 *  the import; `repeats`: later copies of an address earlier in the file. */
export function newMarks(marks: readonly ChromeMark[], existing: Iterable<string>): { fresh: ChromeMark[]; already: number; repeats: number } {
  const here = new Set<string>();
  for (const url of existing) here.add(urlKey(url));
  const seen = new Set<string>();
  const fresh: ChromeMark[] = [];
  let already = 0;
  let repeats = 0;
  for (const m of marks) {
    const key = urlKey(m.url);
    if (here.has(key)) { already++; continue; }
    if (seen.has(key)) { repeats++; continue; }
    seen.add(key);
    fresh.push(m);
  }
  return { fresh, already, repeats };
}
