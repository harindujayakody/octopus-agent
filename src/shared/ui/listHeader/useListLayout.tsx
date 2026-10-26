import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn, Tooltip, type DataListColumn, type DataListLayout, type MenuItem } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../i18n";
import {
  defaultSet, fromStored, isDefaultSet, keptWidth, layoutColumns, sameWidths, toStored,
  type ColumnDef, type ColumnFit, type ColumnFits, type ColumnSet, type ColumnWidths, type ColumnsApi,
  type ContentWidths, type FontRole,
} from "../../lib/tableColumns";
import { useSideScroll } from "../../lib/useSideScroll";
import { SELECT_TRACK } from "../../lib/selectionMode";
import { ListHeader, LIST_HEADER_HEIGHT, type ColumnSort } from "./ListHeader";
import { useAutoWidths } from "./useAutoWidths";

/// A column of a list drawn by the kit `DataList` (F5): the column model's
/// definition (`ColumnDef`: its title, the width it needs, its range, whether
/// it hides or moves) and what its cells show.
export type ListColumnDef<Id extends string, Row> = ColumnDef<Id> & {
  /** The cell's text, in `role`'s font (the row's `ui` by default): the
   *  column sizes itself to it, and with no `cell` it is the cell, cut to
   *  the column and whole in a tooltip (`whenTruncated`). */
  text?: (row: Row) => string;
  role?: FontRole;
  /** A cell that is more than its text; `fit` (else `text`) then sizes it. */
  cell?: (row: Row) => ReactNode;
  fit?: ColumnFit<Row>;
  /** Orders the rows by this column: its menu offers Ascending and Descending. */
  compare?: (a: Row, b: Row) => number;
  className?: string;
};

/** The column the rows are ordered by, and which way; null: the list's own order. */
export type ListSort<Id extends string> = { id: Id; dir: "ascending" | "descending" } | null;

type Saved<Id extends string> = { set: ColumnSet<Id>; widths: ColumnWidths<Id>; sort: ListSort<Id> };

/** A text cell's classes by role: the fonts `readFonts` measures them in. */
const ROLE_CLASS: Record<FontRole, string> = {
  ui: "",
  secondary: "text-secondary text-text-sub-600",
  medium: "text-secondary font-medium",
  mono: "text-mono text-text-sub-600",
  tabular: "text-secondary tabular-nums text-text-sub-600",
};

/** The rows' metrics (the kit DataList's): the select box, the gap between
 *  tracks, both side paddings, px. A list that selects keeps the select
 *  box's column in every state (owner, 2026-10-07). */
const LEAD = 28;
const GAP = 10;
const PADDING = 24;

function load<Id extends string, Row>(key: string, defs: readonly ListColumnDef<Id, Row>[]): Saved<Id> {
  let raw: unknown = null;
  try { raw = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { /* a broken value: the defaults */ }
  // A sort alone keeps the default columns.
  const got = fromStored(defs, raw) ?? { set: defaultSet(defs), widths: {} };
  const s = raw && typeof raw === "object" ? (raw as { sort?: { id?: unknown; dir?: unknown } | null }).sort : null;
  const sortable = defs.some((d) => d.id === s?.id && d.compare);
  const dir = s?.dir;
  const sort: ListSort<Id> = s && sortable && (dir === "ascending" || dir === "descending") ? { id: s.id as Id, dir } : null;
  return { ...got, sort };
}

/** Written at once, in the act that changed it, as the Profiles and Proxies layouts are. */
function persist<Id extends string>(key: string, saved: Saved<Id>) {
  try { localStorage.setItem(key, JSON.stringify({ ...toStored(saved.set, saved.widths), sort: saved.sort })); } catch { /* private mode */ }
}

const textFit = <Row,>(text: (row: Row) => string, role: FontRole): ColumnFit<Row> => (row, m) => {
  const s = text(row);
  return s ? m(s, role) : 0;
};

const textCell = <Row,>(text: (row: Row) => string, role: FontRole) => (row: Row): ReactNode => {
  const s = text(row);
  if (!s) return <span className="text-text-soft-400">—</span>;
  return (
    <Tooltip content={s} whenTruncated>
      <span className={cn("block truncate", ROLE_CLASS[role])}>{s}</span>
    </Tooltip>
  );
};

/// The layout a list on the kit DataList keeps (owner, 2026-09-30): every
/// choice a person makes (column widths, order, shown columns, sort) is saved
/// under `storageKey` in localStorage and comes back after a restart, as the
/// Profiles and Proxies layouts do, on the same column model
/// (`tableColumns.ts`) and the same header (`ListHeader`: drag an edge, drag
/// a title, a column's menu, the Columns checklist, Reset columns). Columns
/// size themselves to their content until a person resizes them
/// (`useAutoWidths`: nine rows in ten, a header floor), give way before the
/// list scrolls sideways, and a cut cell shows whole on hover. Hand the
/// result to the DataList:
///   const list = useListLayout({ storageKey: "shardx.trash.layout", defs, items, selectable: true, tail: 72, actionsLabel })
///   <DataList items={list.items} columns={list.columns} layout={list.layout} … />
export function useListLayout<Id extends string, Row>({ storageKey, defs, items, sizingRows = items, selectable, tail, actionsLabel, headerHeight = LIST_HEADER_HEIGHT }: {
  /** Where the choices are saved: `shardx.<list>.layout`. */
  storageKey: string;
  /** A module constant: a new array measures again. */
  defs: readonly ListColumnDef<Id, Row>[];
  /** The rows the list shows, in their own order; they come back sorted. */
  items: readonly Row[];
  /** The rows the columns size to (memoized): the list before its search,
   *  so typing never moves a column. `items` by default. */
  sizingRows?: readonly Row[];
  /** Whether the list selects (it has a select box). */
  selectable: boolean;
  /** The actions track's least width, px: the row's hover actions and its More button. */
  tail: number;
  /** Names the actions column's header cell. */
  actionsLabel: string;
  /** The header row's height, px: `LIST_HEADER_HEIGHT` unless the list's
   *  own was shorter before Phase B (owner: nothing grows). */
  headerHeight?: number;
}): { columns: DataListColumn<Row>[]; layout: DataListLayout; items: readonly Row[] } {
  const t = useT();
  const [saved, setSaved] = useState(() => load(storageKey, defs));
  // The latest choices (every change goes through `save`), so two widths set
  // in one gesture (a dragged edge) both stay.
  const latest = useRef(saved);
  const save = (next: Saved<Id>) => { latest.current = next; persist(storageKey, next); setSaved(next); };
  const [content, setContent] = useState<ContentWidths<Id>>({ fit: {}, full: {} });
  const [listWidth, setListWidth] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  useSideScroll(scrollRef, gridRef, setListWidth);
  const byId = useMemo(() => new Map(defs.map((d) => [d.id, d])), [defs]);

  const table = useMemo(
    () => layoutColumns(defs, saved.set, saved.widths, {
      lead: selectable ? LEAD : 0, leadTrack: SELECT_TRACK,
      tail, gap: GAP, padding: PADDING, available: listWidth, auto: content.fit, full: content.full,
    }),
    [defs, saved.set, saved.widths, selectable, tail, listWidth, content],
  );

  const fits = useMemo(() => {
    const out: ColumnFits<Id, Row> = {};
    for (const d of defs) {
      const fit = d.fit ?? (d.text ? textFit(d.text, d.role ?? "ui") : undefined);
      if (fit) out[d.id] = fit;
    }
    return out;
  }, [defs]);
  useAutoWidths({
    defs,
    shown: table.shown,
    rows: sizingRows,
    fits,
    listRef: scrollRef,
    sortable: (id) => !!byId.get(id)?.compare,
    onWidths: (w) => setContent((prev) => (sameWidths(prev.fit, w.fit) && sameWidths(prev.full, w.full) ? prev : w)),
  });

  const sorted = useMemo(() => {
    const d = saved.sort ? byId.get(saved.sort.id) : undefined;
    if (!saved.sort || !d?.compare) return items;
    const k = saved.sort.dir === "ascending" ? 1 : -1;
    return [...items].sort((a, b) => k * d.compare!(a, b));
  }, [items, saved.sort, byId]);

  const api: ColumnsApi<Id> = {
    defs,
    set: saved.set,
    widths: saved.widths,
    setSet: (set) => save({ ...saved, set }),
    setWidth: (id, px) => {
      const widths = { ...latest.current.widths };
      if (px === null) delete widths[id];
      else widths[id] = keptWidth(byId.get(id)!, px);
      save({ ...latest.current, widths });
    },
    // Reset columns puts the order back too: a sort is a column menu's choice.
    reset: () => save({ set: defaultSet(defs), widths: {}, sort: null }),
    pristine: isDefaultSet(defs, saved.set) && Object.keys(saved.widths).length === 0 && saved.sort === null,
  };
  const sort: ColumnSort<Id> = {
    of: (id) => (saved.sort?.id === id ? saved.sort.dir : undefined),
    items: (id) => (byId.get(id)?.compare
      ? (["ascending", "descending"] as const).map((dir): MenuItem => ({
        type: "radio",
        label: dir === "ascending" ? t("tableColumns.sortAscending") : t("tableColumns.sortDescending"),
        checked: saved.sort?.id === id && saved.sort.dir === dir,
        onSelect: () => save({ ...saved, sort: { id, dir } }),
      }))
      : []),
  };

  const columns = useMemo(
    () => defs.map((d): DataListColumn<Row> => ({
      id: d.id,
      header: d.title(t),
      width: `${d.need}px`,
      cell: d.cell ?? textCell(d.text ?? (() => ""), d.role ?? "ui"),
      className: d.className,
    })),
    [defs, t],
  );

  // Name pins beside the select box, or at the card's left in a list that
  // selects nothing (app.css `data-no-lead`; F24, the Pair 31 carry).
  const pinsName = table.pinFirst;
  const layout: DataListLayout = {
    template: table.template,
    order: table.shown,
    minWidth: table.minWidth,
    headerHeight,
    scrollRef,
    gridRef,
    header: (lead) => (
      <ListHeader api={api} layout={table} listRef={scrollRef} wrapRef={gridRef} lead={lead} actionsLabel={actionsLabel} sort={sort} height={headerHeight} />
    ),
    scroll: {
      className: "list-pin-scroll",
      style: {
        "--pin-start": `${pinsName ? table.pinStart : PADDING / 2 + (selectable ? LEAD + GAP : 0)}px`,
        "--pin-end": `${table.pinEnd}px`,
      } as CSSProperties,
      "data-pin-first": pinsName || undefined,
      "data-no-lead": !selectable || undefined,
    },
    pin: { lead: "list-pin-check", first: pinsName ? "list-pin-name" : undefined, end: "list-pin-end" },
  };

  return { columns, layout, items: sorted };
}
