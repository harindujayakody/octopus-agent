/// The column model the Profiles and Proxies lists share (owner feature,
/// 2026-09-26): which data columns a list shows, in what order, and how
/// wide. The select box before them and the row actions after them are not
/// columns here: they never move, hide or resize. Pure functions only; each
/// list keeps its own set in its own store and storage.

/** A translator: `useT()`'s function, or the store-side `t`. */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

export type ColumnDef<Id extends string> = {
  id: Id;
  /** The header text: a literal `t("…")` call, so `check:i18n` sees the key used. */
  title: (t: TFn) => string;
  /** Px the column takes before its content is measured, and always when
   *  it has nothing to measure (a status pill); the least the fill column
   *  takes. */
  need: number;
  /** Takes the room the other columns leave (Notes), while no one has sized it. */
  fill?: boolean;
  /** The narrowest and widest a person can make it, px. */
  min: number;
  max: number;
  /** Content of one size (a pill, a count, a date): the most px a wide row
   *  stretches it past that content while Notes shows, so the room goes to
   *  Notes. A row without Notes spreads the room evenly and ignores it. */
  grow?: number;
  /** Shown on a fresh install. */
  shown: boolean;
  hideable: boolean;
  /** A column that can't move leads the list (Name), and stays pinned at
   *  its left while it scrolls sideways (`TableLayout.pinFirst`). */
  movable: boolean;
};

/** Which columns show and in what order. `order` holds every column, hidden ones too. */
export type ColumnSet<Id extends string> = { order: Id[]; hidden: Id[] };
/** Widths by column, px: the ones a person set (saved), or the ones the
 *  columns take from their content (`measureColumns`, never saved). */
export type ColumnWidths<Id extends string> = Partial<Record<Id, number>>;

/** What a list header needs to change a list's columns: its store's state and actions. */
export type ColumnsApi<Id extends string> = {
  defs: readonly ColumnDef<Id>[];
  set: ColumnSet<Id>;
  widths: ColumnWidths<Id>;
  setSet: (next: ColumnSet<Id>) => void;
  /** Px, or null to give the column back to its content's width. */
  setWidth: (id: Id, px: number | null) => void;
  reset: () => void;
  /** Nothing for Reset columns to undo; by default, the set is the default
   *  one and no width is set (a list that keeps more, a sort, says so). */
  pristine?: boolean;
};

const byIdOf = <Id extends string>(defs: readonly ColumnDef<Id>[]) =>
  new Map<Id, ColumnDef<Id>>(defs.map((d) => [d.id, d]));

export function defaultSet<Id extends string>(defs: readonly ColumnDef<Id>[]): ColumnSet<Id> {
  return { order: defs.map((d) => d.id), hidden: defs.filter((d) => !d.shown).map((d) => d.id) };
}

/// A set read from storage or a View, made whole: unknown and repeated ids
/// drop out; a column the saved set never listed (new since) joins after
/// the column before it in the default order, with its default visibility;
/// a column that can't move goes back to the front; a column that can't
/// hide shows. Anything that is not a set reads as the default.
export function normalizeSet<Id extends string>(defs: readonly ColumnDef<Id>[], raw: unknown): ColumnSet<Id> {
  const byId = byIdOf(defs);
  const r = (raw && typeof raw === "object" ? raw : {}) as { order?: unknown; hidden?: unknown };
  const listed: Id[] = [];
  if (Array.isArray(r.order)) {
    for (const x of r.order) if (typeof x === "string" && byId.has(x as Id) && !listed.includes(x as Id)) listed.push(x as Id);
  }
  const hiddenRaw = new Set(Array.isArray(r.hidden) ? r.hidden.filter((x): x is string => typeof x === "string") : []);
  const order = listed.filter((id) => byId.get(id)!.movable);
  defs.forEach((d, i) => {
    if (!d.movable || order.includes(d.id)) return;
    const prev = defs.slice(0, i).reverse().find((p) => p.movable && order.includes(p.id));
    order.splice(prev ? order.indexOf(prev.id) + 1 : 0, 0, d.id);
  });
  const fixed = defs.filter((d) => !d.movable).map((d) => d.id);
  const hidden = defs
    .filter((d) => d.hideable && (listed.includes(d.id) ? hiddenRaw.has(d.id) : !d.shown))
    .map((d) => d.id);
  return { order: [...fixed, ...order], hidden };
}

export function clampWidth<Id extends string>(def: ColumnDef<Id>, px: number): number {
  return Math.round(Math.min(def.max, Math.max(def.min, px)));
}

/** A stored width: a wide row can draw a column past its max, and a person keep it there. */
export const keptWidth = <Id extends string>(def: ColumnDef<Id>, px: number): number =>
  Math.round(Math.min(def.max * 4, Math.max(def.min, px)));

/** Saved widths, each clamped (`keptWidth`); anything else dropped. */
export function normalizeWidths<Id extends string>(defs: readonly ColumnDef<Id>[], raw: unknown): ColumnWidths<Id> {
  const out: ColumnWidths<Id> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const d of defs) {
    const v = (raw as Record<string, unknown>)[d.id];
    if (typeof v === "number" && Number.isFinite(v)) out[d.id] = keptWidth(d, v);
  }
  return out;
}

export const visibleOf = <Id extends string>(set: ColumnSet<Id>): Id[] =>
  set.order.filter((id) => !set.hidden.includes(id));

export function sameWidths<Id extends string>(a: ColumnWidths<Id>, b: ColumnWidths<Id>): boolean {
  const ka = Object.keys(a) as Id[];
  return ka.length === Object.keys(b).length && ka.every((id) => a[id] === b[id]);
}

export function sameSet<Id extends string>(a: ColumnSet<Id>, b: ColumnSet<Id>): boolean {
  return a.order.length === b.order.length && a.order.every((id, i) => b.order[i] === id)
    && a.hidden.length === b.hidden.length && a.hidden.every((id) => b.hidden.includes(id));
}

export const isDefaultSet = <Id extends string>(defs: readonly ColumnDef<Id>[], set: ColumnSet<Id>): boolean =>
  sameSet(set, defaultSet(defs));

/** Shows or hides a column; a column that can't hide stays. */
export function setShown<Id extends string>(defs: readonly ColumnDef<Id>[], set: ColumnSet<Id>, id: Id, shown: boolean): ColumnSet<Id> {
  if (!byIdOf(defs).get(id)?.hideable) return set;
  const hidden = set.hidden.filter((x) => x !== id);
  return { order: set.order, hidden: shown ? hidden : [...hidden, id] };
}

/** Moves `id` to just before `before` (null: to the end). A column that
 *  can't move stays where it is, and nothing lands before one. */
export function placeBefore<Id extends string>(defs: readonly ColumnDef<Id>[], set: ColumnSet<Id>, id: Id, before: Id | null): ColumnSet<Id> {
  const byId = byIdOf(defs);
  if (!byId.get(id)?.movable || id === before) return set;
  if (before !== null && !byId.get(before)?.movable) return set;
  const rest = set.order.filter((x) => x !== id);
  const at = before === null ? rest.length : rest.indexOf(before);
  if (at < 0) return set;
  return { order: [...rest.slice(0, at), id, ...rest.slice(at)], hidden: set.hidden };
}

/** One step left or right among the columns on screen (`shown`): Move left
 *  and Move right. Null when it can't go that way. */
export function moveBy<Id extends string>(
  defs: readonly ColumnDef<Id>[], set: ColumnSet<Id>, id: Id, step: -1 | 1, shown: readonly Id[],
): ColumnSet<Id> | null {
  const byId = byIdOf(defs);
  const at = shown.indexOf(id);
  if (at < 0 || !byId.get(id)?.movable) return null;
  const other = shown[at + step];
  if (other === undefined || !byId.get(other)?.movable) return null;
  return step < 0 ? placeBefore(defs, set, id, other) : placeBefore(defs, set, id, shown[at + 2] ?? null);
}

/** The custom property a live resize sets on the list (`--col-<id>`); the
 *  grid template falls back to the stored track while it is unset. Built,
 *  not written out, so `check:classes` doesn't read it as an undeclared var. */
export const columnVar = (id: string): string => "--col-" + id;

export type LayoutOptions<Id extends string> = {
  /** The list's inner width, px (null: not measured yet). It hides nothing:
   *  the columns no one sized give way to it (`giveWay`), and it decides
   *  whether Name can stay pinned (`pinFirst`). */
  available: number | null;
  /** Chosen, but not shown here (Folder inside a Folder). */
  exclude?: readonly Id[];
  /** The widths the columns take from their content (`measureColumns`); a width
   *  in `widths` (the person's) wins over one here. */
  auto?: ColumnWidths<Id>;
  /** The widths every row of a column fits in (`measureColumns`' `full`): a
   *  column cut at its `auto` width grows toward this one with the room left
   *  over. */
  full?: ColumnWidths<Id>;
  /** The widths some columns take once the part of them that gives way
   *  first has moved into a tooltip (Proxies' Test result without its IP,
   *  controller ruling, merge point 3): short of room, such a column drops
   *  to it, whole, before any column is cut (`TableLayout.shortened`). */
  short?: ColumnWidths<Id>;
  /** The least some columns give way to: the width that still shows their
   *  content's folded form (Tags: one chip and "+N"; Folder: one chip),
   *  over their minimum (controller ruling, merge point 4). */
  floor?: ColumnWidths<Id>;
  /** The fixed cells before and after the data columns, px. A list that
   *  selects nothing has no lead: 0 leaves out its track and the gap after
   *  it. A list that selects keeps its select column in every state (owner,
   *  2026-10-07): the box has its own slot before Name, never over it. */
  lead: number;
  /** The lead's grid track in place of `${lead}px`: the select column's
   *  shared length (`var(--list-select)`, the kit's tokens.css), which spans
   *  the lead and the gap after it, the row's own leading padding short by
   *  that gap (`list-select-row`). */
  leadTrack?: string;
  tail: number;
  /** Between two tracks, and the row's side padding (both sides together), px. */
  gap: number;
  padding: number;
  /** The least the last shown column may have, given the one before it
   *  (the row actions float over the last one). */
  lastFloor?: (last: Id, prev: Id | undefined) => number;
};

export type TableLayout<Id extends string> = {
  /** The data columns the list draws, in order: every chosen one but `excluded`. */
  shown: Id[];
  /** Chosen, but left out here (`exclude`). */
  excluded: Id[];
  /** The columns at their `short` width: their cells show the part that
   *  gives way in a tooltip, never cut. */
  shortened: Id[];
  /** `grid-template-columns` for the header and every row. */
  template: string;
  /** Px the shown columns take (sized, measured or `need`, less what they
   *  gave way): the list's minimum width. A card narrower than this scrolls
   *  the list sideways inside it. */
  minWidth: number;
  /** Name (the first column, which can't move) stays pinned at the card's
   *  left while the list scrolls sideways: false only when pinning it would
   *  leave the scrolling columns less than `PIN_ROOM` px. */
  pinFirst: boolean;
  /** Px the pinned parts cover at the list's left while it scrolls sideways:
   *  the side padding, the select box and the gap after it, plus Name and
   *  its gap when Name pins. A control focused in a scrolling column stays
   *  clear of it (`list-pin-scroll` in app.css). */
  pinStart: number;
  /** The same at its right: the row actions and the side padding. What a
   *  list draws beside them (a hover strip) is the list's own to add. */
  pinEnd: number;
  /** Each column's drawn width, px (the list's width measured). */
  drawn: ColumnWidths<Id>;
  /** Each column's grid track, as `template` holds it: what a live resize sets. */
  tracks: Partial<Record<Id, string>>;
  /** The row is wider than the columns and they stretch to fill it. */
  stretched: boolean;
  /** `id`'s edge moved so the column is `px` wide, as a drag or the arrow
   *  keys move it: the person's widths to keep, and the layout they give. */
  resize: (id: Id, px: number) => { widths: ColumnWidths<Id>; layout: TableLayout<Id> };
};

/** The least room the scrolling columns keep beside the pinned parts, px:
 *  the widest default column (Host:Port, 150 px) and a gap. */
const PIN_ROOM = 160;

/// Columns too wide for the list, narrowed by `over` px (controller ruling,
/// 2026-09-30: auto columns give way before the list scrolls sideways).
/// The column furthest over its `need` gives first, down to the next one,
/// then both, and so on (one level over `need` for all of them, in whole
/// px); past `need` they keep going down together, each to its `floor` (its
/// minimum or its folded content's width, whichever is wider, or its width
/// when a person sized it). All at their floors and
/// still over: the list scrolls sideways. A cut cell shows whole in its
/// `whenTruncated` tooltip.
function shrink(cols: readonly { top: number; need: number; floor: number }[], over: number): number[] {
  const at = (c: (typeof cols)[number], level: number) => Math.min(c.top, Math.max(c.floor, c.need + level));
  const cut = (level: number) => cols.reduce((s, c) => s + c.top - at(c, level), 0);
  let level = Math.max(0, ...cols.map((c) => c.top - c.need));
  const lowest = Math.min(0, ...cols.map((c) => c.floor - c.need));
  while (level > lowest && cut(level) < over) level--;
  return cols.map((c) => at(c, level));
}

/// `shrink` in rounds (controller rulings, Pair 31 and merge point 4): a
/// person's width past the column's max (only a stretched row draws one)
/// first, down to its content (`spare`): that px is empty room. Then the
/// `fill` column (Notes: free text, whole in its tooltip) goes down to its
/// floor, before any column of content; then every other column but
/// the `last` ones (Name, which leads the list and names the row), each to
/// its floor; only then does Name give way, and only when that ends the
/// sideways scroll. When the list must scroll anyway, Name keeps its width:
/// it stays pinned while the rest scrolls, so cutting it would buy nothing,
/// and a name beside an open Peek stays whole at the default window.
function giveWay(cols: readonly { top: number; need: number; floor: number; last: boolean; fill: boolean; spare?: number }[], over: number): number[] {
  type Col = (typeof cols)[number];
  // One round: the columns `to` gives a floor go down toward it, the rest hold.
  const round = (from: readonly number[], to: (c: Col) => number | undefined, px: number) =>
    shrink(cols.map((c, i) => {
      const f = to(c);
      return { top: from[i], need: c.need, floor: f === undefined ? from[i] : Math.min(from[i], f) };
    }), px);
  const cut = (at: readonly number[]) => cols.reduce((s, c, i) => s + c.top - at[i], 0);
  const spare = round(cols.map((c) => c.top), (c) => c.spare, over);
  if (cut(spare) >= over) return spare;
  const notes = round(spare, (c) => (c.fill ? c.floor : undefined), over - cut(spare));
  if (cut(notes) >= over) return notes;
  const rest = round(notes, (c) => (!c.last && !c.fill ? c.floor : undefined), over - cut(notes));
  const left = over - cut(rest);
  const room = cols.reduce((s, c, i) => s + (c.last ? Math.max(0, rest[i] - c.floor) : 0), 0);
  if (left <= 0 || room < left) return rest;
  return round(rest, (c) => (c.last ? c.floor : undefined), left);
}

/// `extra` px shared out (owner, 2026-10-23): the same px to each column up
/// to its cap, so the columns start at even steps; past every cap, the same
/// px to each again.
function level(cols: readonly { base: number; cap: number }[], extra: number): number[] {
  if (cols.length === 0) return [];
  const heads = cols.map((c) => c.cap - c.base).sort((a, b) => a - b);
  let left = extra;
  let open = cols.length;
  let at = 0;
  for (const h of heads) {
    if ((h - at) * open >= left) return cols.map((c) => c.base + Math.min(c.cap - c.base, at + left / open));
    left -= (h - at) * open;
    at = h;
    open--;
  }
  return cols.map((c) => c.cap + left / cols.length);
}

/** Px as a flex factor, or a track's px: two decimals are plenty. */
const r2 = (px: number) => Math.round(px * 100) / 100;

/// The columns a list draws and their grid (owner decision 2026-09-26):
/// every chosen column but `exclude`, in order; none drops out for want of
/// room. Each is as wide as a person made it, else as its content needs
/// (`o.auto`, owner 2026-09-30), else `need`. Too wide for the list
/// (`o.available`), the columns no one sized give way first: Notes (the fill
/// column), then the rest, each down to its minimum or the width its folded
/// content needs (`o.floor`); Name (the column that can't move) last, and
/// only when that ends the sideways scroll (`giveWay`, controller rulings
/// 2026-09-30, Pair 31, merge point 4). The list's minimum
/// width is their sum, so a card narrower than that scrolls the list
/// sideways inside it and the page never does; the header row stays on top, the select box
/// and Name stay pinned at the card's left and the row actions at its right
/// (`list-pin-*` in app.css). Short of room, a column's part that gives way
/// first moves into its tooltip before any column is cut (`o.short`).
/// Room left over stretches the row to the list's width (owner, 2026-10-23: `stretchRow`).
export function layoutColumns<Id extends string>(
  defs: readonly ColumnDef<Id>[],
  set: ColumnSet<Id>,
  widths: ColumnWidths<Id>,
  o: LayoutOptions<Id>,
): TableLayout<Id> {
  const byId = byIdOf(defs);
  const wanted = visibleOf(set);
  const excluded = wanted.filter((id) => o.exclude?.includes(id));
  const shown = wanted.filter((id) => !o.exclude?.includes(id));
  const lastFloor = (i: number) =>
    i === shown.length - 1 && o.lastFloor ? Math.ceil(o.lastFloor(shown[i], shown[i - 1])) : 0;
  const leads = o.lead > 0;
  const leadRoom = leads ? o.lead + o.gap : 0;
  const frame = leadRoom + o.tail + shown.length * o.gap + o.padding;
  // Each column's width from its content, as if no one sized it; Notes keeps `need`.
  const own = shown.map((id, i) => Math.max((byId.get(id)!.fill ? undefined : o.auto?.[id]) ?? byId.get(id)!.need, lastFloor(i)));
  let px = shown.map((id, i) => (widths[id] !== undefined ? Math.max(widths[id]!, lastFloor(i)) : own[i]));
  let over = o.available === null ? 0 : frame + px.reduce((s, n) => s + n, 0) - o.available;
  // Short of room as they are: nothing stretches.
  const tight = over > 0;
  // Short of room, a column's part that gives way first (the Test result's
  // IP) moves into its tooltip, whole, before any column is cut; a column a
  // person made too narrow for it shows it there too (controller ruling,
  // merge point 3: never "OK 56 ms 2…").
  const shortened = shown.filter((id, i) => {
    const s = o.short?.[id];
    if (s === undefined) return false;
    if (widths[id] !== undefined) return widths[id]! < (o.auto?.[id] ?? byId.get(id)!.need);
    if (over <= 0 || s >= px[i]) return false;
    const to = Math.max(s, lastFloor(i));
    over -= px[i] - to;
    px[i] = to;
    return true;
  });
  const fill = shown.find((id) => byId.get(id)!.fill && widths[id] === undefined);
  // A person's width never gives way; else down to the min or the folded content (merge point 4).
  const floorOf = (i: number, top: number, sized: boolean) => {
    const d = byId.get(shown[i])!;
    return sized ? top : Math.min(top, Math.max(d.min, lastFloor(i), o.floor?.[d.id] ?? 0));
  };
  if (over > 0) {
    px = giveWay(shown.map((id, i) => {
      const d = byId.get(id)!;
      const sized = widths[id] !== undefined;
      // Past its max, a person's width is a wide row's stretch: it goes first, down to the content,
      // and on from there as if no one had sized it, so it never leaves the row tighter.
      const stretch = sized && px[i] > d.max;
      const spare = stretch ? Math.min(px[i], own[i]) : undefined;
      return { top: px[i], need: d.need, floor: floorOf(i, px[i], sized && !stretch), last: !d.movable, fill: id === fill, spare };
    }), over);
  }
  const minWidth = frame + px.reduce((s, n) => s + n, 0);
  const stretched = o.available !== null && o.available > minWidth && !tight;
  let drawn: number[];
  let tracks: string[];
  let tail: string;
  if (stretched) {
    ({ drawn, tracks, tail } = stretchRow(shown.map((id, i) => ({
      def: byId.get(id)!,
      own: own[i],
      px: px[i],
      sized: widths[id] !== undefined,
      full: o.full?.[id],
      floor: floorOf(i, own[i], false),
    })), o.available! - frame, o.tail));
  } else {
    // The room left over lets a cut column show whole, the nearest to whole
    // first, and only a column it can make whole: a long name that stays cut
    // anyway keeps its fitted width, and the room goes on to the next one,
    // then to Notes (controller rulings, 2026-09-30 and merge point 3).
    // Not measured yet: each may grow toward whole.
    let spare = o.available === null ? Infinity : o.available - minWidth;
    const grows = new Set<Id>();
    shown
      .map((id, i) => ({ id, gap: id === fill || widths[id] !== undefined || shortened.includes(id) ? 0 : (o.full?.[id] ?? 0) - px[i] }))
      .filter((c) => c.gap > 0)
      .sort((a, b) => a.gap - b.gap)
      .forEach((c) => { if (c.gap <= spare) { spare -= c.gap; grows.add(c.id); } });
    tracks = shown.map((id, i) => {
      if (id === fill) return `minmax(${px[i]}px,1fr)`;
      return grows.has(id) ? `minmax(${px[i]}px,${o.full![id]}px)` : `${px[i]}px`;
    });
    tail = fill ? `${o.tail}px` : `minmax(${o.tail}px,1fr)`;
    // What the grid draws: a grown column whole, Notes what is left.
    drawn = shown.map((id, i) => (o.available !== null && grows.has(id) ? o.full![id]! : px[i]));
    if (fill && o.available !== null && spare > 0) drawn[shown.indexOf(fill)] += spare;
  }
  // The pinned parts while it scrolls: the side padding, the select box,
  // Name and the gaps beside them at the left; the row actions and the side
  // padding at the right. (Scrolling, every track sits at its minimum.)
  const start = o.padding / 2 + leadRoom;
  const name = (px[0] ?? 0) + o.gap;
  const end = o.tail + o.padding / 2;
  const pinFirst = o.available === null || minWidth <= o.available || o.available - (start + name + end) >= PIN_ROOM;
  const byShown = <T,>(v: readonly T[]) => Object.fromEntries(shown.map((id, i) => [id, v[i]])) as Partial<Record<Id, T>>;
  const layout: TableLayout<Id> = {
    shown,
    excluded,
    shortened,
    template: [...(leads ? [o.leadTrack ?? `${o.lead}px`] : []), ...shown.map((id, i) => `var(${columnVar(id)},${tracks[i]})`), tail].join(" "),
    minWidth,
    pinFirst,
    pinStart: start + (pinFirst ? name : 0),
    pinEnd: end,
    drawn: byShown(drawn),
    tracks: byShown(tracks),
    stretched,
    resize: (id, to) => resizeEdge(defs, set, widths, o, layout, id, to),
  };
  return layout;
}

type StretchCol<Id extends string> = {
  def: ColumnDef<Id>;
  /** Width from its content, as if no one sized it; `px` is the person's, else this. */
  own: number;
  px: number;
  sized: boolean;
  /** The width every row fits in, uncut. */
  full?: number;
  floor: number;
};

/// Slots first: cut columns toward whole, Notes toward whole, then even px up to each cap; empty ones stay.
/// Without Notes the rest goes as the same px to every column but the last, which keeps its slot so
/// the row's data ends at its actions (owner, 2026-10-23: a max let Name take the rest, far from the data).
/// A person's width then trades px with the next stretching column after it, so columns before it hold.
function stretchRow<Id extends string>(cols: readonly StretchCol<Id>[], room: number, tailPx: number) {
  const sum = (v: readonly number[]) => v.reduce((s, n) => s + n, 0);
  const empty = cols.map((c) => c.own < c.def.min || (c.full ?? c.def.min) < c.def.min);
  const notes = cols.findIndex((c, i) => c.def.fill && !empty[i]);
  let slot = cols.map((c) => c.own);
  let extra = room - sum(slot);
  if (extra < 0) {
    // Only a person's narrow column makes the room: the slots as if short of it.
    slot = giveWay(cols.map((c) => ({ top: c.own, need: c.def.need, floor: c.floor, last: !c.def.movable, fill: !!c.def.fill })), -extra);
    extra = Math.max(0, room - sum(slot));
  }
  // The nearest to whole first. A column grows from half its gap of room to whole at its gap, so it
  // never jumps whole at one px; one the room is far from making whole takes the even share instead.
  cols
    .map((c, i) => ({ i, gap: c.def.fill || empty[i] ? 0 : (c.full ?? 0) - slot[i] }))
    .filter((c) => c.gap > 0)
    .sort((a, b) => a.gap - b.gap)
    .forEach((c) => {
      const g = Math.min(c.gap, Math.max(0, 2 * extra - c.gap));
      slot[c.i] += g;
      extra -= g;
    });
  if (notes >= 0) {
    const g = Math.max(0, Math.min(extra, (cols[notes].full ?? 0) - slot[notes]));
    slot[notes] += g;
    extra -= g;
  }
  let open = cols.map((_, i) => i).filter((i) => !empty[i]);
  if (notes < 0 && open.length > 1) open = open.slice(0, -1);
  const capOf = (i: number) => {
    const c = cols[i];
    if (i === notes) return Infinity;
    if (notes < 0) return slot[i];
    const whole = Math.max(slot[i], c.full ?? 0);
    return c.def.grow !== undefined ? whole + c.def.grow : Math.max(c.def.max, whole);
  };
  level(open.map((i) => ({ base: slot[i], cap: capOf(i) })), extra).forEach((v, k) => { slot[open[k]] = v; });
  const gives = (i: number) => !cols[i].sized && !empty[i];
  const least = (i: number) => Math.min(cols[i].px, slot[i]);
  const out = [...slot];
  let carry = 0;
  const take = (i: number) => {
    if (!gives(i) || Math.abs(carry) < 0.005) return;
    const t = carry > 0 ? Math.min(carry, out[i] - least(i)) : carry;
    out[i] -= t;
    carry -= t;
  };
  cols.forEach((c, i) => {
    if (!c.sized) take(i);
    else { out[i] = c.px; carry += c.px - slot[i]; }
  });
  for (let i = cols.length - 1; i >= 0; i--) take(i);
  // fr keeps the shares while the window moves ahead of the next measure.
  const flex = cols.some((_, i) => gives(i));
  return {
    drawn: out.map(r2),
    tracks: cols.map((_, i) => (gives(i) ? `minmax(${r2(least(i))}px,${r2(out[i])}fr)` : `${r2(out[i])}px`)),
    // Nothing stretches (all sized or empty): the actions' track takes the rest.
    tail: flex ? `${tailPx}px` : `minmax(${tailPx}px,1fr)`,
  };
}

/// Not stretched: the column takes `to`, as before. Stretched: the next column gives the px (the last
/// column's, the one before it), and the move stops where the columns before the edge would give.
function resizeEdge<Id extends string>(
  defs: readonly ColumnDef<Id>[], set: ColumnSet<Id>, widths: ColumnWidths<Id>, o: LayoutOptions<Id>,
  l: TableLayout<Id>, id: Id, to: number,
): { widths: ColumnWidths<Id>; layout: TableLayout<Id> } {
  const byId = byIdOf(defs);
  const d = byId.get(id);
  const at = l.shown.indexOf(id);
  const keep = (next: ColumnWidths<Id>) => ({ widths: next, layout: layoutColumns(defs, set, next, o) });
  if (!d || at < 0) return { widths, layout: l };
  if (!l.stretched) return keep({ ...widths, [id]: clampWidth(d, to) });
  const from = l.drawn[id]!;
  // A wide row draws columns past their max: an edge moves on to what can be kept, as far as a column gives.
  const want = keptWidth(d, to);
  const last = at === l.shown.length - 1;
  const partner = l.shown[last ? at - 1 : at + 1];
  const hold = l.shown.slice(0, last ? Math.max(0, at - 1) : at);
  const make = (w: number) => {
    const next: ColumnWidths<Id> = { ...widths, [id]: w };
    if (partner !== undefined && widths[partner] !== undefined) {
      const p = l.drawn[partner]!;
      next[partner] = keptWidth(byId.get(partner)!, p - (w - from));
    }
    return keep(next);
  };
  const holds = (r: { layout: TableLayout<Id> }) =>
    r.layout.stretched && hold.every((h) => Math.abs(r.layout.drawn[h]! - l.drawn[h]!) < 0.5);
  // A move that draws nothing new keeps nothing either.
  const moved = (r: { widths: ColumnWidths<Id>; layout: TableLayout<Id> }) =>
    (Math.abs(r.layout.drawn[id]! - from) < 0.5 ? { widths, layout: l } : r);
  const got = make(want);
  if (holds(got)) return moved(got);
  let ok = keptWidth(d, from);
  if (!holds(make(ok))) return { widths, layout: l };
  let bad = want;
  while (Math.abs(bad - ok) > 1) {
    const mid = Math.round((ok + bad) / 2);
    if (holds(make(mid))) ok = mid;
    else bad = mid;
  }
  return moved(make(ok));
}

// ---- Widths from content (owner, 2026-09-30) --------------------------------
// "Make sure we automatically adjust width based of the content in columns:
// like if we have in name more small names and one big, adjust to smaller
// width, so it looks better."

/** The type roles a list cell's text is drawn in (the kit's `text-ui`,
 *  `text-secondary`, a medium `text-secondary` label, `text-mono`, and
 *  `text-secondary` with tabular digits: counts and run times). */
export type FontRole = "ui" | "secondary" | "medium" | "mono" | "tabular";
/** A text's width in a role's font, px. */
export type Measure = (text: string, role: FontRole) => number;
/** A text to measure, and its role. */
export type CellText = { text: string; role: FontRole };
/** Many texts' widths at once, px, in order: the page lays them out in one go. */
export type MeasureAll = (texts: readonly CellText[]) => number[];
/** What one row shows in a column, px: its text measured with `m`, plus
 *  its fixed parts (a pin, a flag, a chip's padding); 0 for a cell that
 *  shows nothing, which the width leaves out (`fitRoom`). */
export type ColumnFit<Row> = (row: Row, m: Measure) => number;
/** The columns a list sizes to their content; the rest (a status pill)
 *  keep `need`. */
export type ColumnFits<Id extends string, Row> = Partial<Record<Id, ColumnFit<Row>>>;
/** One column's content, measured, px: each row's cell and its header label. */
export type ColumnContent = { cells: readonly number[]; header: number };
/** What `measureColumns` finds for each column it measures, px. */
export type ContentWidths<Id extends string> = {
  /** The width nine rows in ten fit in (`fitWidth`): the column's own. */
  fit: ColumnWidths<Id>;
  /** The width every row fits in, past the column's max too: a column cut at
   *  `fit` grows toward it with the room left over (`layoutColumns`). */
  full: ColumnWidths<Id>;
  /** The width every row fits in once the part that gives way first has
   *  moved into its tooltip (`useAutoWidths`' `short` fits), for the
   *  columns that have one. */
  short?: ColumnWidths<Id>;
  /** The width nine rows in ten show their folded form in (`useAutoWidths`'
   *  `folded` fits: Tags' one chip and "+N"), for the columns that fold:
   *  the least they give way to (`LayoutOptions.floor`). */
  floor?: ColumnWidths<Id>;
};

/** Text lays out to a fraction of a px, and a track is whole px: 1 px more
 *  keeps a row at the width from an ellipsis. */
const TEXT_SLACK = 1;

/// The width nine rows in ten fit in: the nearest-rank 90th percentile of
/// `values`. Under ten rows that rank lands on the widest one, so there the
/// one widest is left out instead: a few short names and one long one size
/// to the short ones, the owner's own example. 0 for none.
export function p90(values: readonly number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.max(1, n - Math.max(1, Math.floor(n / 10))) - 1];
}

/** How much wider than the nine-in-ten width a row may be and still fit:
 *  a name a letter or two longer shows whole rather than cut by an
 *  ellipsis; only a row well past it (the one long name) truncates. */
const NEAR = 4 / 3;

/// The room a column's rows ask for: nine rows in ten (`p90`), and any row
/// up to a third wider than that, so a near miss never shows an ellipsis.
/// Only the cells that show something count (0 px is an empty one): a
/// column most rows leave empty sizes to the rows that fill it, not to
/// nothing (autofit review C1). None: 0, and the header alone sets the
/// width (`widthFor`).
export function fitRoom(values: readonly number[]): number {
  const filled = values.filter((v) => v > 0);
  const at = p90(filled);
  let room = at;
  for (const v of filled) if (v > room && v <= at * NEAR) room = v;
  return room;
}

/** `wide` or the header label, whichever is wider, and the slack, inside
 *  the column's range. A column every row leaves empty (`wide` 0) is its
 *  header label's width, under its minimum too: an empty Folder column was
 *  a hole wider than any other gap (owner, 2026-10-07, item 9). */
const widthFor = <Id extends string>(def: ColumnDef<Id>, wide: number, header: number, max = def.max) => {
  const px = Math.ceil(Math.max(wide, header) + TEXT_SLACK);
  return wide > 0 ? Math.min(max, Math.max(def.min, px)) : Math.min(def.max, px);
};

/// A column's width from its content (a column with nothing to measure, a
/// status pill, keeps `need`): the room its filled rows ask for (`fitRoom`),
/// never narrower than its header label, inside its own minimum and
/// maximum; with no filled row, its header label's (`widthFor`). The rest
/// truncate and show whole in a tooltip.
export function fitWidth<Id extends string>(def: ColumnDef<Id>, c: ColumnContent): number {
  return widthFor(def, fitRoom(c.cells), c.header);
}

/** How far under the widest fitting row a row may be by `m` and still be
 *  wider by `exact`: fast and exact measures order two texts within a few
 *  percent either way (the canvas and the page's layout, by letter). */
const RANK_BAND = 0.03;
/** The most rows `exact` measures per column, widest first. */
const RANK_ROWS = 8;

/// Each fitted column's width over `rows` (`fitWidth`): every row of the
/// list, not only the ones on screen; and the width all of them fit in
/// (`full`, for the room left over). `m` measures every row (fast, it ranks
/// them); when given, `exact` measures again, all in one go, the few rows at
/// the widest that fits (`fitRoom`) and just under it, and the few at the
/// widest of all, and the widest of each set sets that width, so a row that
/// fits by one measure never truncates by the other. `header` is a title's
/// width, the floor. The kit's later DataList sizes its columns with this too.
export function measureColumns<Id extends string, Row>(
  defs: readonly ColumnDef<Id>[],
  rows: readonly Row[],
  fits: ColumnFits<Id, Row>,
  m: Measure,
  header: (id: Id) => number,
  exact?: MeasureAll,
): ContentWidths<Id> {
  const out: ContentWidths<Id> = { fit: {}, full: {} };
  const close: { d: ColumnDef<Id>; fit: ColumnFit<Row>; near: number[]; wide: number[]; header: number }[] = [];
  /** Up to RANK_ROWS rows at `px` and just under it, widest first. */
  const around = (cells: readonly number[], px: number) => {
    const at: number[] = [];
    for (let i = 0; i < cells.length; i++) if (cells[i] <= px && cells[i] >= px * (1 - RANK_BAND)) at.push(i);
    return at.sort((a, b) => cells[b] - cells[a]).slice(0, RANK_ROWS);
  };
  for (const d of defs) {
    const fit = fits[d.id];
    if (!fit) continue;
    const cells = rows.map((r) => fit(r, m));
    const h = header(d.id);
    const at = fitRoom(cells);
    const most = cells.reduce((a, b) => Math.max(a, b), 0);
    out.fit[d.id] = widthFor(d, at, h);
    // Whole, past the max: a wide row can show a long URL whole.
    out.full[d.id] = widthFor(d, most, h, Infinity);
    // Nothing to lay out when every cell is empty.
    if (!exact || most === 0) continue;
    close.push({ d, fit, near: around(cells, at), wide: most > at ? around(cells, most) : [], header: h });
  }
  if (!exact || close.length === 0) return out;
  // Once to list the texts those rows show, once more to read them back.
  const texts: CellText[] = [];
  const index = new Map<string, number>();
  const key = (text: string, role: FontRole) => `${role}:${text}`;
  const list: Measure = (text, role) => {
    if (text && !index.has(key(text, role))) { index.set(key(text, role), texts.length); texts.push({ text, role }); }
    return 0;
  };
  for (const c of close) for (const i of [...c.near, ...c.wide]) c.fit(rows[i], list);
  const px = exact(texts);
  const read: Measure = (text, role) => (text ? px[index.get(key(text, role)) ?? -1] ?? 0 : 0);
  const widest = (c: (typeof close)[number], at: number[]) => at.reduce((a, i) => Math.max(a, c.fit(rows[i], read)), 0);
  for (const c of close) {
    const fitPx = widthFor(c.d, widest(c, c.near), c.header);
    out.fit[c.d.id] = fitPx;
    out.full[c.d.id] = c.wide.length > 0 ? Math.max(fitPx, widthFor(c.d, widest(c, c.wide), c.header, Infinity)) : fitPx;
  }
  return out;
}

/** The model's storage version. Version 1 was the old Profiles
 *  `{ folder, tags, notes }` booleans, which the Profiles entity migrates. */
export const LAYOUT_VERSION = 2 as const;
export type StoredLayout = { v: typeof LAYOUT_VERSION; order: string[]; hidden: string[]; widths: Record<string, number> };

export function toStored<Id extends string>(set: ColumnSet<Id>, widths: ColumnWidths<Id>): StoredLayout {
  return { v: LAYOUT_VERSION, order: [...set.order], hidden: [...set.hidden], widths: { ...widths } as Record<string, number> };
}

/** A stored layout of this version, made whole; null for anything else
 *  (older, newer or broken), which the caller reads its own way. */
export function fromStored<Id extends string>(
  defs: readonly ColumnDef<Id>[], raw: unknown,
): { set: ColumnSet<Id>; widths: ColumnWidths<Id> } | null {
  if (!raw || typeof raw !== "object" || (raw as { v?: unknown }).v !== LAYOUT_VERSION) return null;
  return { set: normalizeSet(defs, raw), widths: normalizeWidths(defs, (raw as { widths?: unknown }).widths) };
}

export type ColumnChoice<Id extends string> = { id: Id; title: string; checked: boolean; disabled: boolean; note?: string };

/// The column list the header menus and a Display menu show, so both say
/// the same: every column in the list's order, checked when chosen, with a
/// note when a chosen one is left out here (Folder inside a Folder), or can
/// never be hidden. A chosen column is always drawn otherwise: a list too
/// narrow for it scrolls sideways.
export function columnChoices<Id extends string>(
  defs: readonly ColumnDef<Id>[],
  set: ColumnSet<Id>,
  layout: Pick<TableLayout<Id>, "excluded">,
  t: TFn,
  excludedNote?: string | ((id: Id) => string | undefined),
): ColumnChoice<Id>[] {
  const byId = byIdOf(defs);
  return set.order.map((id) => {
    const d = byId.get(id)!;
    const checked = !set.hidden.includes(id);
    const note = !d.hideable ? t("tableColumns.alwaysShown")
      : checked && layout.excluded.includes(id) ? (typeof excludedNote === "function" ? excludedNote(id) : excludedNote)
      : undefined;
    return { id, title: d.title(t), checked, disabled: !d.hideable, note };
  });
}
