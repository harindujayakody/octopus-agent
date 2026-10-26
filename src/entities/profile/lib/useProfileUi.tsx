import { create } from "zustand";
import type { ProfileMeta } from "../model/types";
import {
  applyProfileFilters, emptyFilters, folderNamesOf, loadSort, persistSort, proxyIdOf,
  type ProfileFilters, type ProfileSort, type ProxyFilter,
} from "./listing";
import {
  loadProfileLayout, persistProfileLayout, PROFILE_COLUMN, PROFILE_COLUMNS,
  type ProfileColumnId, type ProfileColumns, type ProfileColumnWidths,
} from "./columns";
import { defaultSet, keptWidth, sameWidths, type ContentWidths } from "../../../shared/lib/tableColumns";
import { setOnAssign, setOnFolderRenamed, setUiBridge, useProfile } from "./useProfile";
import { findView, sameQuery, viewOwnFilters, viewQuery, type ViewContext, type ViewQuery } from "./views";
import { tagsOf, useTags } from "../../tag";
import { useNav } from "../../../shared/model/navigation";
import { focusProfileRow } from "../../../shared/lib/focusRow";
import { minuteNow } from "../../../shared/lib/useNow";
import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { confirmLeave } from "../../../shared/model/unsaved";
import { onSpaceMoved } from "../../../shared/api/invoke";
import { computeVisible, needsRunning, NO_RUNNING, type Visible } from "./visible";
import { resolveId } from "./optimistic";
import type { AssignFrom } from "./assignment";

/** A cell being edited in place. `keyed`: a row key (P) started it, not a
 *  click on the cell or its edit button — the amended focus-return ruling
 *  (merge-columns-fix1.md) sends the keyboard back to the row for that case,
 *  never to a button the row key never touched. */
export type InlineEdit = { id: string; field: "name" | "notes" | "proxy"; keyed?: boolean };
/** The folder picker, the profiles it moves, and who opened it: the list
 *  (`M`, a row's menu) or the bulk bar, each of which shows it under its own
 *  control. */
export type FolderPickerTarget = { profileIds: string[]; from: "list" | "bar" };
/** The Folder dialog: a new Folder, or the look and name of an existing one.
 *  A new Folder may come prefilled with a name typed in the folder picker;
 *  `moveIds` move into it once it exists (one place makes a Folder). */
export type FolderDialogTarget = { mode: "create"; name?: string; moveIds?: string[] } | { mode: "edit"; name: string };
/** The View dialog: save the list as a new View, or rename one. */
export type ViewDialogTarget = { mode: "save" } | { mode: "rename"; id: string };
/** The tag picker, the profiles it acts on, and who opened it: the list (`T`)
 *  or the bulk bar, each of which shows it under its own control. `keyed`:
 *  the list's own `T` opened it (not a click on the Tags cell, its edit
 *  button, or the row menu) — the amended focus-return ruling
 *  (merge-columns-fix1.md) sends the keyboard back to the row for that case,
 *  never to the Tags edit button the key never touched. */
export type TagPickerTarget = { profileIds: string[]; from: "list" | "bar"; keyed?: boolean };
/** Assign proxies: the profiles it acts on. */
/** `from`: opened on proxies (the Proxies page), where `ids` is empty and
 *  the dialog asks for the profiles. */
export type AssignTarget = { ids: string[]; from?: AssignFrom };

/// What the Profiles list shows and what is open on it. The data itself and
/// every backend call live in `useProfile`.
export type ProfileUiStore = {
  search: string;
  folder: string;
  filters: ProfileFilters;
  sort: ProfileSort;
  /** The list's columns: which show and in what order (a View carries its own). */
  columns: ProfileColumns;
  /** Column widths set by dragging an edge: the list's, never a View's. */
  widths: ProfileColumnWidths;
  /** The widths the columns take from their content (owner, 2026-09-30:
   *  `useAutoWidths`), never saved; one in `widths` wins. */
  autoWidths: ProfileColumnWidths;
  /** The widths every row fits in, never saved: a column cut at its
   *  content width grows toward it with the room left over. */
  fullWidths: ProfileColumnWidths;
  /** The least the folding columns give way to (Tags: one chip and "+N"),
   *  never saved (`ContentWidths.floor`). */
  floorWidths: ProfileColumnWidths;
  /** The list's inner width, px (null until measured): whether Name can stay
   *  pinned while the list scrolls sideways (`TableLayout.pinFirst`). */
  listWidth: number | null;
  /** The list narrowed to the profiles a problem card names, from its click:
   *  its chip's words and the ids at that moment, so the list shows what the
   *  card counted. Cleared with the filters, and by a Folder or View change. */
  only: { label: string; ids: ReadonlySet<string> } | null;
  setOnly: (only: { label: string; ids: readonly string[] } | null) => void;
  /** The View applied to the list, or null. */
  viewId: string | null;
  /** The custom View whose own filters are open for change ("Edit view"): they
   *  show as chips and their fields are free, until it is saved or cancelled. */
  viewEdit: string | null;
  /** The list's own query, kept while a View is applied and given back when it is left. */
  base: ViewQuery | null;
  selected: Set<string>;
  /// Row the last plain click landed on; a shift-click selects the run from it.
  anchorId: string | null;
  /// The row the keyboard acts on; it holds focus while the list has it.
  activeId: string | null;
  /// The pointer passing over it made `activeId` active: the keys act on it
  /// (O5), but the palette's first group does not (Pair 44 ruling).
  activeByPointer: boolean;
  /// Bumped by `reveal`: the list scrolls the active row into view each time.
  revealSeq: number;
  /// Folder highlighted as a drag-and-drop target ("__all__" for All Profiles).
  /// Cleared in dragleave/drop.
  dropTarget: string | null;
  /// The profile Peek shows, or null when Peek is closed.
  peekId: string | null;
  folderPicker: FolderPickerTarget | null;
  tagPicker: TagPickerTarget | null;
  folderDialog: FolderDialogTarget | null;
  viewDialog: ViewDialogTarget | null;
  editing: InlineEdit | null;
  assign: AssignTarget | null;
  /** Opens Assign proxies: from the bulk bar, a refused Start, or a deleted proxy's profiles. */
  openAssign: (ids: string[]) => void;
  /** Opens the same dialog from the other side: the Proxies page's "Assign to profiles…". */
  openAssignFrom: (from: AssignFrom) => void;
  closeAssign: () => void;

  setSearch: (q: string) => void;
  /** Shows a Folder ("all" for All Profiles); leaves a View first. */
  setFolder: (f: string) => void;
  /** Puts a View's query on the list. The list's own is kept to give back. */
  applyView: (id: string) => void;
  /** Puts the View's query back after changes (Reset). */
  resetView: () => void;
  /** Opens a custom View for editing: applies it, and unlocks its own filters. */
  editView: (id: string) => void;
  /** Ends editing with the list as it is (after the View was saved). */
  finishViewEdit: () => void;
  /** Ends editing and puts the View back as it was saved. */
  cancelViewEdit: () => void;
  /** Leaves the View: the list's own Folder, filters, order and columns come back. */
  leaveView: () => void;
  /** A Folder renamed (or gone, `to` = "all") where the list or its kept
   *  query shows it: the new name, without leaving a View. */
  followFolderRename: (from: string, to: string) => void;
  setFilters: (f: Partial<ProfileFilters>) => void;
  setSort: (v: ProfileSort) => void;
  setColumns: (next: ProfileColumns) => void;
  /** A column's width, px; null gives it back to its content's width. */
  setColumnWidth: (id: ProfileColumnId, px: number | null) => void;
  setAutoWidths: (widths: ContentWidths<ProfileColumnId>) => void;
  /** Every column back to its default place, visibility and width. */
  resetColumns: () => void;
  setListWidth: (px: number) => void;
  /** Clears the filters a person added (all of them outside a View; inside
   *  one, the View's own stay: `viewFilters`) and the problem card's chip. */
  clearFilters: () => void;
  setDropTarget: (target: string | null) => void;
  setTagPicker: (target: TagPickerTarget | null) => void;
  startEdit: (id: string, field: InlineEdit["field"], opts?: { keyed?: boolean }) => void;
  stopEdit: () => void;
  setFolderPicker: (target: FolderPickerTarget | null) => void;
  setFolderDialog: (target: FolderDialogTarget | null) => void;
  setViewDialog: (target: ViewDialogTarget | null) => void;

  /** `pointer`: the pointer passing over the row made it active, nothing else. */
  setActive: (id: string | null, opts?: { pointer?: boolean }) => void;
  /** Makes a row active and asks the list to scroll it into view. */
  reveal: (id: string) => void;
  /** Opens the Profiles page on this profile: All Profiles, with a search or
   *  filter that would hide it cleared, the row active and focused. False
   *  when nothing was shown: no such profile, or the person stayed on their
   *  page (unsaved changes, Cancel), with the list left as it was. */
  showInList: (id: string) => Promise<boolean>;
  /** Moves the active row; from none, a step down or "first" lands on the first row. */
  moveActive: (to: number | "first" | "last") => void;

  selectProfiles: (isChecked: boolean, profiles: ProfileMeta[]) => void;
  toggleSelect: (id: string) => void;
  /** Shift-click: selects every row between the anchor and `id`. */
  selectRangeTo: (id: string) => void;
  clearSelected: () => void;
  /** Selects every row the list shows. */
  selectAll: () => void;
  /** Shift+Arrow: the active row moves one step and the selection becomes the
   *  run from the anchor to it; a step back shrinks the run (IFACE-05). */
  extendSelection: (step: 1 | -1) => void;
  /** Settles the selection after a delete that may have partly failed:
   *  `pressed` is the selection as it stood when the delete was asked for,
   *  `moved` the ids that actually reached the Trash. `moved` comes out of
   *  the selection; whichever of `pressed` failed and is still in the list
   *  goes back in — a bulk Move to Trash (or the Delete key) never loses a
   *  profile it could not delete (owner fix 1, fix round 1, 2026-09-28).
   *  Anything selected since `pressed` was taken is left alone. */
  settleDeleted: (pressed: string[], moved: string[]) => void;

  /** Opens Peek on a profile (it becomes the active row). */
  openPeek: (id: string) => void;
  closePeek: () => void;
  /** Opens Peek, or closes it when it already shows that profile. */
  togglePeek: (id: string) => void;
};

/// The list as the table paints it, from the stores as they are now: the
/// same cached answer the table renders from (PERF-04), at the same minute.
/// A range, Select all, the keys and the selection all read it.
export function selectVisible(ui: ProfileUiStore = useProfileUi.getState()): Visible {
  const d = useProfile.getState();
  const g = useTags.getState();
  return computeVisible({
    profiles: d.profiles, proxies: d.proxies, search: ui.search, folder: ui.folder, filters: ui.filters,
    running: needsRunning(ui.filters, ui.sort) ? d.running : NO_RUNNING, sort: ui.sort,
    tags: g.tags, byProfile: g.byProfile, proxyIps: d.proxyIps, now: minuteNow(), only: ui.only?.ids ?? null,
  });
}

/** The profile ids the list shows right now, in its order. */
export function visibleProfileIds(): string[] {
  return selectVisible().ids;
}

/** The ids the latest `pruneSelection` took out of the selection: a move's
 *  Undo gives back the ones its rows lost (ruling F13). */
let lastPruned: ReadonlySet<string> = new Set();

/// Keeps the selection to rows the list shows: a Folder switch, a filter or a
/// profile that went away must not leave hidden rows for the bar or Delete to
/// act on. An open picker holds its rows until it closes: taking off the
/// tag a search found them by must not pull them out from under it.
function pruneSelection() {
  lastPruned = new Set();
  const ui = useProfileUi.getState();
  if (ui.selected.size === 0 || ui.tagPicker || ui.folderPicker) return;
  const { indexById } = selectVisible(ui);
  const kept = [...ui.selected].filter((id) => indexById.has(id));
  if (kept.length !== ui.selected.size) {
    lastPruned = new Set([...ui.selected].filter((id) => !indexById.has(id)));
    useProfileUi.setState({ selected: new Set(kept), anchorId: ui.anchorId && indexById.has(ui.anchorId) ? ui.anchorId : null });
  }
}

/** The Folders, tags and proxies there are now. */
function known(): ViewContext {
  const d = useProfile.getState();
  return { folders: folderNamesOf(d.profiles, d.folderRegistry), tagIds: useTags.getState().tags.map((t) => t.id), proxyIds: d.proxies.map((p) => p.id) };
}

/// The applied View's own filters: what the View keeps when the filters a
/// person added on top are cleared. They are part of the View, so the list
/// shows them as one locked label and never as chips. Null outside a View.
export function viewFilters(ui: ProfileUiStore = useProfileUi.getState()): ProfileFilters | null {
  const view = findView(ui.viewId);
  // Being edited, the View's own filters are open like the rest.
  if (!view || ui.viewEdit === view.id) return null;
  return viewOwnFilters(view, ui.base?.columns ?? ui.columns, known());
}

/** Whether the View being edited differs from how it was saved. */
export function viewEditDirty(ui: ProfileUiStore = useProfileUi.getState()): boolean {
  const view = findView(ui.viewId);
  if (!view || ui.viewEdit !== view.id || !ui.base) return false;
  return !sameQuery({ folder: ui.folder, filters: ui.filters, sort: ui.sort, columns: ui.columns }, viewQuery(view, ui.base.columns, known()));
}

/** Runs `go`, a change of what the list shows (a Folder, a View), once it
 *  drops nothing: at once unless a View being edited has unsaved changes,
 *  else after the guard's answer (Save, Don't save, Cancel), and not at all
 *  on Cancel. True when `go` ran. */
export function leaveList(go: () => void): Promise<boolean> {
  if (!viewEditDirty()) {
    go();
    return Promise.resolve(true);
  }
  return confirmLeave().then((ok) => {
    if (ok) go();
    return ok;
  });
}

/// The state that leaves the applied View: the list's own query back. Nothing
/// when no View is applied.
function leaving(ui: ProfileUiStore): Partial<ProfileUiStore> {
  if (!ui.viewId || !ui.base) return { only: null, viewEdit: null };
  return { ...ui.base, viewId: null, base: null, only: null, viewEdit: null };
}

export const useProfileUi = create<ProfileUiStore>((set, get) => ({
  search: "",
  folder: "all",
  filters: emptyFilters(),
  sort: loadSort(),
  ...loadProfileLayout(),
  autoWidths: {},
  fullWidths: {},
  floorWidths: {},
  listWidth: null,
  only: null,
  setOnly: (only) => { set({ only: only ? { label: only.label, ids: new Set(only.ids) } : null }); pruneSelection(); },
  viewId: null,
  viewEdit: null,
  base: null,
  selected: new Set<string>(),
  anchorId: null,
  activeId: null,
  activeByPointer: false,
  revealSeq: 0,
  dropTarget: null,
  peekId: null,
  tagPicker: null,
  setTagPicker: (tagPicker) => { set({ tagPicker }); if (!tagPicker) pruneSelection(); },
  folderPicker: null,
  folderDialog: null,
  viewDialog: null,
  editing: null,
  assign: null,
  openAssign: (ids) => set({ assign: { ids } }),
  openAssignFrom: (from) => set({ assign: from.kind === "profiles" ? { ids: from.profileIds } : { ids: [], from } }),
  closeAssign: () => set({ assign: null }),

  setSearch: (search) => { set({ search }); pruneSelection(); },
  setFolder: (folder) => { set({ ...leaving(get()), folder }); pruneSelection(); },
  applyView: (id) => {
    const view = findView(id);
    const ui = get();
    // The View already applied keeps its changes; Reset drops them.
    if (!view || ui.viewId === id) return;
    const base = ui.base ?? { folder: ui.folder, filters: ui.filters, sort: ui.sort, columns: ui.columns };
    set({ ...viewQuery(view, base.columns, known()), viewId: id, viewEdit: null, base, only: null });
    pruneSelection();
  },
  editView: (id) => {
    const view = findView(id);
    // A built-in cannot change: it keeps Save as a copy.
    if (!view || view.builtin) return;
    get().applyView(id);
    set({ viewEdit: id });
  },
  finishViewEdit: () => set({ viewEdit: null }),
  cancelViewEdit: () => { get().resetView(); set({ viewEdit: null }); },
  resetView: () => {
    const ui = get();
    const view = findView(ui.viewId);
    if (!view || !ui.base) return;
    set(viewQuery(view, ui.base.columns, known()));
    pruneSelection();
  },
  leaveView: () => { if (get().viewId) { set(leaving(get())); pruneSelection(); } },
  followFolderRename: (from, to) => {
    const ui = get();
    set({
      ...(ui.folder === from ? { folder: to } : {}),
      ...(ui.base?.folder === from ? { base: { ...ui.base, folder: to } } : {}),
    });
    pruneSelection();
  },
  setFilters: (f) => { set({ filters: { ...get().filters, ...f } }); pruneSelection(); },
  // Order and columns are remembered for the list itself, not for a View.
  setSort: (v) => { if (!get().viewId) persistSort(v); set({ sort: v }); },
  // The list's own columns are remembered; inside a View a change marks it
  // Modified until Update view saves it (the View's own query).
  setColumns: (columns) => {
    const ui = get();
    if (!ui.viewId) persistProfileLayout(columns, ui.widths);
    set({ columns });
  },
  // Widths belong to the list, not to a View: saved even while one is
  // applied, next to the list's own columns (kept in `base` meanwhile).
  setColumnWidth: (id, px) => {
    const ui = get();
    const widths = { ...ui.widths };
    if (px === null) delete widths[id];
    else widths[id] = keptWidth(PROFILE_COLUMN[id], px);
    persistProfileLayout(ui.viewId && ui.base ? ui.base.columns : ui.columns, widths);
    set({ widths });
  },
  resetColumns: () => {
    const ui = get();
    const columns = defaultSet(PROFILE_COLUMNS);
    persistProfileLayout(ui.viewId && ui.base ? ui.base.columns : columns, {});
    set({ columns, widths: {} });
  },
  setAutoWidths: ({ fit, full, floor = {} }) => {
    const ui = get();
    if (!sameWidths(ui.autoWidths, fit) || !sameWidths(ui.fullWidths, full) || !sameWidths(ui.floorWidths, floor)) {
      set({ autoWidths: fit, fullWidths: full, floorWidths: floor });
    }
  },
  setListWidth: (listWidth) => { if (get().listWidth !== listWidth) set({ listWidth }); },
  // Inside a View only the filters a person added go; the View's own stay.
  clearFilters: () => { set({ filters: viewFilters(get()) ?? emptyFilters(), only: null }); pruneSelection(); },
  setDropTarget: (dropTarget) => set({ dropTarget }),
  startEdit: (id, field, opts) => set({ editing: { id, field, keyed: opts?.keyed }, activeId: id, activeByPointer: false }),
  stopEdit: () => set({ editing: null }),
  setFolderPicker: (folderPicker) => set({ folderPicker }),
  setFolderDialog: (folderDialog) => set({ folderDialog }),
  setViewDialog: (viewDialog) => set({ viewDialog }),

  setActive: (activeId, opts) => {
    const activeByPointer = opts?.pointer === true;
    if (get().activeId !== activeId || get().activeByPointer !== activeByPointer) set({ activeId, activeByPointer });
  },
  reveal: (id) => set({ activeId: id, activeByPointer: false, revealSeq: get().revealSeq + 1 }),
  showInList: async (id) => {
    if (!useProfile.getState().profiles.some((x) => x.id === id)) return false;
    // The page first: Cancel on unsaved changes leaves search, filters and Folder alone.
    if (!(await useNav.getState().setSection("profiles"))) return false;
    // Leaving a View whose edit is unsaved asks first, too.
    if (viewEditDirty() && !(await confirmLeave())) return false;
    const data = useProfile.getState();
    const p = data.profiles.find((x) => x.id === id);
    if (!p) return false;
    get().leaveView();
    const ui = get();
    // A search or filter that would hide it is cleared, or the list would
    // open without the row the user asked for.
    const hidden = applyProfileFilters([p], data.proxies, ui.search, "all", ui.filters, data.running, ui.sort, (id) => tagsOf(id)).length === 0;
    if (hidden) { ui.setSearch(""); ui.clearFilters(); }
    ui.setFolder("all");
    ui.reveal(id);
    focusProfileRow(id);
    return true;
  },
  moveActive: (to) => {
    const { ids, indexById } = selectVisible(get());
    if (ids.length === 0) return;
    const active = get().activeId;
    const at = active ? indexById.get(active) ?? -1 : -1;
    let next: number;
    if (to === "first") next = 0;
    else if (to === "last") next = ids.length - 1;
    else if (at < 0) next = to > 0 ? 0 : ids.length - 1;
    else next = Math.min(ids.length - 1, Math.max(0, at + to));
    set({ activeId: ids[next], activeByPointer: false });
  },

  selectProfiles: (isChecked, profiles) => {
    const next = new Set(get().selected);
    if (isChecked) {
      for (const p of profiles) next.add(p.id);
    } else {
      for (const p of profiles) next.delete(p.id);
    }
    set({ selected: next });
  },
  toggleSelect: (id) => {
    const next = new Set(get().selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    set({ selected: next, anchorId: id });
  },
  // Ordered as the list paints it. The clicked row decides the direction: a
  // ticked one clears the run, an unticked one selects it.
  selectRangeTo: (id) => {
    const { ids: order, indexById } = selectVisible(get());
    const to = indexById.get(id) ?? -1;
    if (to < 0) return;
    const anchor = get().anchorId;
    // Only a still-ticked anchor has a run to extend; spanning back over a
    // cleared one would put its tick straight back.
    const from = anchor && get().selected.has(anchor) ? indexById.get(anchor) ?? -1 : -1;
    if (from < 0) { get().toggleSelect(id); return; }
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    const removing = get().selected.has(id);
    const next = new Set(get().selected);
    for (let i = lo; i <= hi; i++) {
      if (removing) next.delete(order[i]); else next.add(order[i]);
    }
    set({ selected: next });
  },
  // The bar's pickers go with the bar, or the next selection would bring them back.
  clearSelected: () => set((s) => ({
    selected: new Set<string>(), anchorId: null,
    tagPicker: s.tagPicker?.from === "bar" ? null : s.tagPicker,
    folderPicker: s.folderPicker?.from === "bar" ? null : s.folderPicker,
  })),
  selectAll: () => set({ selected: new Set(selectVisible(get()).ids) }),
  extendSelection: (step) => {
    const { ids: order, indexById } = selectVisible(get());
    const active = get().activeId;
    const at = active ? indexById.get(active) ?? -1 : -1;
    if (at < 0) { get().moveActive(step); return; }
    const to = Math.min(order.length - 1, Math.max(0, at + step));
    const { selected, anchorId } = get();
    // A run starts at the active row, unless its anchor is still selected.
    const anchor = anchorId && selected.has(anchorId) && indexById.has(anchorId) ? anchorId : active!;
    const a = indexById.get(anchor)!;
    const next = new Set(selected);
    const [oldLo, oldHi] = a <= at ? [a, at] : [at, a];
    for (let i = oldLo; i <= oldHi; i++) next.delete(order[i]);
    const [lo, hi] = a <= to ? [a, to] : [to, a];
    for (let i = lo; i <= hi; i++) next.add(order[i]);
    set({ selected: next, anchorId: anchor, activeId: order[to], activeByPointer: false });
  },
  settleDeleted: (pressed, moved) => set((s) => {
    const gone = new Set(moved);
    // The pressed ids a failed delete left behind, only if the list still
    // shows them (a Folder or filter change meanwhile wins, same as
    // pruneSelection) — `moveToTrash` hides every pressed id at once, so by
    // the time this runs the failed ones are already back in `profiles`.
    const shown = selectVisible(s).indexById;
    const keepBack = pressed.filter((id) => !gone.has(id) && shown.has(id));
    const selected = new Set(s.selected);
    let changed = false;
    for (const id of gone) { if (selected.delete(id)) changed = true; }
    for (const id of keepBack) { if (!selected.has(id)) { selected.add(id); changed = true; } }
    if (!changed) return {}; // nothing to do: no new Set, no re-render for `selected`'s readers
    return {
      selected,
      anchorId: s.anchorId && gone.has(s.anchorId) ? null : s.anchorId,
      // The bar's own pickers go with the bar, same as clearSelected.
      tagPicker: selected.size === 0 && s.tagPicker?.from === "bar" ? null : s.tagPicker,
      folderPicker: selected.size === 0 && s.folderPicker?.from === "bar" ? null : s.folderPicker,
    };
  }),

  openPeek: (id) => set({ peekId: id, activeId: id, activeByPointer: false }),
  closePeek: () => set({ peekId: null }),
  togglePeek: (id) => (get().peekId === id ? get().closePeek() : get().openPeek(id)),
}));

setOnFolderRenamed((from, to) => useProfileUi.getState().followFolderRename(from, to));
setUiBridge({
  moved: ({ ids, names, from, to, undo }) => {
    // Rows that stay in view show their new Folder themselves.
    const shown = selectVisible();
    if (ids.every((id) => shown.indexById.has(id))) return;
    // The rows already left the list, and the selection with it (the store
    // showed the move just before this): Undo puts them back in both (F13).
    const wereSelected = ids.filter((id) => lastPruned.has(id));
    const one = ids.length === 1;
    const name = names.get(ids[0]) ?? "";
    const text = to
      ? one ? t("useProfile.movedOne", { name, f: to }) : t("useProfile.movedMany", { n: ids.length, f: to })
      : one ? t("useProfile.movedOutOne", { name, f: from.get(ids[0]) ?? "" }) : t("useProfile.movedOutMany", { n: ids.length });
    toast.undo(text, () => {
      // Shows every row back in its Folder before it returns.
      undo();
      const listed = selectVisible().indexById;
      const back = wereSelected.filter((id) => listed.has(id));
      if (back.length > 0) useProfileUi.setState((s) => ({ selected: new Set([...s.selected, ...back]) }));
    });
  },
});
setUiBridge({
  // A row being created got its real id: everything that names it follows.
  idChanged: (from, to) => {
    // A tag given while the profile was being created stays on it.
    useTags.getState().moveProfile(from, to);
    const s = useProfileUi.getState();
    const swap = (id: string | null) => (id === from ? to : id);
    const swapAll = (ids: string[]) => (ids.includes(from) ? ids.map((id) => (id === from ? to : id)) : ids);
    useProfileUi.setState({
      activeId: swap(s.activeId),
      anchorId: swap(s.anchorId),
      peekId: swap(s.peekId),
      selected: s.selected.has(from) ? new Set(swapAll([...s.selected])) : s.selected,
      editing: s.editing?.id === from ? { ...s.editing, id: to } : s.editing,
      tagPicker: s.tagPicker ? { ...s.tagPicker, profileIds: swapAll(s.tagPicker.profileIds) } : null,
      folderPicker: s.folderPicker ? { ...s.folderPicker, profileIds: swapAll(s.folderPicker.profileIds) } : null,
      folderDialog: s.folderDialog?.mode === "create" && s.folderDialog.moveIds ? { ...s.folderDialog, moveIds: swapAll(s.folderDialog.moveIds) } : s.folderDialog,
      assign: s.assign ? { ...s.assign, ids: swapAll(s.assign.ids) } : null,
    });
  },
  // PC-060: the new row comes into view. PC-095: a View or filter that hides
  // it says so, with Show in list (Peek shows it either way).
  created: (id) => {
    const ui = useProfileUi.getState();
    if (selectVisible(ui).indexById.has(id)) { ui.reveal(id); return; }
    const name = useProfile.getState().profiles.find((p) => p.id === id)?.name ?? "";
    toast.ok(t("useProfile.createdHidden", { name }), {
      action: {
        label: t("toast.showInList"),
        run: () => { void resolveId(id).then((real) => { if (real) useProfileUi.getState().showInList(real); }); },
      },
    });
  },
  // IFACE-14: an import selects what it brought in and shows the first. The
  // rows already selected stay (ruling F4: a bulk action keeps the selection).
  arrived: async (ids) => {
    // The list the selection reads is the one Show in list leaves.
    if (!(await useProfileUi.getState().showInList(ids[0]))) return;
    const listed = selectVisible().indexById;
    const shown = ids.filter((id) => listed.has(id));
    if (shown.length === 0) return;
    useProfileUi.setState((s) => ({
      selected: new Set([...s.selected, ...shown]),
      anchorId: s.selected.size === 0 ? shown[0] : s.anchorId,
    }));
  },
  // IFACE-14: Clone's toast opens the copy in Peek, in view.
  open: (id) => {
    const ui = useProfileUi.getState();
    ui.openPeek(id);
    ui.reveal(id);
  },
  // IFACE-06: a bulk Start's "Select failed" makes the selection exactly the
  // profiles that failed, the listed ones (a selection holds listed rows,
  // ruling F13). The person asks for it; the Start itself never narrows.
  select: (ids) => {
    const listed = selectVisible().indexById;
    const shown = ids.filter((id) => listed.has(id));
    // Nothing listed (a filter hides them): false keeps the toast and its reasons.
    if (shown.length === 0) return false;
    useProfileUi.setState((s) => ({
      selected: new Set(shown),
      anchorId: shown[0],
      tagPicker: s.tagPicker?.from === "bar" ? null : s.tagPicker,
    }));
    return true;
  },
});
setOnAssign((ids) => useProfileUi.getState().openAssign(ids));

// Profiles removed or moved elsewhere (a row menu, the API, another window)
// leave the selection too. Running state only matters under a status filter.
// A deleted proxy stops filtering, as a deleted tag does (below): no row
// could ever match it. Only once the list is in: before, no proxy is known.
useProfile.subscribe((s, prev) => {
  const ui = useProfileUi.getState();
  if (s.proxies !== prev.proxies && s.status === "ready") {
    const gone = (v: ProxyFilter) => { const id = proxyIdOf(v); return id !== null && !s.proxies.some((p) => p.id === id); };
    if (ui.base && gone(ui.base.filters.proxy)) useProfileUi.setState({ base: { ...ui.base, filters: { ...ui.base.filters, proxy: "all" } } });
    if (gone(ui.filters.proxy)) { ui.setFilters({ proxy: "all" }); return; }
  }
  const statusFiltered = ui.filters.status !== "all";
  if (s.profiles !== prev.profiles || (statusFiltered && s.running !== prev.running)) pruneSelection();
});
// A tag taken off (or renamed) can hide a row a search or the Tag filter found
// by its tags. A deleted tag stops filtering: no row could ever match it. That
// holds for the list's own query kept under a View too.
useTags.subscribe((s) => {
  const ui = useProfileUi.getState();
  const gone = (id: string) => !!id && !s.tags.some((t) => t.id === id);
  if (ui.base && gone(ui.base.filters.tag)) useProfileUi.setState({ base: { ...ui.base, filters: { ...ui.base.filters, tag: "" } } });
  if (gone(ui.filters.tag)) ui.setFilters({ tag: "" });
  else if (ui.search.trim() || ui.filters.tag) pruneSelection();
});

// Another space: nothing picked, open or narrowed in the old one carries over.
onSpaceMoved(() => {
  useProfileUi.getState().leaveView();
  useProfileUi.setState({
    folder: "all", search: "", filters: emptyFilters(), only: null, viewEdit: null,
    selected: new Set<string>(), anchorId: null, activeId: null, activeByPointer: false, peekId: null, dropTarget: null,
    tagPicker: null, folderPicker: null, folderDialog: null, viewDialog: null, editing: null, assign: null,
  });
});

