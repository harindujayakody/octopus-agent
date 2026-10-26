let ctx: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

// A web font that finishes loading after a first measure would leave the
// fallback's widths in the cache.
if (typeof document !== "undefined") document.fonts?.addEventListener?.("loadingdone", () => cache.clear());

/// The rendered width of `text` in `font` (a CSS font shorthand), measured
/// once per pair on a canvas: a list of 2,000 rows asks for the same few tag
/// names again and again.
export function textWidth(text: string, font: string): number {
  const key = `${font}|${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * 7;
  ctx.font = font;
  const w = ctx.measureText(text).width;
  cache.set(key, w);
  return w;
}

/** A tag chip's side padding (TagChip's `px-1.5`, 5 px a side) and the gap
 *  between chips (the Tags cell's `gap-1`, 3 px). */
const CHIP_PAD = 10;
const CHIP_GAP = 3;

/// How many whole chips fit in `width` before a "+N" (EMIL-15). A chip is its
/// text and its padding; chips and the "+N" (measured like a name) are 3 px
/// apart. At least one chip always shows (cut, never below four characters:
/// the cell's minimum is 96 px).
export function fitTagChips(names: string[], width: number, measure: (s: string) => number): number {
  let used = 0;
  for (let i = 0; i < names.length; i++) {
    const w = Math.ceil(measure(names[i])) + CHIP_PAD;
    const rest = names.length - i - 1;
    const more = rest > 0 ? CHIP_GAP + Math.ceil(measure(`+${rest}`)) : 0;
    if (used + w + more > width) return Math.max(1, i);
    used += w + CHIP_GAP;
  }
  return names.length;
}

/** What the Tags cell keeps free beside its chips, off the column's width. */
export const TAGS_RESERVE = 8;

/// The column width at which `fitTagChips` shows the first `shown` chips
/// whole and a "+N" for the rest, the reserve included. The Profiles autofit
/// sizes Tags by it, so the fold and the fit read one geometry (merge point 3).
export function tagChipsWidth(names: readonly string[], shown: number, measure: (s: string) => number): number {
  const n = Math.min(shown, names.length);
  let used = 0;
  for (let i = 0; i < n; i++) used += (i > 0 ? CHIP_GAP : 0) + Math.ceil(measure(names[i])) + CHIP_PAD;
  const rest = names.length - n;
  return used + (rest > 0 ? CHIP_GAP + Math.ceil(measure(`+${rest}`)) : 0) + TAGS_RESERVE;
}
