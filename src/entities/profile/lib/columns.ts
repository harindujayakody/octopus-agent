import {
  defaultSet, fromStored, normalizeSet, toStored,
  type ColumnDef, type ColumnSet, type ColumnWidths, type TFn,
} from "../../../shared/lib/tableColumns";
import type { ProfileSort } from "./listing";

/** The Profiles list's data columns. */
export type ProfileColumnId =
  | "name" | "status" | "folder" | "tags" | "proxy" | "engine"
  | "lastRun" | "created" | "runTime" | "device" | "extensions"
  | "notes";
/** Which Profiles columns show and in what order: what a View saves. */
export type ProfileColumns = ColumnSet<ProfileColumnId>;
/** The list's column widths, px (never a View's). */
export type ProfileColumnWidths = ColumnWidths<ProfileColumnId>;

/// Px, not rem: the app's root font is 14 px. Most widths come from the
/// data (below), so whether the default set fits a window depends on it:
/// wider than its card (beside Peek, a small window, long proxy hosts), the
/// columns no one sized give way first: Notes, then the rest, each down to
/// its minimum or its folded content (Tags one chip and "+N", Folder its
/// chip, Proxy its flag and about ten characters: profileFits.ts), Name last,
/// and only when that ends the scroll; only then does the list scroll
/// sideways inside it (review M7; controller rulings 2026-09-30, Pair 31,
/// merge point 4).
/// Status is never truncated:
/// it is as wide as its widest pill, and never gives way below it. In
/// English that pill, "Proxy missing" (94 px), fits the 96 px minimum (Live
/// layer, joined at merge point 3); Russian's words widen it. Every other
/// column sizes itself to its content until a person resizes it (owner,
/// 2026-09-30: widgets/ProfileTable/profileFits.ts). The spare room first
/// lets a cut one show whole, then stretches every column (owner,
/// 2026-10-23; `need` is a column's width until its content is measured). Name leads, never hides and stays pinned while the list
/// scrolls sideways; Status never hides (it carries the row's state words:
/// Running, Starting, Proxy missing); Proxy never hides either
/// (owner, 2026-10-07, item 11).
// Name's minimum is 116 (120 before the list sat on a tile): the tile's 4 px
// inset takes 6 px of the list's room, and at 1024 with the select column
// open the columns at their floors were 1 px past it, which scrolled the
// list sideways. The least Name gives way to moves 4 px; nothing at the
// default window changes.
export const PROFILE_COLUMNS: readonly ColumnDef<ProfileColumnId>[] = [
  { id: "name", title: (t) => t("profileTable.colName"), need: 150, min: 116, max: 640, shown: true, hideable: false, movable: false },
  { id: "status", title: (t) => t("profileTable.colStatus"), need: 96, min: 96, max: 240, grow: 24, shown: true, hideable: false, movable: true },
  { id: "folder", title: (t) => t("profileTable.colFolder"), need: 110, min: 72, max: 320, shown: true, hideable: true, movable: true },
  { id: "tags", title: (t) => t("profileTable.colTags"), need: 96, min: 64, max: 480, shown: true, hideable: true, movable: true },
  { id: "proxy", title: (t) => t("profileTable.colProxy"), need: 110, min: 80, max: 480, shown: true, hideable: false, movable: true },
  // The browser it starts in, with its logo (owner, 2026-10-27): in Display,
  // off until chosen, so the default set still fits a 1024 px window.
  { id: "engine", title: (t) => t("profileTable.colEngine"), need: 120, min: 72, max: 240, grow: 24, shown: false, hideable: true, movable: true },
  // New with the owner feature (2026-09-26): hidden until chosen, placed
  // before Notes (Notes stays last: the row actions float over it). Run
  // time is wide enough for "1234 小时 59 分钟".
  { id: "lastRun", title: (t) => t("profileTable.colLastRun"), need: 96, min: 72, max: 240, grow: 24, shown: false, hideable: true, movable: true },
  { id: "created", title: (t) => t("profileTable.colCreated"), need: 96, min: 72, max: 240, grow: 24, shown: false, hideable: true, movable: true },
  { id: "runTime", title: (t) => t("profileTable.colRunTime"), need: 112, min: 72, max: 240, grow: 24, shown: false, hideable: true, movable: true },
  { id: "device", title: (t) => t("profileTable.colDevice"), need: 80, min: 64, max: 200, grow: 24, shown: false, hideable: true, movable: true },
  { id: "extensions", title: (t) => t("profileTable.colExtensions"), need: 84, min: 64, max: 200, grow: 24, shown: false, hideable: true, movable: true },
  { id: "notes", title: (t) => t("profileTable.colNotes"), need: 100, fill: true, min: 64, max: 640, shown: true, hideable: true, movable: true },
];

export const PROFILE_COLUMN = Object.fromEntries(PROFILE_COLUMNS.map((d) => [d.id, d])) as Record<ProfileColumnId, ColumnDef<ProfileColumnId>>;

/** The select box and the row actions around the data columns, the gap
 *  between tracks and the row's side padding (both sides), px. */
export const PROFILE_TABLE = { lead: 28, tail: 108, gap: 10, padding: 24 } as const;

const LAYOUT_KEY = "shardx.profiles.layout";
/** Before the model: `{ folder, tags, notes }` booleans, and `lastRun`
 *  (the old column 5d folded into Status). Read once, never written again,
 *  and left in place for an older build. */
const OLD_KEY = "shardx.profiles.columns";

const parse = (key: string): unknown => {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
};

/// Columns saved as the old booleans (the list, or a View), in the model's
/// shape: the default order, with what was off hidden. `lastRun` is not
/// carried over: it named the old column Status replaced, not the new one.
export function fromOldColumns(raw: unknown): ProfileColumns {
  const set = defaultSet(PROFILE_COLUMNS);
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const off = (["folder", "tags", "notes"] as const).filter((k) => r[k] === false);
  return { order: set.order, hidden: [...set.hidden.filter((id) => !(off as readonly string[]).includes(id)), ...off] };
}

/** A View's saved columns, in either shape; anything else is the default. */
export function readProfileColumns(raw: unknown): ProfileColumns {
  if (raw && typeof raw === "object" && Array.isArray((raw as { order?: unknown }).order)) return normalizeSet(PROFILE_COLUMNS, raw);
  if (raw && typeof raw === "object") return fromOldColumns(raw);
  return defaultSet(PROFILE_COLUMNS);
}

/** The list's own columns and widths: the stored layout, else the old booleans, else the defaults. */
export function loadProfileLayout(): { columns: ProfileColumns; widths: ProfileColumnWidths } {
  const now = fromStored(PROFILE_COLUMNS, parse(LAYOUT_KEY));
  if (now) return { columns: now.set, widths: now.widths };
  const old = parse(OLD_KEY);
  if (old && typeof old === "object") return { columns: fromOldColumns(old), widths: {} };
  return { columns: defaultSet(PROFILE_COLUMNS), widths: {} };
}

/** Written at once, inside the action that changed it: a reload right after
 *  a click reads the new value, with nothing debounced to race it. */
export function persistProfileLayout(columns: ProfileColumns, widths: ProfileColumnWidths): void {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(toStored(columns, widths))); } catch { /* private mode */ }
}

/// A column's own orders, for its menu and its sort mark: the Display
/// menu's orders, by the column they read. Status orders running first,
/// neither up nor down ("other").
export const PROFILE_SORTS: Partial<Record<ProfileColumnId, { sort: ProfileSort; dir: "ascending" | "descending" | "other"; label: (t: TFn) => string }[]>> = {
  name: [
    { sort: "name-asc", dir: "ascending", label: (t) => t("profileFilterBar.orderNameAsc") },
    { sort: "name-desc", dir: "descending", label: (t) => t("profileFilterBar.orderNameDesc") },
  ],
  status: [{ sort: "status", dir: "other", label: (t) => t("profileFilterBar.orderStatus") }],
  lastRun: [{ sort: "launched-desc", dir: "descending", label: (t) => t("profileFilterBar.orderLaunched") }],
  created: [
    { sort: "created-desc", dir: "descending", label: (t) => t("profileFilterBar.orderNewest") },
    { sort: "created-asc", dir: "ascending", label: (t) => t("profileFilterBar.orderOldest") },
  ],
  runTime: [{ sort: "runtime-desc", dir: "descending", label: (t) => t("profileFilterBar.orderRuntime") }],
};

/** Cells edited in place from the row (owner feature 2026-09-26). Name is
 *  renamed with E, the row menu and Peek; the new columns are read-only. */
export const PROFILE_EDITABLE: ReadonlySet<ProfileColumnId> = new Set<ProfileColumnId>(["folder", "tags", "proxy", "notes"]);
/** The row actions that float over the last column: Pin, Edit, Clone, Move to Trash. */
export const PROFILE_FLOATING_ACTIONS = 4;
