import { useCallback, useEffect, useMemo } from "react";
import { Badge, Button, DataList, EmptyState, Tooltip } from "@proxyshard/shardx-ui-kit";
import { HeaderMenu, PageBody, PageHeader } from "../../widgets/PageHeader";
import { TrashBulkBar } from "../../widgets/TrashBulkBar";
import { useStoreChanged } from "../../shared/hooks/useStoreChanged";
import { useHeldLoading } from "../../shared/hooks/useHeldLoading";
import { NavTrashIcon, RestoreIcon, SearchIcon } from "../../shared/icons";
import { menuItemsFor } from "../../features/commands";
import { daysUntil, fmtTs } from "../../shared/lib/utils";
import { fmtBytes } from "../../shared/lib/format";
import { TRASH_LAYOUT_KEY, trashShown, useTrash, type TrashEntry } from "../../entities/trash";
import { useFolderLook } from "../../entities/profile";
import { FolderChip } from "../../shared/ui/FolderChip";
import { LoadError, LoadingRows } from "../../shared/ui/ListStates";
import { ListColumn, useListEndRoom } from "../../shared/ui/ListColumn";
import { useListLayout, type ListColumnDef } from "../../shared/ui/listHeader";
import { t, useT } from "../../shared/i18n";
import { useScrollMemory } from "../../shared/model/scrollMemory";
import { refocusPageFilter } from "../../shared/lib/focus";
import { showMeAround } from "../../features/tour";
import { useInTeam } from "../../entities/space";
import { TeamTrashPage } from "./team";

type TrashColumn = "name" | "folder" | "deleted" | "left" | "size";

/** What an entry's countdown badge says. */
const leftWord = (e: TrashEntry) => {
  const left = daysUntil(e.expires_at);
  return left === 0 ? t("trash.expiresToday") : left === 1 ? t("trash.daysLeftOne") : t("trash.daysLeft", { n: left });
};
/** A small Badge's sides (`px-[5px]`). */
const BADGE = 5 + 5;
/** A Folder chip's sides (`px-1.5`), as Profiles measures its Folder cell. */
const CHIP = 12;

/** The Folder as Profiles draws it: its chip, in its own color, whole in a
 *  tooltip when the column cuts it (merge point 4 review, I4). */
function TrashFolder({ name }: { name: string }) {
  const look = useFolderLook(name);
  return <span className="flex min-w-0"><FolderChip name={name} color={look.color} wholeOnHover /></span>;
}

// The columns size to their content and are the person's to size, move,
// hide and sort, saved under `shardx.trash.layout` (owner: layouts persist).
// Their minimums are the column tracks tuned at 1024 px:
// Name 140, Folder 120, the date 104, its countdown badge beside Size 64, so
// with the actions' 104 the list (718 px) fits the 740 px card in English,
// no date wraps and the "Last day" badge never runs into Size. Longer text
// (zh) gives way, then scrolls sideways inside the card, never the page.
const TRASH_COLUMNS: readonly ListColumnDef<TrashColumn, TrashEntry>[] = [
  {
    id: "name", title: (t) => t("trash.colName"), need: 160, min: 140, max: 480, shown: true, hideable: false, movable: false,
    text: (e) => e.name, compare: (a, b) => a.name.localeCompare(b.name),
  },
  {
    id: "folder", title: (t) => t("trash.colFolder"), need: 120, min: 120, max: 320, shown: true, hideable: true, movable: true,
    compare: (a, b) => a.folder.localeCompare(b.folder),
    // No Folder: an empty cell, as on Profiles.
    fit: (e, m) => (e.folder ? CHIP + m(e.folder, "secondary") : 0),
    cell: (e) => (e.folder ? <TrashFolder name={e.folder} /> : null),
  },
  {
    id: "deleted", title: (t) => t("trash.colDeleted"), need: 104, min: 104, max: 200, shown: true, hideable: true, movable: true,
    text: (e) => fmtTs(`@${e.deleted_at}`), role: "tabular", compare: (a, b) => a.deleted_at - b.deleted_at,
  },
  {
    id: "left", title: (t) => t("trash.colLeft"), need: 72, min: 72, max: 160, shown: true, hideable: true, movable: true,
    compare: (a, b) => a.expires_at - b.expires_at,
    // The badge's word in the label face, which is no narrower than the badge's own.
    fit: (e, m) => BADGE + m(leftWord(e), "medium"),
    cell: (e) => {
      const word = leftWord(e);
      // The last day is amber, as on the Trash card: nothing has failed
      // (red stays for failures; merge point 4 review, I5).
      return (
        <Tooltip content={word} whenTruncated>
          <Badge color={daysUntil(e.expires_at) <= 1 ? "warning" : "gray"} size="small" className="max-w-full">
            <span className="truncate">{word}</span>
          </Badge>
        </Tooltip>
      );
    },
  },
  {
    id: "size", title: (t) => t("trash.colSize"), need: 64, min: 64, max: 120, shown: true, hideable: true, movable: true,
    text: (e) => fmtBytes(e.size_bytes), role: "tabular", compare: (a, b) => a.size_bytes - b.size_bytes,
  },
];
/** The row's hover actions: Restore (74 px) and More (24), 4 apart. */
const ACTIONS_TRACK = 104;

/// The Trash of the space in use: the team's own on its server in a team.
export function TrashPage() {
  return useInTeam() ? <TeamTrashPage /> : <PersonalTrashPage />;
}

/// The Trash, on the one list recipe (F5): select many and Restore them at
/// once, Restore on the row, Delete for good in the row's menu, the bar's
/// menu and on the Delete key (it asks first), and a search.
function PersonalTrashPage() {
  const t = useT();
  const init = useTrash((s) => s.init);
  const reload = useTrash((s) => s.reload);
  // Newest deleted first, as the backend lists them; a column's sort (saved
  // with the layout) is the one order control. The Trash card's Review opens
  // it on Deleted, oldest first: the soonest to go.
  const items = useTrash((s) => s.items);
  const status = useTrash((s) => s.status);
  const loadError = useTrash((s) => s.error);
  const search = useTrash((s) => s.search);
  const setSearch = useTrash((s) => s.setSearch);
  const restore = useTrash((s) => s.restore);
  const purgeMany = useTrash((s) => s.purgeMany);
  // In the store, so the palette acts on the same picks (F25b).
  const selected = useTrash((s) => s.selected);
  const setSelected = useTrash((s) => s.setSelected);
  useEffect(() => { init(); }, [init]);
  // A profile deleted or restored through the API belongs in this list.
  useStoreChanged(reload);

  const shown = useMemo(() => trashShown(items, search), [items, search]);
  // An entry that left the Trash (restored, deleted for good, expired) or
  // that the search hides leaves the selection, as in Profiles and Proxies:
  // the picks are always the ones the list shows, so the mode and the bar
  // never part.
  useEffect(() => {
    const here = new Set(shown.map((e) => e.id));
    if ([...selected].some((id) => !here.has(id))) setSelected(new Set([...selected].filter((id) => here.has(id))));
  }, [shown, selected, setSelected]);
  const byId = useMemo(() => new Map(items.map((e) => [e.id, e])), [items]);
  const entriesOf = useCallback((ids: string[]) => ids.flatMap((id) => byId.get(id) ?? []), [byId]);
  // The bar counts and acts on the picks the list shows.
  const picked = shown.filter((e) => selected.has(e.id));
  const loading = useHeldLoading(status === "idle" || status === "loading");
  const endRoom = useListEndRoom(picked.length > 0);

  const list = useListLayout({
    storageKey: TRASH_LAYOUT_KEY,
    defs: TRASH_COLUMNS,
    items: shown,
    // Typing in the search never moves a column.
    sizingRows: items,
    selectable: true,
    tail: ACTIONS_TRACK,
    actionsLabel: t("profileTable.colActions"),
    // The standard header's height, as every list's (owner, 2026-10-01).
  });
  // No rows (an empty Trash, no match, an error): a plain region the state
  // centers in, as Profiles' and Proxies' lists are.
  const stateShown = !loading && (status === "error" || shown.length === 0);
  // The list keeps its place across page switches (WIG-06, E22a).
  useScrollMemory(list.layout.scrollRef, "trash");
  const layout = stateShown
    ? { ...list.layout, scroll: { ...list.layout.scroll, role: "region", "aria-label": t("trash.title") } }
    : list.layout;
  const backToList = () => {
    const box = list.layout.scrollRef.current;
    (box?.querySelector<HTMLElement>("[data-row-id][tabindex='0']") ?? box)?.focus();
  };

  return (
    <>
      <PageHeader
        title={t("trash.title")}
        titleTour="trash-title"
        count={!loading && status === "ready" && items.length > 0 ? (search.trim() ? { shown: shown.length, total: items.length } : items.length) : undefined}
        help={{ title: t("pageHelp.trash.title"), body: t("pageHelp.trash.body"), onTour: () => showMeAround("trash") }}
        // An empty Trash has no header controls (owner): no search, no menu.
        filter={!loading && status === "ready" && items.length === 0 ? undefined : { value: search, onChange: setSearch }}
        actions={items.length > 0 && (
          // The confirm on Empty trash stays (plan ruling 6).
          <HeaderMenu items={[
            { label: t("trash.restoreAll"), icon: <RestoreIcon className="size-3.5" />, onSelect: () => void useTrash.getState().restoreMany(useTrash.getState().items) },
            { type: "separator" },
            // Empty Trash… is the registry's (one name per command, E8).
            ...menuItemsFor("pageMenu", "trash", { ids: [] }),
          ]} />
        )}
      />
      <PageBody scroll={false} className="relative">
        <ListColumn>
          <DataList<TrashEntry>
            aria-label={t("trash.title")}
            items={list.items}
            columns={list.columns}
            layout={layout}
            getId={(e) => e.id}
            getName={(e) => e.name}
            labels={{
              selectAll: t("dataList.selectAll"),
              select: (name) => t("dataList.select", { name }),
              more: t("pageHeader.more"),
              actions: t("profileTable.colActions"),
              selectedCount: (n) => t("bulkActionsBar.selectedCount", { n }),
              selectionCleared: t("listSelection.cleared"),
            }}
            status={loading ? "loading" : status === "error" ? "error" : "ready"}
            loading={<LoadingRows rows={4} inGrid />}
            error={<LoadError what={t("listStates.trash")} error={loadError} onRetry={() => void init()} />}
            empty={
              items.length > 0 && search.trim()
                ? (
                  <EmptyState
                    icon={<SearchIcon />}
                    title={t("trash.noMatchTitle", { q: search.trim() })}
                    actions={<Button variant="neutral" mode="stroke" size="xsmall" onClick={() => { setSearch(""); refocusPageFilter(); }}>{t("listStates.clearSearch")}</Button>}
                  />
                )
                : <EmptyState icon={<NavTrashIcon />} title={t("trash.emptyTitle")} hint={t("trash.emptyHint")} />
            }
            selected={selected}
            onSelectedChange={setSelected}
            onDelete={(ids) => void purgeMany(entriesOf(ids))}
            rowActions={(e) => (
              <Button
                variant="neutral"
                mode="ghost"
                size="3xsmall"
                leftIcon={<RestoreIcon className="size-3.5" />}
                onClick={(ev) => { ev.stopPropagation(); if (ev.detail > 1) return; void restore(e); }}
              >
                {t("trash.restore")}
              </Button>
            )}
            // The registry's row menu (F25b): Restore, then Delete for good…
            // with its key; the row alone, as the menu's heading names it.
            menuItems={(e) => menuItemsFor("rowMenu", "trash", { ids: [e.id] })}
            bottomInset={endRoom}
          />
          <TrashBulkBar selected={picked} onClear={() => setSelected(new Set())} onClosedWithFocus={backToList} />
        </ListColumn>
      </PageBody>
    </>
  );
}
