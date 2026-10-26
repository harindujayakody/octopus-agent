import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useOnRightsMoved } from "../../entities/space";
import { Checkbox, clientScale, cn, layoutRect, layoutToPointer, useContextMenu, useInputModality, useLatched, useVirtualList, type ContextMenuApi, type MenuItem } from "@proxyshard/shardx-ui-kit";
import { ListStateCenter, LoadError, LoadingRows } from "../../shared/ui/ListStates";
import { ProfileListEmpty } from "./ProfileListEmpty";
import { useLang, useT } from "../../shared/i18n";
import { ListHeader, useAutoWidths, type ColumnSort } from "../../shared/ui/listHeader";
import {
  rowKey, setOnRestored, useListSearch, useProfile, useProfileUi, useProfileLayout, useSizingRows, useVisible, useProxyMap,
  useProfileColumnsApi, PROFILE_COLUMNS, PROFILE_FLOATING_ACTIONS, PROFILE_SORTS, type ProfileColumnId, type ProfileMeta,
} from "../../entities/profile";
import { tagsOf, useTags } from "../../entities/tag";
import type { ProxyEntry } from "../../entities/proxy";
import { profileFits, profileFolded } from "./profileFits";
import { useScrollMemory, useScrollReset } from "../../shared/model/scrollMemory";
import { rowActionsCoverPx } from "../../shared/ui/RowHoverActions";
import { ProfileRow } from "./ProfileRow";
import { TagPicker } from "../../features/manage-tags";
import { FolderPicker, RunButtonProbe } from "../../features/manage-profiles";
import { useProfileListKeys } from "./useProfileListKeys";
import { focusCellButton, focusProfileRow } from "../../shared/lib/focusRow";
import { useMinuteClock } from "../../shared/lib/useNow";
import { useSideScroll } from "../../shared/lib/useSideScroll";
import { useDialogLife } from "../../shared/lib/useDialogLife";
import { useListEndRoom } from "../../shared/ui/ListColumn";
import { LIST_HEADER_HEIGHT, LIST_ROW_HEIGHT } from "../../shared/ui/listMetrics";
import { useSelectionMode } from "../../shared/lib/selectionMode";

/** Every row is this tall. */
export const ROW_HEIGHT = LIST_ROW_HEIGHT;
/** The sticky column header. */
const HEADER_HEIGHT = LIST_HEADER_HEIGHT;

/// The Profiles list: a virtual grid of 36 px rows under a sticky header. It
/// is its own scroll container, so the header stays put and scrolls sideways
/// with the rows. A profile opens in Peek, beside the list, which keeps every
/// chosen column: wider than its card, it scrolls sideways inside it with the
/// select box, Name and the row actions pinned (owner decision 2026-09-26).
/// Its select column keeps its slot before Name in every state (owner,
/// 2026-10-07): at rest a row's box shows on its hover only, and the first
/// pick puts the list in selection mode (owner, 2026-10-01): `has-selection`
/// on the list shows every box (the kit's tokens.css).
const NO_ROWS: never[] = [];

/// `loading` is the page's held first load (`useHeldLoading`): the page
/// switches its header and this list in one frame.
export function ProfileTable({ loading }: { loading: boolean }) {
  const t = useT();
  const folder = useProfileUi((s) => s.folder);
  const status = useProfile((s) => s.status);
  const hasProfiles = useProfile((s) => s.profiles.length > 0);
  const loadError = useProfile((s) => s.error);
  // The search the rows follow (a beat behind the field while typing), and
  // so does the scroll reset below.
  const search = useListSearch();
  const filters = useProfileUi((s) => s.filters);
  const sort = useProfileUi((s) => s.sort);
  const viewId = useProfileUi((s) => s.viewId);
  const selected = useProfileUi((s) => s.selected);
  const selectProfiles = useProfileUi((s) => s.selectProfiles);
  const activeId = useProfileUi((s) => s.activeId);
  const peekId = useProfileUi((s) => s.peekId);
  const { list: visible, indexById } = useVisible();
  const proxyMap = useProxyMap();
  const ctx = useContextMenu();
  // A row's menu built from rights that moved since closes (a new permission, told live).
  useOnRightsMoved(ctx.close);

  const scrollRef = useRef<HTMLDivElement>(null);
  // The box that holds the list's minimum width (a column resize grows it, Task 6).
  const wrapRef = useRef<HTMLDivElement>(null);
  // Marks the pinned edges that have columns passing under them (their
  // shadows), and reports the list's inner width: whether Name can stay
  // pinned while the list scrolls sideways (TableLayout.pinFirst), the
  // store keeps it. One `ResizeObserver` on the list does both (C13).
  useSideScroll(scrollRef, wrapRef, (px) => useProfileUi.getState().setListWidth(px));
  // Selection mode: entering and leaving are said, and a box that hides
  // never keeps the keyboard.
  const selecting = selected.size > 0;
  useSelectionMode(scrollRef, selected.size);
  // The target row is drawn while the keys drive, or while the pointer is on
  // it (rowFill, the kit's `row-target`): never a hover look left behind.
  useInputModality();
  const layout = useProfileLayout();
  const { template: columns, minWidth } = layout;
  const columnsApi = useProfileColumnsApi();
  // Columns size themselves to their content until a person resizes them
  // (owner, 2026-09-30), over the whole list, the search left out.
  const sizingRows = useSizingRows();
  const tags = useTags((s) => s.tags);
  const byProfile = useTags((s) => s.byProfile);
  const lang = useLang((s) => s.lang);
  // The times' words change by the hour ("23 hours ago", "Yesterday"): the
  // fits, and so the widths, follow an hour clock (review M1).
  const hour = useMinuteClock((m) => Math.floor(m / 3_600_000));
  const fits = useMemo(
    () => profileFits({ proxyOf: (id) => proxyMap[id], tagsOf: (id) => tagsOf(id, { tags, byProfile }), lang, now: Date.now() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `hour` moves `now` on
    [proxyMap, tags, byProfile, lang, hour],
  );
  const folded = useMemo(
    () => profileFolded({ proxyOf: (id) => proxyMap[id], tagsOf: (id) => tagsOf(id, { tags, byProfile }), lang, now: Date.now() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `hour` moves `now` on
    [proxyMap, tags, byProfile, lang, hour],
  );
  useAutoWidths({
    defs: PROFILE_COLUMNS,
    shown: layout.shown,
    // None while the placeholder rows show: the first measure lands with the
    // rows, not over the placeholders (review M5).
    rows: loading ? NO_ROWS : sizingRows,
    fits,
    folded,
    listRef: scrollRef,
    sortable: (id) => PROFILE_SORTS[id] !== undefined,
    onWidths: (w) => useProfileUi.getState().setAutoWidths(w),
  });
  const setSort = useProfileUi((s) => s.setSort);
  // A column's own orders (Display's, by column) and its sort mark.
  const columnSort: ColumnSort<ProfileColumnId> = {
    of: (id) => PROFILE_SORTS[id]?.find((o) => o.sort === sort)?.dir,
    items: (id) => (PROFILE_SORTS[id] ?? []).map((o): MenuItem => ({
      type: "radio", label: o.label(t), checked: o.sort === sort, onSelect: () => setSort(o.sort),
    })),
  };
  // One tick a minute for the whole list, so every row's "12 min ago" stays
  // true without a timer of its own: the minute clock the list's order and
  // filters read, so the rows and their order move together.
  const now = useMinuteClock((m) => m);

  // `T` and `M`: a picker opens under the active row's cell (its Tags or
  // Folder; the row, with the column hidden), or at the list's top when that
  // row is out of sight. The point is read once: a row that scrolls or
  // leaves does not move it. A press on that row's Tags cell is the tag
  // picker's own (it toggles it). All in layout px (HEADER_HEIGHT and the 12
  // are), then handed over as a pointer position, as a picker's point anchor
  // takes it. The point is read once a picker opens, in a layout effect,
  // never during a render (WIG-12); the picker mounts with it, before the
  // frame is painted.
  type PickerAt = { point: { x: number; y: number }; trigger: { current: HTMLElement | null } };
  const anchorAt = (cellSelector: string): PickerAt | undefined => {
    const list = scrollRef.current ? layoutRect(scrollRef.current) : undefined;
    if (!list) return undefined;
    const rowEl = activeId ? document.querySelector<HTMLElement>(`[role='row'][data-profile-id="${CSS.escape(activeId)}"]`) : null;
    const cell = rowEl?.querySelector<HTMLElement>(cellSelector) ?? null;
    const target = cell ?? rowEl;
    const r = target ? layoutRect(target) : undefined;
    // In sight across too: the list scrolls sideways (owner decision 2026-09-26).
    const inSight = r && r.top >= list.top + HEADER_HEIGHT && r.bottom <= list.bottom && r.left >= list.left && r.left < list.right;
    return {
      point: layoutToPointer(inSight ? { x: r.left, y: r.bottom } : { x: list.left + 12, y: list.top + HEADER_HEIGHT }),
      trigger: { current: cell },
    };
  };
  const tagPicker = useProfileUi((s) => s.tagPicker);
  const setTagPicker = useProfileUi((s) => s.setTagPicker);
  const [tagAt, setTagAt] = useState<PickerAt | undefined>(undefined);
  useLayoutEffect(() => {
    setTagAt(tagPicker ? anchorAt("[data-cell='tags']") : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read when the picker opens
  }, [tagPicker]);
  // `M`, a row's menu, Peek's menu: the folder picker, the same way (EMIL-09).
  const folderPicker = useProfileUi((s) => s.folderPicker);
  const [folderAt, setFolderAt] = useState<PickerAt | undefined>(undefined);
  useLayoutEffect(() => {
    setFolderAt(folderPicker?.from === "list" ? anchorAt("[data-cell='folder']") : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read when the picker opens
  }, [folderPicker]);
  const listFolder = folderPicker?.from === "list" && folderAt ? { ...folderPicker, at: folderAt } : null;
  const folderLife = useDialogLife(listFolder != null);
  const folderShown = useLatched(listFolder);
  // Open once its point is read; then it stays mounted, on the profiles and
  // the point it opened with, through its exit (FEEL-01). Each opening is a
  // new session, so one opened while another leaves starts fresh.
  const listPicker = tagPicker?.from === "list" && tagAt ? { ...tagPicker, at: tagAt } : null;
  const listPickerLife = useDialogLife(listPicker != null);
  const listPickerShown = useLatched(listPicker);
  // While the bar or a lasting toast shows, the rows end above it and a row
  // scrolled into view stays clear of it (LAYOUT-02, A11Y-15, Pair 14 review).
  const barShown = useProfileUi((s) => s.selected.size > 0);
  const endRoom = useListEndRoom(barShown);
  // The rows are their own component (`ProfileRows`), which holds the
  // virtual window: a scroll that moves it renders the rows alone, never
  // this list with its header and its hooks (speed lane 2026-10-02). It
  // hands its `scrollToIndex` up here.
  const scrollApi = useRef<(index: number) => void>(() => {});
  const scrollToIndex = useCallback((index: number) => scrollApi.current(index), []);

  const scrollToId = useCallback(
    (id: string) => {
      const i = indexById.get(id);
      if (i !== undefined) scrollToIndex(i);
    },
    [indexById, scrollToIndex],
  );
  const { onGridKeyDown } = useProfileListKeys({ scrollToId });
  const activeIndex = activeId ? indexById.get(activeId) ?? -1 : -1;

  // A row revealed from outside the list (a sidebar Pinned item) is brought
  // into view; a click on a row never scrolls the list under the pointer.
  const revealSeq = useProfileUi((s) => s.revealSeq);
  useEffect(() => {
    if (revealSeq > 0 && activeIndex >= 0) scrollToIndex(activeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a reveal request
  }, [revealSeq]);

  // When the active row leaves the list (moved to the Trash, to another
  // Folder, filtered out), the row now in its place takes over, and the
  // keyboard follows it if it had nowhere else to go.
  const lastActiveIndex = useRef(-1);
  useEffect(() => {
    if (activeIndex >= 0) { lastActiveIndex.current = activeIndex; return; }
    if (!activeId || lastActiveIndex.current < 0) return;
    const next = visible[Math.min(lastActiveIndex.current, visible.length - 1)];
    // It takes over as the pointer's or the keyboard's, as the one it replaces was.
    useProfileUi.getState().setActive(next?.id ?? null, { pointer: useProfileUi.getState().activeByPointer });
    if (next) focusProfileRow(next.id, { ifLost: true });
  }, [activeId, activeIndex, visible]);

  // Undo of a move to the Trash: the first profile back is active and in view,
  // and takes the keyboard if the Undo button it came from went away.
  useEffect(() => {
    setOnRestored((ids) => {
      useProfileUi.getState().reveal(ids[0]);
      focusProfileRow(ids[0], { ifLost: true });
    });
    return () => setOnRestored(null);
  }, []);

  // Each Folder and View keeps its place in the list, across page switches;
  // a new search, filter or order starts at the top (WIG-06).
  const scrollKey = `profiles:${folder}:${viewId ?? ""}`;
  useScrollReset(scrollRef, scrollKey, [search, filters, sort]);
  useScrollMemory(scrollRef, scrollKey);

  const { allSelected, someSelected } = useMemo(() => {
    const some = visible.some((p) => selected.has(p.id));
    return { someSelected: some, allSelected: some && visible.every((p) => selected.has(p.id)) };
  }, [visible, selected]);
  // The header row stays while the first load is still in flight (over the
  // placeholder rows, so it does not jump in later); once loaded, a grid
  // with no rows shows no header, and is a plain region, not a grid with
  // rows it doesn't have.
  const showHeader = loading || visible.length > 0;

  // The Tags column's width, measured once for every row (not per row): its
  // chips fit whole or give way to "+N" (EMIL-15). Null while it is hidden.
  const tagsShown = layout.shown.includes("tags");
  const [tagsWidth, setTagsWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = tagsShown && showHeader ? wrapRef.current?.querySelector<HTMLElement>("[role='columnheader'][data-col='tags']") : null;
    if (!el) { setTagsWidth(null); return; }
    const read = () => {
      const w = Math.round(el.getBoundingClientRect().width / clientScale());
      setTagsWidth((was) => (was === w ? was : w));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tagsShown, showHeader, columns]);

  return (
    // The tile round the list (`list-tile`, borderless step 2, owner
    // 2026-10-01): no border and no shadow; its 4 px padding is the inner
    // inset round the scroll box, so a row never passes through the tile's
    // edge as the list scrolls. The scroll box fills it. With no profiles
    // there is no list to show the tour: its step draws the list instead.
    <div data-list-tile data-tour={hasProfiles ? "profiles-list" : undefined} className="list-tile flex min-h-0 min-w-0 flex-1 flex-col">
    <div
      ref={scrollRef}
      // A treegrid of rows (ruling 14, A11Y-08): the keys move between rows,
      // not cells, and each row's controls take Tab.
      role={showHeader ? "treegrid" : "region"}
      aria-label={t("profileTable.label")}
      aria-busy={loading || undefined}
      aria-rowcount={showHeader ? visible.length + 1 : undefined}
      aria-multiselectable={showHeader || undefined}
      // Name stays pinned while the list scrolls sideways (app.css `list-pin-name`).
      data-pin-first={layout.pinFirst || undefined}
      onKeyDown={onGridKeyDown}
      // What a focused control in a scrolling column stays clear of (WCAG
      // 2.4.11, app.css `list-pin-scroll`): at the right, the row actions and
      // the hover strip beside them, which a row with focus shows. At the
      // bottom, the bulk bar and a lasting toast (useListEndRoom).
      style={{
        "--pin-start": `${layout.pinStart}px`,
        "--pin-end": `${layout.pinEnd + rowActionsCoverPx(PROFILE_FLOATING_ACTIONS)}px`,
        scrollPaddingBottom: endRoom,
      } as CSSProperties}
      className={cn(
        "list-pin-scroll list-select relative isolate min-h-0 min-w-0 flex-1 overflow-auto",
        selecting && "has-selection",
      )}
    >
      <div ref={wrapRef} style={{ minWidth }}>
        {showHeader && (
          <ListHeader
            api={columnsApi}
            layout={layout}
            listRef={scrollRef}
            wrapRef={wrapRef}
            lead={
              <Checkbox
                aria-label={t("profileTable.selectAll")}
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onChange={(e) => selectProfiles(e.target.checked, visible)}
              />
            }
            actionsLabel={t("profileTable.colActions")}
            excludedNote={(id) => (id === "tags" ? t("tableColumns.noTags") : t("tableColumns.inFolder"))}
            sort={columnSort}
          />
        )}

        {/* Held placeholder rows (useHeldLoading) sit where the rows will be. */}
        {/* The end room follows the last row only: with no rows, an empty or
            error state stays centered in the list (owner), not pushed down. */}
        <ProfileRows
          visible={visible}
          loading={loading}
          scrollRef={scrollRef}
          endRoom={endRoom}
          scrollApi={scrollApi}
          proxyMap={proxyMap}
          columns={columns}
          order={layout.shown}
          tagsWidth={tagsWidth}
          now={now}
          activeIndex={activeIndex}
          peekId={peekId}
          onMenu={ctx.open}
        />

        {loading && <LoadingRows inGrid />}
      </div>

      {/* Outside the `minWidth` wrapper: centered on the visible viewport, not
          the (possibly wider) content, and never needs horizontal scroll. */}
      {!loading && status === "error" ? (
        <ListStateCenter>
          <LoadError what={t("listStates.profiles")} error={loadError} onRetry={() => void useProfile.getState().init()} />
        </ListStateCenter>
      ) : (
        !loading && visible.length === 0 && (
          <ListStateCenter>
            <ProfileListEmpty />
          </ListStateCenter>
        )
      )}
      {ctx.node}
      <RunButtonProbe />
      {listPickerLife.mounted && listPickerShown && (
        <TagPicker
          key={listPickerLife.session}
          open={listPicker != null}
          profileIds={listPickerShown.profileIds}
          anchorPoint={listPickerShown.at.point}
          triggerRef={listPickerShown.at.trigger}
          onClose={() => {
            const trigger = listPickerShown.at.trigger;
            const keyed = listPickerShown.keyed;
            const id = useProfileUi.getState().activeId;
            setTagPicker(null);
            // Fix round 1 (I4), amended (merge-columns-fix1.md): back to the
            // Tags cell's own edit button when a click on it (or the cell, or
            // the row menu) opened this; back to the row when `T` did — a row
            // key never touched that button, so it must not steal it back.
            if (trigger && !keyed) focusCellButton(trigger, id);
            else focusProfileRow(id, { ifLost: true });
          }}
        />
      )}
      {folderLife.mounted && folderShown && (
        <FolderPicker
          key={folderLife.session}
          open={listFolder != null}
          profileIds={folderShown.profileIds}
          anchorPoint={folderShown.at.point}
          onClose={() => {
            useProfileUi.getState().setFolderPicker(null);
            focusProfileRow(useProfileUi.getState().activeId, { ifLost: true });
          }}
        />
      )}
    </div>
    </div>
  );
}

/// The rows box and the rows in the virtual window: on screen, plus the
/// active row (it keeps the keyboard focus while scrolled away). Memoized,
/// and the only part of the list a scroll renders: the window's state lives
/// here, so the header and the list's own hooks sit a scroll out.
const ProfileRows = memo(function ProfileRows({ visible, loading, scrollRef, endRoom, scrollApi, proxyMap, columns, order, tagsWidth, now, activeIndex, peekId, onMenu }: {
  visible: readonly ProfileMeta[];
  loading: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  endRoom: number;
  scrollApi: React.MutableRefObject<(index: number) => void>;
  proxyMap: Record<string, ProxyEntry>;
  columns: string;
  order: readonly ProfileColumnId[];
  tagsWidth: number | null;
  now: number;
  activeIndex: number;
  peekId: string | null;
  onMenu: ContextMenuApi["open"];
}) {
  const { range, totalHeight, offsetOf, scrollToIndex } = useVirtualList({
    count: visible.length, rowHeight: ROW_HEIGHT, scrollRef, headerHeight: HEADER_HEIGHT, bottomInset: endRoom,
  });
  useLayoutEffect(() => { scrollApi.current = scrollToIndex; }, [scrollApi, scrollToIndex]);
  const rendered: number[] = [];
  for (let i = range.start; i < range.end; i++) rendered.push(i);
  if (activeIndex >= 0 && !rendered.includes(activeIndex)) {
    rendered.push(activeIndex);
    rendered.sort((a, b) => a - b);
  }
  return (
    <div className="relative" style={{ height: loading ? 0 : visible.length > 0 ? totalHeight + endRoom : 0 }}>
      {!loading && rendered.map((i) => {
        const p = visible[i];
        return (
          <ProfileRow
            key={rowKey(p.id)}
            profile={p}
            proxy={p.proxy_id ? proxyMap[p.proxy_id] ?? null : null}
            top={offsetOf(i)}
            columns={columns}
            order={order}
            tagsWidth={tagsWidth}
            now={now}
            rowIndex={i + 2}
            active={i === activeIndex}
            inPeek={p.id === peekId}
            // One row takes Tab: the active one, else the first.
            tabbable={activeIndex >= 0 ? i === activeIndex : i === 0}
            onMenu={onMenu}
          />
        );
      })}
    </div>
  );
});
