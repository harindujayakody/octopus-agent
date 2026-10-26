/** How a list row is drawn, and the tint its hover actions sit on. */
export type RowTone = "none" | "active" | "peek" | "selected" | "selectedActive";

// Every fill is the kit's `row-fill-*`: one opaque color per state, set on
// the row as its `--row-fill` token, which the row paints and its pinned
// cells paint too, so the two can never drift apart (owner, item 20).
const ROW: Record<RowTone, string> = {
  none: "",
  // The target is the hover gray (active equals hover, owner 2026-10-01), a
  // checked row's tint lies over the panel's white, not the tile's gray
  // (soft text on the gray fell below 4.5:1).
  active: "row-fill-active",
  // The Peek row, when the pointer targets another: marked, the same gray (active equals hover, owner 2026-10-01).
  peek: "row-fill-active",
  selected: "row-fill-selected",
  // The active fill over the checked one (a selected target): never a side
  // stripe (owner rule). Windows contrast themes draw a selected row as the
  // system Highlight alone.
  selectedActive: "row-fill-selected-active",
};

/** The target's own layer on the row, drawn only while it is the target in
 *  sight (the kit's `row-target`: the keys drive, or the pointer or its open
 *  menu is on it). */
const TARGET = {
  active: "row-target:row-fill-active",
  selectedActive: "row-target:row-fill-selected-active",
} as const;

/// One fill per row state (O5, EMIL-03): there is no hover fill, because the
/// row under a moving pointer is the target. The target is drawn while the
/// keys drive it or the pointer is on it; once the pointer leaves, the row
/// shows what it is at rest, in Peek or selected (owner bug, 2026-10-01:
/// "when mouse not hovering anymore it stuck like its hovering"). A pinned
/// row draws like any other (owner, 2026-10-01). `tone` is the target's look
/// for what shows only with it (the hover actions, a cell's edit button).
export function rowFill({ selected, active, inPeek }: {
  selected: boolean; active: boolean; inPeek: boolean;
}): { row: string; tone: RowTone } {
  const tone: RowTone = selected ? (active ? "selectedActive" : "selected") : active ? "active" : inPeek ? "peek" : "none";
  if (!active) return { row: ROW[tone], tone };
  const rest: RowTone = selected ? "selected" : inPeek ? "peek" : "none";
  return { row: `${ROW[rest]} ${selected ? TARGET.selectedActive : TARGET.active}`.trim(), tone };
}

/// The row's own look for a box laid over it (the hover actions' strip, a
/// cell's edit button), which paints the list's surface first to cover the
/// text under it: `fill` is the tint over that surface, and `fades` the same
/// tint as `to-*` stops for the 14 px lead-in fade, in two layers (under,
/// over; "" draws nothing). So the box matches the row exactly, never a band.
/// Always two layers, drawn as two fixed elements: a layer mounted or
/// dropped as the tone changes would take the element under the pointer
/// away mid-click (the pointer changes the tone), and the browser then
/// sends no click.
export function rowTint(tone: RowTone): RowTintLook {
  return TINT[tone];
}

/// `base` and `fadeTo` are the opaque surface the tint lies over: the list's
/// own (`--list-fill`, the tile's color on a `list-tile`) for a row at rest,
/// in Peek or the target (the hover gray), the panel's white for a checked
/// row, whose tint lies over the white (`row-fill-selected`).
type RowTintLook = { fill: string; fades: readonly [string, string]; base: string; fadeTo: string };
const ON_LIST = { base: "bg-[var(--list-fill,var(--color-bg-white-0))]", fadeTo: "to-[var(--list-fill,var(--color-bg-white-0))]" };
const ON_WHITE = { base: "bg-bg-white-0", fadeTo: "to-bg-white-0" };
const TINT: Record<RowTone, RowTintLook> = {
  none: { fill: "", fades: ["", ""], ...ON_LIST },
  active: { fill: ROW.active, fades: ["to-bg-hover", ""], ...ON_LIST },
  peek: { fill: ROW.peek, fades: ["to-bg-hover", ""], ...ON_LIST },
  selected: { fill: ROW.selected, fades: ["to-bg-selected", ""], ...ON_WHITE },
  selectedActive: { fill: ROW.selectedActive, fades: ["to-bg-selected", "to-bg-hover"], ...ON_WHITE },
};
