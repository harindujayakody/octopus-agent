import { useMemo } from "react";
import { create } from "zustand";
import {
  defaultSet, fromStored, keptWidth, layoutColumns, sameWidths, toStored,
  type ColumnDef, type ColumnSet, type ColumnWidths, type ColumnsApi, type ContentWidths, type TableLayout,
} from "../../../shared/lib/tableColumns";
import { SELECT_TRACK } from "../../../shared/lib/selectionMode";

/** The Proxies list's data columns. */
export type ProxyColumnId = "name" | "type" | "address" | "country" | "profiles" | "test";
/** Which Proxies columns show, and in what order. */
export type ProxyColumns = ColumnSet<ProxyColumnId>;

/// Px, as the Profiles list's. Name leads, never hides and stays pinned
/// while the list scrolls sideways (a proxy without a name reads as its
/// address there). Every column sizes itself to its content until a person
/// resizes it (owner, 2026-09-30; see proxyFits.ts in widgets/ProxyList);
/// the spare room first lets a cut one show whole, then gives every column
/// but the last the same px past its content (no Notes here). Every chosen column stays: wider
/// than its card, the list scrolls sideways inside it. Live layer (Task 6):
/// Type holds its widest protocol chip, SOCKS5 (60 px), even at its
/// narrowest; proxyFits.ts measures the Test result and Type pills.
export const PROXY_COLUMNS: readonly ColumnDef<ProxyColumnId>[] = [
  { id: "name", title: (t) => t("proxyTable.colName"), need: 140, min: 100, max: 480, shown: true, hideable: false, movable: false },
  { id: "type", title: (t) => t("proxyTable.colType"), need: 64, min: 60, max: 160, shown: true, hideable: true, movable: true },
  { id: "address", title: (t) => t("proxyTable.colHostPort"), need: 150, min: 120, max: 480, shown: true, hideable: true, movable: true },
  { id: "country", title: (t) => t("proxyTable.colCountry"), need: 120, min: 72, max: 240, shown: true, hideable: true, movable: true },
  { id: "profiles", title: (t) => t("proxyTable.colProfiles"), need: 64, min: 56, max: 160, shown: true, hideable: true, movable: true },
  { id: "test", title: (t) => t("proxyTable.colTestResult"), need: 120, min: 96, max: 320, shown: true, hideable: true, movable: true },
];
const PROXY_COLUMN = Object.fromEntries(PROXY_COLUMNS.map((d) => [d.id, d])) as Record<ProxyColumnId, ColumnDef<ProxyColumnId>>;

/** The select box and the header's Columns button around the data columns,
 *  the gap and the row's side padding, px. The row actions take no track:
 *  they float over the row's end on hover or focus, as Profiles' hover strip
 *  does (controller ruling, merge point 3: the 64 px they held cut "Frankfurt
 *  am Main" at 1280). The 24 px is the Columns button's own (ListHeader). */
export const PROXY_TABLE = { lead: 28, tail: 24, gap: 10, padding: 24 } as const;

const KEY = "shardx.proxies.layout";

function load(): { columns: ProxyColumns; widths: ColumnWidths<ProxyColumnId> } {
  let raw: unknown = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { /* broken value: the defaults */ }
  const got = fromStored(PROXY_COLUMNS, raw);
  return got ? { columns: got.set, widths: got.widths } : { columns: defaultSet(PROXY_COLUMNS), widths: {} };
}

/** Written at once, in the action that changed it, as the Profiles layout is. */
function persist(columns: ProxyColumns, widths: ColumnWidths<ProxyColumnId>) {
  try { localStorage.setItem(KEY, JSON.stringify(toStored(columns, widths))); } catch { /* private mode */ }
}

type ProxyColumnsStore = {
  columns: ProxyColumns;
  widths: ColumnWidths<ProxyColumnId>;
  /** The widths the columns take from their content (`useAutoWidths`),
   *  never saved; one in `widths` wins. */
  autoWidths: ColumnWidths<ProxyColumnId>;
  /** The widths every row fits in, never saved: a column cut at its
   *  content width grows toward it with the room left over. */
  fullWidths: ColumnWidths<ProxyColumnId>;
  /** The Test result's width with its IP in the pill's tooltip, never saved. */
  shortWidths: ColumnWidths<ProxyColumnId>;
  /** The list's inner width, px (null until measured): whether Name can
   *  stay pinned while the list scrolls sideways. */
  listWidth: number | null;
  setColumns: (next: ProxyColumns) => void;
  setColumnWidth: (id: ProxyColumnId, px: number | null) => void;
  resetColumns: () => void;
  setAutoWidths: (widths: ContentWidths<ProxyColumnId>) => void;
  setListWidth: (px: number) => void;
};

/// The Proxies list's columns (owner feature 2026-09-26): the person's
/// choice replaces the old "hide four beside Peek" rule and is remembered.
/// Proxies has no Views, so the set and the widths live together.
export const useProxyColumns = create<ProxyColumnsStore>((set, get) => ({
  ...load(),
  autoWidths: {},
  fullWidths: {},
  shortWidths: {},
  listWidth: null,
  setColumns: (columns) => { persist(columns, get().widths); set({ columns }); },
  setColumnWidth: (id, px) => {
    const widths = { ...get().widths };
    if (px === null) delete widths[id];
    else widths[id] = keptWidth(PROXY_COLUMN[id], px);
    persist(get().columns, widths);
    set({ widths });
  },
  resetColumns: () => {
    const columns = defaultSet(PROXY_COLUMNS);
    persist(columns, {});
    set({ columns, widths: {} });
  },
  setAutoWidths: ({ fit, full, short = {} }) => {
    const s = get();
    if (!sameWidths(s.autoWidths, fit) || !sameWidths(s.fullWidths, full) || !sameWidths(s.shortWidths, short)) {
      set({ autoWidths: fit, fullWidths: full, shortWidths: short });
    }
  },
  setListWidth: (listWidth) => { if (get().listWidth !== listWidth) set({ listWidth }); },
}));

/** The Proxies columns and their grid: every chosen one, as wide as a
 *  person made it or else as its content needs; too wide for the list, the
 *  ones no one sized give way first, and its width decides whether Name
 *  stays pinned while it scrolls sideways. */
export function useProxyLayout(): TableLayout<ProxyColumnId> {
  const columns = useProxyColumns((s) => s.columns);
  const widths = useProxyColumns((s) => s.widths);
  const auto = useProxyColumns((s) => s.autoWidths);
  const full = useProxyColumns((s) => s.fullWidths);
  const short = useProxyColumns((s) => s.shortWidths);
  const available = useProxyColumns((s) => s.listWidth);
  return useMemo(
    () => layoutColumns(PROXY_COLUMNS, columns, widths, { ...PROXY_TABLE, leadTrack: SELECT_TRACK, available, auto, full, short }),
    [columns, widths, auto, full, short, available],
  );
}

/** The Proxies columns for the list header. */
export function useProxyColumnsApi(): ColumnsApi<ProxyColumnId> {
  const columns = useProxyColumns((s) => s.columns);
  const widths = useProxyColumns((s) => s.widths);
  return useMemo(() => {
    const s = useProxyColumns.getState();
    return { defs: PROXY_COLUMNS, set: columns, widths, setSet: s.setColumns, setWidth: s.setColumnWidth, reset: s.resetColumns };
  }, [columns, widths]);
}
