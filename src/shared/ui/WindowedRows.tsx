import { useLayoutEffect, useRef, useState, type FocusEvent, type HTMLAttributes, type ReactNode } from "react";
import { layoutRect, useVirtualList } from "@proxyshard/shardx-ui-kit";

/** The nearest ancestor that scrolls vertically. */
function scrollingParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return document.scrollingElement as HTMLElement;
}

/// A long list of same-height rows: only the rows in view, and a few either
/// side, are mounted; spacers above and below keep the scroll height
/// (PERF-19). Rows stay in normal flow, so a caller's row markup does not
/// change. The row pitch (height plus any gap) is measured from the rows,
/// starting from `estimate`. `scroll="self"`: this element is the scroll box
/// (its `className` gives the height and overflow). `scroll="parent"`: the
/// nearest scrolling ancestor is (a page that scrolls as a whole, the Trash).
/// `children` render after the rows (an empty-list message). Offsets are in
/// layout px, as `scrollTop` is, so the Interface size zoom does not skew
/// them (Phase D ruling F9). The row that holds the keyboard focus stays
/// mounted, in its place, however far the list scrolls from it: End or
/// PageDown on a focused checkbox scrolls the box, and an unmounted row would
/// drop focus to the page (Pair 26 review), as ProfileTable, ProxyList and
/// the kit OptionList keep their active row. It is held by `keyOf` (the
/// row's id) where the caller gives one, so a row added or removed above it
/// from outside moves it, not the focus (Pair 24 review, Minor 1); without
/// one, by its index. Rows need a `key`.
export function WindowedRows({ count, estimate, row, keyOf, scroll = "self", children, ...rest }: {
  count: number;
  estimate: number;
  row: (index: number) => ReactNode;
  /** A row's id, as its `key`: the focused row is held by it. */
  keyOf?: (index: number) => string;
  scroll?: "self" | "parent";
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  const own = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement | null>(null);
  const [pitch, setPitch] = useState(estimate);
  const [offset, setOffset] = useState(0);
  // A flex column's gap also sits after a spacer: the spacers give it back,
  // so the rows in view stay where the full list would put them.
  const [gap, setGap] = useState(0);
  // The row that holds focus, by its id (`keyOf`) or else its index, and the
  // row indices in DOM order as last rendered (to map a focused element back
  // to its index).
  const [held, setHeld] = useState<string | number | null>(null);
  const heldAt = useRef(-1);
  const order = useRef<number[]>([]);
  const idOf = (i: number): string | number => (keyOf ? keyOf(i) : i);
  // Where the held row is now: where it was last, or found again after rows
  // came or went (a scan only while a row is held); null once it is gone.
  let focused: number | null = null;
  if (held !== null) {
    if (!keyOf) focused = held as number;
    else if (heldAt.current >= 0 && heldAt.current < count && keyOf(heldAt.current) === held) focused = heldAt.current;
    else for (let i = 0; i < count; i++) if (keyOf(i) === held) { focused = i; break; }
  }
  // A held row that left the list lets go: no scan for it on every render,
  // and no row pinned again when it comes back (an Undo) while focus is elsewhere.
  const gone = held !== null && (focused === null || focused >= count);
  useLayoutEffect(() => {
    heldAt.current = gone ? -1 : focused ?? -1;
    if (gone) setHeld(null);
  });
  // Which element scrolls, before the list hook's own effects read it.
  useLayoutEffect(() => {
    if (own.current) box.current = scroll === "self" ? own.current : scrollingParent(own.current);
  }, [scroll]);
  const { range } = useVirtualList({ count, rowHeight: pitch, scrollRef: box, headerHeight: offset, overscan: 8 });
  // The rows in view, plus the focused row wherever it is.
  const keep = focused !== null && focused < count && (focused < range.start || focused >= range.end) ? focused : null;
  const shownIdx: number[] = [];
  for (let i = range.start; i < range.end; i++) shownIdx.push(i);
  if (keep !== null) shownIdx.splice(keep < range.start ? 0 : shownIdx.length, 0, keep);
  useLayoutEffect(() => { order.current = shownIdx; });
  // The real pitch, and where the rows start inside the scroll box.
  useLayoutEffect(() => {
    const el = own.current;
    const scroller = box.current;
    if (!el || !scroller) return;
    // The rows in view only: a kept focused row sits apart from them (first
    // or last), and the caller's `children` come after them.
    const all = ([...el.children] as HTMLElement[]).filter((c) => !c.hasAttribute("data-vspacer")).slice(0, shownIdx.length);
    const rows = keep === null ? all : keep < range.start ? all.slice(1) : all.slice(0, -1);
    // Measured between the first and the last row in view: a list's first or
    // last row may drop its border (`first:border-t-0`), which would make the
    // pitch change as they come and go; many rows keep a fractional height.
    const n = rows.length;
    const measured = n >= 4 ? (rows[n - 2].offsetTop - rows[1].offsetTop) / (n - 3)
      : n >= 2 ? rows[n - 1].offsetTop - rows[n - 2].offsetTop
      : rows[0]?.offsetHeight ?? 0;
    if (measured > 0 && Math.abs(measured - pitch) > 0.5) setPitch(measured);
    const style = getComputedStyle(el);
    const rowGap = parseFloat(style.rowGap) || 0;
    if (rowGap !== gap) setGap(rowGap);
    const top = scroll === "self"
      ? parseFloat(style.paddingTop) || 0
      : layoutRect(el).top - layoutRect(scroller).top + scroller.scrollTop;
    if (Math.abs(top - offset) > 0.5) setOffset(top);
  });
  // One spacer stands for each run of rows not mounted: `n` rows and the
  // gaps between them (a flex column's gap also sits after it).
  // `shrink-0`: in a flex column of capped height an empty spacer would shrink away.
  const spacer = (n: number, key: string) => (
    <div key={key} data-vspacer aria-hidden="true" className="shrink-0" style={{ height: n * pitch - gap }} />
  );
  const shown: ReactNode[] = [];
  let next = 0;
  for (const i of shownIdx) {
    if (i > next) shown.push(spacer(i - next, next === 0 ? "vspacer-before" : "vspacer-between"));
    shown.push(row(i));
    next = i + 1;
  }
  if (count > next) shown.push(spacer(count - next, "vspacer-after"));
  // Which row took focus: the root's child that holds it, by its place
  // among the rows as rendered.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    rest.onFocus?.(e);
    const el = own.current;
    let child = e.target as HTMLElement | null;
    while (child && child.parentElement !== el) child = child.parentElement;
    if (!el || !child || child.hasAttribute("data-vspacer")) return;
    const at = ([...el.children] as HTMLElement[]).filter((c) => !c.hasAttribute("data-vspacer")).indexOf(child);
    const i = order.current[at];
    if (i === undefined) return;
    heldAt.current = i;
    const id = idOf(i);
    if (id !== held) setHeld(id);
  };
  // Focus that moves elsewhere lets the row go; a window that loses focus
  // (no new target) keeps it, since the row still holds the focus.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    rest.onBlur?.(e);
    const to = e.relatedTarget as Node | null;
    if (to && !own.current?.contains(to)) setHeld(null);
  };
  return (
    <div ref={own} data-windowed {...rest} onFocus={onFocus} onBlur={onBlur}>
      {shown}
      {children}
    </div>
  );
}
