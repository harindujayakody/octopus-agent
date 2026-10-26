import type { FolderState } from "../model/api";

/// Folder looks and the folders kept while empty, as the backend or a build
/// before it hands them over, made whole. Only types are imported, so
/// `npm run test:unit` runs it as it is.

/** A look: a palette color id (or none) and an icon id. */
export type Look<C extends string, I extends string> = { color: C | null; icon: I };
/** The palette's color ids and the folder icons' ids a look may name. */
export type Known<C extends string, I extends string> = { colors: readonly C[]; icons: readonly I[] };

/** Where builds before the backend kept them, handed over once. */
export const LEGACY_META = "shardx.folderMeta";
export const LEGACY_REGISTRY = "shardx-folders";

// The first build stored hex values; they map onto the palette's ids.
const LEGACY_HEX: Record<string, string> = {
  "#3b82f6": "blue", "#724fff": "violet", "#e040c8": "magenta", "#f04438": "red",
  "#f97316": "orange", "#eab308": "yellow", "#12b76a": "green", "#0ba5ec": "sky",
};

/** Anything stored that isn't a known color or icon falls back to none / the folder. */
function normalise<C extends string, I extends string>(raw: unknown, known: Known<C, I>): Look<C, I> {
  const v = (raw && typeof raw === "object" ? raw : {}) as { color?: unknown; icon?: unknown };
  const asColor = (c: string | undefined) => (c !== undefined && (known.colors as readonly string[]).includes(c) ? (c as C) : null);
  const color = typeof v.color === "string" ? asColor(v.color) ?? asColor(LEGACY_HEX[v.color.toLowerCase()]) : null;
  const icon = typeof v.icon === "string" && (known.icons as readonly string[]).includes(v.icon) ? (v.icon as I) : ("folder" as I);
  return { color, icon };
}

/** Looks by Folder name, each made whole. */
export function looks<C extends string, I extends string>(raw: unknown, known: Known<C, I>): Record<string, Look<C, I>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).map(([name, meta]) => [name, normalise(meta, known)]));
}

/** Named folders. */
export const names = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((f): f is string => typeof f === "string" && !!f.trim()) : []);

/** What a build before the backend kept: a broken value is nothing. */
export function fromLegacy(raw: Record<string, string | null>, known: Known<string, string>): FolderState {
  const parse = (text: string | null): unknown => { try { return JSON.parse(text ?? "null"); } catch { return null; } };
  return { registry: names(parse(raw[LEGACY_REGISTRY])), meta: looks(parse(raw[LEGACY_META]), known) };
}
