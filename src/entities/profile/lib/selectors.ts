import { useDeferredValue, useMemo } from "react";
import { t } from "../../../shared/i18n";
import type { ProxyEntry } from "../../proxy";
import { applyProfileFilters, emptyFilters, folderNamesOf, makeProfileFilter, type ProfileFilters } from "./listing";
import type { ProfileMeta } from "../model/types";
import { useProfile } from "./useProfile";
import { useProfileUi } from "./useProfileUi";
import { layoutColumns, type ColumnsApi, type TableLayout } from "../../../shared/lib/tableColumns";
import { SELECT_TRACK } from "../../../shared/lib/selectionMode";
import { rowActionsCoverPx } from "../../../shared/ui/RowHoverActions";
import { PROFILE_COLUMNS, PROFILE_EDITABLE, PROFILE_FLOATING_ACTIONS, PROFILE_TABLE, type ProfileColumnId } from "./columns";
import { allQuery, allViews, sameQuery, useViews, viewOwnFilters, viewQuery, type ProfileView, type ViewContext, type ViewQuery } from "./views";
import { tagsOf, useTags } from "../../tag";
import { useMinuteClock } from "../../../shared/lib/useNow";
import { computeVisible, needsRunning, NO_RUNNING, readsClock, type Visible } from "./visible";
import { useActionsTail } from "./actionsWidth";

/// Folder tabs derived from profile assignments + the persisted registry of
/// empty folders. Sorted; "all" is rendered separately as the first tab.
export function useFolders() {
  const profiles = useProfile((s) => s.profiles);
  const folderRegistry = useProfile((s) => s.folderRegistry);
  return useMemo(() => folderNamesOf(profiles, folderRegistry), [profiles, folderRegistry]);
}

/** The Folders, tags and proxies there are now, for `viewQuery`. */
function useViewContext(): ViewContext {
  const folders = useFolders();
  const tags = useTags((s) => s.tags);
  const proxies = useProfile((s) => s.proxies);
  return useMemo(() => ({ folders, tagIds: tags.map((t) => t.id), proxyIds: proxies.map((p) => p.id) }), [folders, tags, proxies]);
}

/** Built-ins, then custom Views. */
export function useAllViews(): ProfileView[] {
  const custom = useViews((s) => s.views);
  return useMemo(() => allViews(custom), [custom]);
}

/** The View applied to the list, or null. */
export function useCurrentView(): ProfileView | null {
  const viewId = useProfileUi((s) => s.viewId);
  const views = useAllViews();
  return useMemo(() => views.find((v) => v.id === viewId) ?? null, [views, viewId]);
}

/** Whether a custom View is open for editing ("Edit view"). */
export function useViewEditing(): boolean {
  const view = useCurrentView();
  const edit = useProfileUi((s) => s.viewEdit);
  return !!view && !view.builtin && edit === view.id;
}

/** The applied View's own filters (a deleted tag or proxy no longer filters),
 *  or null outside a View, and while the View is being edited (they are open
 *  then, like any filter). A filter is the person's own when it differs from
 *  these; Clear filters gives these back. */
export function useViewFilters(): ProfileFilters | null {
  const view = useCurrentView();
  const editing = useViewEditing();
  const base = useProfileUi((s) => s.base);
  const columns = useProfileUi((s) => s.columns);
  const known = useViewContext();
  return useMemo(() => (view && !editing ? viewOwnFilters(view, base?.columns ?? columns, known) : null), [view, editing, base, columns, known]);
}

/** Whether the list's query has changed since its View was applied: the
 *  filters a person added on top, the order or the columns. The View's own
 *  filters are locked, so they never count as a change. */
export function useViewModified(): boolean {
  const view = useCurrentView();
  const base = useProfileUi((s) => s.base);
  const folder = useProfileUi((s) => s.folder);
  const filters = useProfileUi((s) => s.filters);
  const sort = useProfileUi((s) => s.sort);
  const columns = useProfileUi((s) => s.columns);
  const known = useViewContext();
  return useMemo(
    () => !!view && !!base && !sameQuery({ folder, filters, sort, columns }, viewQuery(view, base.columns, known)),
    [view, base, folder, filters, sort, columns, known],
  );
}

/** Whether the list shows something other than All: a Folder, a filter, an
 *  order or columns of its own. Outside a View, that is what Save as view…
 *  keeps (Pair 24 review, Important 1). */
export function useDiffersFromAll(): boolean {
  const folder = useProfileUi((s) => s.folder);
  const filters = useProfileUi((s) => s.filters);
  const sort = useProfileUi((s) => s.sort);
  const columns = useProfileUi((s) => s.columns);
  return useMemo(() => !sameQuery({ folder, filters, sort, columns }, allQuery()), [folder, filters, sort, columns]);
}

/** The list's query now, to save as a View or into one. */
export function currentQuery(): ViewQuery {
  const { folder, filters, sort, columns } = useProfileUi.getState();
  return { folder, filters, sort, columns };
}

/** How many profiles each View shows (the search left out), by View id. */
export function useViewCounts(views: ProfileView[]): Record<string, number> {
  const profiles = useProfile((s) => s.profiles);
  const proxies = useProfile((s) => s.proxies);
  const running = useProfile((s) => s.running);
  const tags = useTags((s) => s.tags);
  const byProfile = useTags((s) => s.byProfile);
  const columns = useProfileUi((s) => s.columns);
  const known = useViewContext();
  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const v of views) {
      const q = viewQuery(v, columns, known);
      out[v.id] = applyProfileFilters(profiles, proxies, "", q.folder, q.filters, running, "added", (id) => tagsOf(id, { tags, byProfile })).length;
    }
    return out;
  }, [views, profiles, proxies, running, tags, byProfile, columns, known]);
}

/// The search the Profiles list renders from. While typing, a beat behind the
/// field (`useDeferredValue`): a keystroke updates the field at once and never
/// waits for the rows (PERF-04). A cleared search applies at once: "Show in
/// list" clears one that hides a profile, then reveals and focuses its row,
/// which has to be rendered by then.
export function useListSearch(): string {
  const typed = useProfileUi((s) => s.search);
  const deferred = useDeferredValue(typed);
  return typed.trim() ? deferred : typed;
}

/// The list the Profiles table paints, with its ids and index (PERF-04), from
/// `useListSearch`.
export function useVisible(): Visible {
  const profiles = useProfile((s) => s.profiles);
  const proxies = useProfile((s) => s.proxies);
  const search = useListSearch();
  const folder = useProfileUi((s) => s.folder);
  const filters = useProfileUi((s) => s.filters);
  const sort = useProfileUi((s) => s.sort);
  const tags = useTags((s) => s.tags);
  const byProfile = useTags((s) => s.byProfile);
  const proxyIps = useProfile((s) => s.proxyIps);
  // Running state matters to a status filter, and to the two orders that read
  // it (Status, and Most run time's live session on top of the stored total).
  const readsRunning = needsRunning(filters, sort);
  const running = useProfile((s) => (readsRunning ? s.running : NO_RUNNING));
  // The minute clock, only for a query that reads it: Most run time sorts
  // again and the Last run filter reads the time again once a minute. Any
  // other query takes 0 and does not render on the tick (the Profiles page
  // counts its rows from here).
  const readsTime = readsClock(filters, sort);
  const now = useMinuteClock((m) => (readsTime ? m : 0));
  const only = useProfileUi((s) => s.only?.ids ?? null);
  return useMemo(
    () => computeVisible({ profiles, proxies, search, folder, filters, running, sort, tags, byProfile, proxyIps, now, only }),
    [profiles, proxies, search, folder, filters, running, sort, tags, byProfile, proxyIps, now, only],
  );
}

const NO_FILTERS = emptyFilters();

/// How many rows the list shows with no search and, outside a View, no
/// filters: the "8" in "3 of 8" (CRAFT-18). Inside a View its own filters
/// stay (the View is the list). Counted with the shared predicate, not
/// `computeVisible`, so the table's two cached answers stay in the cache.
export function useListTotal(): number {
  const profiles = useProfile((s) => s.profiles);
  const proxies = useProfile((s) => s.proxies);
  const folder = useProfileUi((s) => s.folder);
  const inView = useProfileUi((s) => s.viewId !== null);
  const filters = useProfileUi((s) => s.filters);
  const base = inView ? filters : NO_FILTERS;
  const running = useProfile((s) => (base.status !== "all" ? s.running : NO_RUNNING));
  const tags = useTags((s) => s.tags);
  const byProfile = useTags((s) => s.byProfile);
  return useMemo(() => {
    const keep = makeProfileFilter(proxies, "", folder, base, running, (id) => tagsOf(id, { tags, byProfile }), Date.now(), undefined, profiles);
    let n = 0;
    for (const p of profiles) if (keep(p)) n++;
    return n;
  }, [profiles, proxies, folder, base, running, tags, byProfile]);
}

/// Profiles filtered by the folder tab, the search query and the filter bar.
export function useVisibleProfiles() {
  return useVisible().list;
}

/// Country codes present among bound proxies, for the country filter.
export function useProfileCountries() {
  const profiles = useProfile((s) => s.profiles);
  const proxies = useProfile((s) => s.proxies);
  return useMemo(() => {
    const byId = new Map(proxies.map((p) => [p.id, p]));
    const set = new Set<string>();
    for (const p of profiles) {
      const cc = p.proxy_id ? byId.get(p.proxy_id)?.country ?? "" : "";
      if (cc) set.add(cc.toUpperCase());
    }
    return [...set].sort();
  }, [profiles, proxies]);
}

/// proxy_id → ProxyEntry lookup for the Proxy column.
export function useProxyMap() {
  const proxies = useProfile((s) => s.proxies);
  return useMemo(
    () => Object.fromEntries(proxies.map((p) => [p.id, p])) as Record<string, ProxyEntry>,
    [proxies],
  );
}

/// Count of currently-running engines, as a number: a poll that changes
/// nothing re-renders nothing (PERF-01).
export function useRunningCount() {
  return useProfile((s) => {
    let n = 0;
    for (const id in s.running) if (s.running[id]) n++;
    return n;
  });
}

/// The rows the Profiles list's columns size to (owner, 2026-09-30): the
/// list as its Folder, View and filters make it, with the search left out,
/// so typing in the search never moves a column. In no order: a width
/// doesn't depend on it.
export function useSizingRows(): ProfileMeta[] {
  const profiles = useProfile((s) => s.profiles);
  const proxies = useProfile((s) => s.proxies);
  const folder = useProfileUi((s) => s.folder);
  const filters = useProfileUi((s) => s.filters);
  const running = useProfile((s) => (filters.status !== "all" ? s.running : NO_RUNNING));
  const tags = useTags((s) => s.tags);
  const byProfile = useTags((s) => s.byProfile);
  return useMemo(() => {
    const keep = makeProfileFilter(proxies, "", folder, filters, running, (id) => tagsOf(id, { tags, byProfile }), Date.now());
    return profiles.filter(keep);
  }, [profiles, proxies, folder, filters, running, tags, byProfile]);
}

/// The Profiles list's columns and their grid (owner feature 2026-09-26):
/// every chosen column, less Folder inside one Folder (its column would
/// repeat the page title; a View keeps it), each as wide as a person made
/// it or else as its content needs (owner, 2026-09-30). The list and the
/// Display menu read the same layout, so the "Hidden inside a Folder" note
/// never disagrees with the list. Too wide for the list, the columns no one
/// sized give way first; its width also decides whether Name stays pinned
/// while it scrolls sideways.
export function useProfileLayout(): TableLayout<ProfileColumnId> {
  const columns = useProfileUi((s) => s.columns);
  const widths = useProfileUi((s) => s.widths);
  const auto = useProfileUi((s) => s.autoWidths);
  const full = useProfileUi((s) => s.fullWidths);
  const floor = useProfileUi((s) => s.floorWidths);
  const available = useProfileUi((s) => s.listWidth);
  const inFolder = useProfileUi((s) => s.folder !== "all" && s.viewId === null);
  // Tags holds 96 to 190 px before any tag exists (CRAFT-14): chosen, but left
  // out until the first tag is made.
  const noTags = useTags((s) => s.tags.length === 0);
  // The row actions as wide as their words need in this language.
  const tail = useActionsTail((s) => s.tail);
  return useMemo(
    () => layoutColumns(PROFILE_COLUMNS, columns, widths, {
      ...PROFILE_TABLE,
      tail,
      leadTrack: SELECT_TRACK,
      available,
      auto,
      full,
      floor,
      exclude: [...(inFolder ? ["folder" as const] : []), ...(noTags ? ["tags" as const] : [])],
      // The row actions float over the last column (the owner's choice);
      // when the column before it has an edit button, the last one is at
      // least as wide as they are, so they never cover that button.
      lastFloor: (_last, prev) =>
        prev !== undefined && PROFILE_EDITABLE.has(prev)
          ? rowActionsCoverPx(PROFILE_FLOATING_ACTIONS) - PROFILE_TABLE.gap
          : 0,
    }),
    [columns, widths, auto, full, floor, available, inFolder, noTags, tail],
  );
}

/** The Profiles columns for the list header's menus and gestures. */
export function useProfileColumnsApi(): ColumnsApi<ProfileColumnId> {
  const set = useProfileUi((s) => s.columns);
  const widths = useProfileUi((s) => s.widths);
  return useMemo(() => {
    const ui = useProfileUi.getState();
    return { defs: PROFILE_COLUMNS, set, widths, setSet: ui.setColumns, setWidth: ui.setColumnWidth, reset: ui.resetColumns };
  }, [set, widths]);
}

/// Why these profiles cannot launch as one synced group, or "" when they can:
/// a group is all mobile or all desktop. A press is a tap on a phone and a
/// click on a desktop: one stream cannot drive both.
function mixedReason(picked: readonly { mobile?: boolean }[]): string {
  const m = picked.filter((p) => p.mobile).length;
  return m > 0 && m < picked.length ? t("selectors.syncMixedSelection", { m, d: picked.length - m }) : "";
}

/// The same for any profiles, read now: the hook below and the commands share it.
export function syncBlockReason(ids: string[]): string {
  const wanted = new Set(ids);
  return mixedReason(useProfile.getState().profiles.filter((p) => wanted.has(p.id)));
}

/// Why "Launch synced" is unavailable for the current selection; "" means it is fine.
export function useSyncBlockReason(): string {
  const profiles = useProfile((s) => s.profiles);
  const selected = useProfileUi((s) => s.selected);
  return useMemo(() => mixedReason(profiles.filter((p) => selected.has(p.id))), [profiles, selected]);
}
