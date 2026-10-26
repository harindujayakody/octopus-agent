import type { ExtensionEntry } from "./types";

/** A path as the system writes it: a drive (C:\), a UNC share (\\host), or
 *  one that starts at a root, the home folder or a dot-folder. */
const PATH_LIKE = /^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/]|\.{1,2}[\\/])/;

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? "";
const noExtension = (name: string) => name.replace(/\.[A-Za-z0-9]{1,5}$/, "");

/** What an extension is called: the name in its manifest, else the base name
 *  of the file it came from, without its extension. Never a path: a name
 *  that is one (a temp file's) is cut to its last part. */
export function extensionName(e: Pick<ExtensionEntry, "name" | "path" | "id">): string {
  const name = e.name.trim();
  if (name && !PATH_LIKE.test(name)) return name;
  return noExtension(baseName(name || e.path)) || e.id;
}

/** One extension installed twice: the same Web Store item, else the same name and version. */
export const extensionKey = (e: ExtensionEntry) =>
  e.source?.kind === "webstore" ? `store:${e.source.id}` : `${extensionName(e).toLowerCase()}\n${e.version.trim()}`;

/** How many times each name-and-version is installed (see `extensionKey`). */
export function installCounts(items: readonly ExtensionEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of items) counts.set(extensionKey(e), (counts.get(extensionKey(e)) ?? 0) + 1);
  return counts;
}
