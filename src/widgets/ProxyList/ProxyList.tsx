import { useCallback, useEffect, useMemo, useRef } from "react";
import { Button, Checkbox, cn, EmptyState, Tooltip, useContextMenu, useInputModality, useVirtualList } from "@proxyshard/shardx-ui-kit";
import { teamRefusal, useOnRightsMoved, useRightsChange } from "../../entities/space";
import { AddIcon, FilterIcon, NavProxiesIcon, SearchIcon } from "../../shared/icons";
import { ListStateCenter, LoadError, LoadingRows } from "../../shared/ui/ListStates";
import { useLang, useT } from "../../shared/i18n";
import { PROXY_COLUMNS, countActiveProxyFilters, useFilteredProxies, useProfileCountByProxy, useProxy, useProxyColumns, useProxyColumnsApi, useProxyLayout } from "../../entities/proxy";
import { ProxyListRow } from "./ProxyListRow";
import { useProxyListKeys } from "./useProxyListKeys";
import { focusProxyRow } from "../../shared/lib/focusRow";
import { ListHeader, useAutoWidths } from "../../shared/ui/listHeader";
import { proxyFits } from "./proxyFits";
import { useScrollMemory, useScrollReset } from "../../shared/model/scrollMemory";
import { useSideScroll } from "../../shared/lib/useSideScroll";
import { refocusPageFilter } from "../../shared/lib/focus";
import { useListEndRoom } from "../../shared/ui/ListColumn";
import { LIST_HEADER_HEIGHT, LIST_ROW_HEIGHT } from "../../shared/ui/listMetrics";
import { useSelectionMode } from "../../shared/lib/selectionMode";

const NO_ROWS: never[] = [];
const ROW_HEIGHT = LIST_ROW_HEIGHT;
const HEADER_HEIGHT = LIST_HEADER_HEIGHT;

/// The Proxies list: a virtual grid of 36 px rows under a sticky header, as
/// the Profiles list. A proxy opens in Peek, beside the list. Its columns
/// are the person's; wider than its card, it scrolls sideways inside it
/// with the select box, Name and the row actions pinned (owner decision
/// 2026-09-26). The row actions take no track of their own: they float over
/// the row's end on hover or focus (controller ruling, merge point 3). As
/// Profiles, its select column keeps its slot in every state, a row's box
/// shows on its hover, and the first pick enters selection mode (owner,
/// 2026-10-01). `loading` is the page's held first load (`useHeldLoading`),
/// which the header's count waits for too.
export function ProxyList({ loading }: { loading: boolean }) {
  const t = useT();
  useRightsChange();
  const addWhy = teamRefusal("create");
  const visible = useFilteredProxies();
  const counts = useProfileCountByProxy();
  const search = useProxy((s) => s.search);
  const filtered = useProxy((s) => countActiveProxyFilters(s.filters) > 0);
  const status = useProxy((s) => s.status);
  const loadError = useProxy((s) => s.error);
  const selected = useProxy((s) => s.proxySel);
  const selectProxy = useProxy((s) => s.selectProxy);
  const activeId = useProxy((s) => s.activeId);
  const peekId = useProxy((s) => s.peekId);
  const ctx = useContextMenu();
  useOnRightsMoved(ctx.close);

  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Marks the pinned edges that have columns passing under them (their
  // shadows), and reports the list's inner width: whether Name can stay
  // pinned while the list scrolls sideways (TableLayout.pinFirst). One
  // `ResizeObserver` on the list does both (C13, fix round 1 item 2 — this
  // used to be a second one, folded back into the shared hook).
  useSideScroll(scrollRef, wrapRef, (px) => useProxyColumns.getState().setListWidth(px));
  // Selection mode, as on Profiles: said on the way in and out.
  const selecting = selected.size > 0;
  useSelectionMode(scrollRef, selected.size);
  // The target row is drawn while the keys drive, or while the pointer is on it.
  useInputModality();
  const layout = useProxyLayout();
  const columnsApi = useProxyColumnsApi();
  const { template: columns, minWidth } = layout;
  // Columns size themselves to their content until a person resizes them
  // (owner, 2026-09-30), over every proxy, the search left out.
  const proxies = useProxy((s) => s.proxies);
  const snapshots = useProxy((s) => s.snapshots);
  // `lang`: Test result's words are measured in the app's language.
  const lang = useLang((s) => s.lang);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `lang` changes the words `proxyFits` reads
  const { fits, short } = useMemo(() => proxyFits({ snapshotOf: (id) => snapshots[id], countOf: (id) => counts[id] ?? 0 }), [snapshots, counts, lang]);
  useAutoWidths({
    defs: PROXY_COLUMNS,
    shown: layout.shown,
    // None while the placeholder rows show: the first measure lands with
    // the rows, not over the placeholders (review M5).
    rows: loading ? NO_ROWS : proxies,
    fits,
    short,
    listRef: scrollRef,
    onWidths: (w) => useProxyColumns.getState().setAutoWidths(w),
  });
  // The bar shows for the selected proxies the list shows (ProxyBulkBar).
  const someSelected = visible.some((p) => selected.has(p.id));
  // While it or a lasting toast shows, the rows end above it and a row
  // scrolled into view stays clear of it (LAYOUT-02, A11Y-15, Pair 14 review).
  const endRoom = useListEndRoom(someSelected);
  const { range, totalHeight, offsetOf, scrollToIndex } = useVirtualList({
    count: visible.length, rowHeight: ROW_HEIGHT, scrollRef, headerHeight: HEADER_HEIGHT, bottomInset: endRoom,
  });
  const scrollToId = useCallback((id: string) => {
    const i = visible.findIndex((p) => p.id === id);
    if (i >= 0) scrollToIndex(i);
  }, [visible, scrollToIndex]);
  const { onGridKeyDown } = useProxyListKeys({ scrollToId });
  const activeIndex = activeId ? visible.findIndex((p) => p.id === activeId) : -1;

  // The active row left the list (deleted, filtered out): the row now in its
  // place takes over, with the keyboard if it had nowhere else to go.
  const lastActiveIndex = useRef(-1);
  useEffect(() => {
    if (activeIndex >= 0) { lastActiveIndex.current = activeIndex; return; }
    if (!activeId || lastActiveIndex.current < 0) return;
    const next = visible[Math.min(lastActiveIndex.current, visible.length - 1)];
    // It takes over as the pointer's or the keyboard's, as the one it replaces was.
    useProxy.getState().setActive(next?.id ?? null, { pointer: useProxy.getState().activeByPointer });
    if (next) focusProxyRow(next.id, { ifLost: true });
  }, [activeId, activeIndex, visible]);

  // The list keeps its place across page switches; a new search starts at the top (WIG-06).
  useScrollReset(scrollRef, "proxies", [search]);
  useScrollMemory(scrollRef, "proxies");

  const rendered: number[] = [];
  for (let i = range.start; i < range.end; i++) rendered.push(i);
  if (activeIndex >= 0 && !rendered.includes(activeIndex)) {
    rendered.push(activeIndex);
    rendered.sort((a, b) => a - b);
  }

  // Short of room, the Test result's IP moves into the pill's tooltip.
  const ipInTip = layout.shortened.includes("test");
  const allSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));
  // As Profiles: the header stays over the placeholder rows while the first
  // load is in flight; once loaded, a grid with no rows shows no header and
  // is a plain region.
  const showHeader = loading || visible.length > 0;

  return (
    // The tile round the list (`list-tile`, borderless step 2, owner
    // 2026-10-01): no border and no shadow; its 4 px padding is the inner
    // inset round the scroll box, so a row never passes through the tile's
    // edge as the list scrolls. The scroll box fills it.
    <div data-list-tile className="list-tile flex min-h-0 min-w-0 flex-1 flex-col">
    <div
      ref={scrollRef}
      // A treegrid of rows (ruling 14, A11Y-08), as Profiles.
      role={showHeader ? "treegrid" : "region"}
      aria-label={t("proxyList.label")}
      aria-busy={loading || undefined}
      aria-rowcount={showHeader ? visible.length + 1 : undefined}
      aria-multiselectable={showHeader || undefined}
      // Name stays pinned while the list scrolls sideways (app.css `list-pin-name`).
      data-pin-first={layout.pinFirst || undefined}
      onKeyDown={onGridKeyDown}
      className={cn(
        "list-select relative isolate min-h-0 min-w-0 flex-1 overflow-auto",
        selecting && "has-selection",
      )}
      style={{ scrollPaddingBottom: endRoom }}
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
                aria-label={t("proxyList.selectAll")}
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onChange={(e) => selectProxy(e.target.checked, visible)}
              />
            }
            actionsLabel={t("proxyList.colActions")}
          />
        )}

        {/* Held placeholder rows (useHeldLoading) sit where the rows will be. */}
        {/* The end room follows the last row only: with no rows, an empty or
            error state stays centered in the list (owner), not pushed down. */}
        <div className="relative" style={{ height: loading ? 0 : visible.length > 0 ? totalHeight + endRoom : 0 }}>
          {!loading && rendered.map((i) => {
            const p = visible[i];
            return (
              <ProxyListRow
                key={p.id}
                proxy={p}
                profileCount={counts[p.id] ?? 0}
                top={offsetOf(i)}
                columns={columns}
                order={layout.shown}
                ipInTip={ipInTip}
                rowIndex={i + 2}
                active={i === activeIndex}
                inPeek={p.id === peekId}
                tabbable={activeIndex >= 0 ? i === activeIndex : i === 0}
                onMenu={ctx.open}
              />
            );
          })}
        </div>

        {loading && <LoadingRows inGrid />}
      </div>

      {!loading && status === "error" ? (
        <ListStateCenter>
          <LoadError what={t("listStates.proxies")} error={loadError} onRetry={() => void useProxy.getState().init()} />
        </ListStateCenter>
      ) : (
        !loading && visible.length === 0 && (
          <ListStateCenter>
            {/* With no proxies at all, a typed search keeps the way to add one (PC-124). */}
            {proxies.length > 0 && search.trim() ? (
              <EmptyState
                icon={<SearchIcon />}
                title={t("proxyTable.noMatchTitle", { q: search.trim() })}
                actions={<Button variant="neutral" mode="stroke" size="xsmall" onClick={() => { useProxy.getState().setSearch(""); refocusPageFilter(); }}>{t("listStates.clearSearch")}</Button>}
              />
            ) : proxies.length > 0 && filtered ? (
              <EmptyState
                icon={<FilterIcon />}
                title={t("proxyTable.filtersNoMatchTitle")}
                actions={<Button variant="neutral" mode="stroke" size="xsmall" onClick={() => useProxy.getState().clearFilters()}>{t("listStates.clearFilters")}</Button>}
              />
            ) : (
              // The first action for someone with no proxies yet.
              <EmptyState
                icon={<NavProxiesIcon />}
                title={t("proxyTable.emptyTitle")}
                hint={t("proxyTable.emptyHint")}
                // A team's new proxies need Create on it: the button says why, as the header's does.
                {...(addWhy ? {
                  actions: (
                    <Tooltip content={addWhy}>
                      <Button variant="primary" mode="filled" size="xsmall" data-empty-action leftIcon={<AddIcon />} disabled aria-description={addWhy}>
                        {t("proxyTable.emptyAction")}
                      </Button>
                    </Tooltip>
                  ),
                } : { action: { label: t("proxyTable.emptyAction"), icon: <AddIcon />, onClick: () => useProxy.getState().setBulkOpen(true) } })}
              />
            )}
          </ListStateCenter>
        )
      )}
      {ctx.node}
    </div>
    </div>
  );
}
