import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, DataList, DialogModal, EmptyState, IconButton, SegmentControl, Tooltip, useLatched } from "@proxyshard/shardx-ui-kit";
import { PageBody, PageHeader } from "../../widgets/PageHeader";
import { useStoreChanged } from "../../shared/hooks/useStoreChanged";
import { useHeldLoading } from "../../shared/hooks/useHeldLoading";
import { useArrivedIds } from "../../shared/hooks/useArrivedIds";
import { Field } from "../../shared/ui/Field";
import { AddIcon, DownloadIcon, NavBookmarksIcon, SearchIcon } from "../../shared/icons";
import { LoadError, LoadingRows } from "../../shared/ui/ListStates";
import { ListColumn, useListEndRoom } from "../../shared/ui/ListColumn";
import { useListLayout, type ListColumnDef } from "../../shared/ui/listHeader";
import { rowActionIcons } from "../../shared/ui/rowActionIcons";
import { isFullUrl, readableUrl } from "../../shared/lib/utils";
import {
  useBookmarks, emptyBookmark, bookmarkName, BookmarkFolderSelect, bookmarkSets, type Bookmark,
  BOOKMARK_TAB_ALL as TAB_ALL, BOOKMARK_TAB_ANY as TAB_ANY, bookmarkFolderTab as folderTab, bookmarkTabFolder as tabFolder,
  bookmarkSetTab as setTab, bookmarkTabSet as tabSet,
} from "../../entities/bookmark";
import { useFolders, useProfile } from "../../entities/profile";
import { teamRefusal, useInTeam, useRightsChange } from "../../entities/space";
import { translate, useLang, useT } from "../../shared/i18n";
import { useScrollMemory } from "../../shared/model/scrollMemory";
import { refocusPageFilter } from "../../shared/lib/focus";
import { useDialogLife } from "../../shared/lib/useDialogLife";
import { capOf, command, labelOf, runCommand } from "../../features/commands";
import { showMeAround } from "../../features/tour";
import { ImportBookmarksDialog } from "../../features/import-bookmarks";

type BookmarkColumn = "name" | "address" | "shows";
/** A bookmark as the list shows it: with the words for where it shows. */
type BookmarkRow = { bookmark: Bookmark; shows: string };

// A real table (CRAFT-27, LAYOUT-13): a header row, 36 px rows, the address
// without its "https://" (whole on hover). The columns size to their content
// and are the person's to size, move, hide and sort, saved under
// `shardx.bookmarks.layout` (owner: layouts persist).
const BOOKMARK_COLUMNS: readonly ListColumnDef<BookmarkColumn, BookmarkRow>[] = [
  {
    id: "name", title: (t) => t("bookmarks.colName"), need: 160, min: 140, max: 480, shown: true, hideable: false, movable: false,
    text: (r) => bookmarkName(r.bookmark), compare: (a, b) => bookmarkName(a.bookmark).localeCompare(bookmarkName(b.bookmark)),
  },
  {
    id: "address", title: (t) => t("bookmarks.colAddress"), need: 160, min: 120, max: 480, shown: true, hideable: true, movable: true,
    text: (r) => readableUrl(r.bookmark.url), role: "mono",
    compare: (a, b) => readableUrl(a.bookmark.url).localeCompare(readableUrl(b.bookmark.url)),
    // The whole address, scheme and all, on hover, cut or not: read, not encoded.
    cell: (r) => (
      <Tooltip content={readableUrl(r.bookmark.url, true)}>
        <span className="block truncate text-mono text-text-sub-600">{readableUrl(r.bookmark.url)}</span>
      </Tooltip>
    ),
  },
  {
    id: "shows", title: (t) => t("bookmarks.showsIn"), need: 140, min: 120, max: 320, shown: true, hideable: true, movable: true,
    text: (r) => r.shows, role: "secondary", compare: (a, b) => a.shows.localeCompare(b.shows),
  },
];
/** The row's quiet actions: Edit and More (24 px each), 4 apart. */
const ACTIONS_TRACK = 52;

function Editor({ open, initial, folders, sets, team, onClose }: {
  open: boolean;
  initial: Bookmark;
  folders: string[];
  /** The sets the bookmarks name already, offered as one-click picks. */
  sets: string[];
  /** A team's bookmarks have no sets. */
  team: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [b, setB] = useState(initial);
  const save = useBookmarks((s) => s.save);
  // A team's: a new one needs Create, a change Edit; without it the editor only shows.
  useRightsChange();
  const refused = teamRefusal(initial.id ? "edit" : "create");
  // Any field other than it opened with: Esc, the close button and Cancel ask first.
  const dirty = b.url !== initial.url || b.title !== initial.title || b.folder !== initial.folder || (b.set ?? "") !== (initial.set ?? "");
  // An unfinished address ("https://goog") is said on Save, in the field; the
  // message stays until the address is whole, and goes as soon as it is. An
  // address that was saved and not touched is never judged: the backend took
  // it (chrome://flags, a file), and its title or folder can still change.
  const [tried, setTried] = useState(false);
  const urlOk = (initial.id !== "" && b.url === initial.url) || isFullUrl(b.url);
  const urlBad = tried && !urlOk;
  const urlRef = useRef<HTMLDivElement>(null);
  const submit = () => {
    if (!urlOk) {
      setTried(true);
      urlRef.current?.querySelector("input")?.focus();
      return;
    }
    void save(b);
  };
  return (
    <DialogModal
      open={open}
      onClose={onClose}
      dirty={dirty}
      title={initial.id ? t("bookmarks.editTitle") : t("bookmarks.newTitle")}
      confirmLabel={t("bookmarks.save")}
      onConfirm={submit}
      isDisabled={!!refused}
      footerNote={refused ?? undefined}
      cancelLabel={t("bookmarks.cancel")}
      onCancel={onClose}
    >
      {/* Without the right it opens to read: the fields show, nothing changes. */}
      <fieldset disabled={!!refused} className="m-0 flex w-full min-w-0 flex-col gap-3 border-0 py-4 px-0">
        <div ref={urlRef}>
          <Field
            label={t("bookmarks.urlLabel")}
            value={b.url}
            onChange={(v) => setB({ ...b, url: v })}
            placeholder="facebook.com/ads/manager"
            mono
            error={urlBad ? t("bookmarks.urlIncomplete") : undefined}
          />
        </div>
        <Field
          label={t("bookmarks.titleLabel")}
          value={b.title}
          onChange={(v) => setB({ ...b, title: v })}
          placeholder={t("bookmarks.titlePlaceholder")}
        />
        <BookmarkFolderSelect
          label={t("bookmarks.folderLabel")}
          value={b.folder}
          folders={folders}
          onChange={(v) => setB({ ...b, folder: v })}
        />
        {!team && (
          <div className="flex flex-col gap-1.5">
            <Field
              label={t("bookmarks.setLabel")}
              value={b.set ?? ""}
              onChange={(v) => setB({ ...b, set: v })}
              placeholder={t("bookmarks.setPlaceholder")}
            />
            {sets.length > 0 && (
              <div role="group" aria-label={t("bookmarks.setPick")} className="flex flex-wrap gap-1.5">
                {sets.map((s) => (
                  <Button key={s} variant={b.set === s ? "primary" : "neutral"} mode={b.set === s ? "lighter" : "stroke"} size="3xsmall" aria-pressed={b.set === s} onClick={() => setB({ ...b, set: b.set === s ? "" : s })}>
                    {s}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="m-0 text-secondary text-text-soft-400">
          {t.rich("bookmarks.hint", { b: (s) => <strong>{s}</strong> })}
        </p>
      </fieldset>
    </DialogModal>
  );
}

export function BookmarksPage() {
  const t = useT();
  const init = useBookmarks((s) => s.init);
  const items = useBookmarks((s) => s.items);
  const status = useBookmarks((s) => s.status);
  const loadError = useBookmarks((s) => s.error);
  const editing = useBookmarks((s) => s.editing);
  const setEditing = useBookmarks((s) => s.setEditing);
  // Stays mounted, with the bookmark it opened on, through its exit (FEEL-01).
  const editLife = useDialogLife(editing != null);
  const editingShown = useLatched(editing);
  const remove = useBookmarks((s) => s.remove);
  const search = useBookmarks((s) => s.search);
  const setSearch = useBookmarks((s) => s.setSearch);
  const folder = useBookmarks((s) => s.folder);
  const setFolder = useBookmarks((s) => s.setFolder);

  const inTeam = useInTeam();
  const initProfiles = useProfile((s) => s.init);
  const folders = useFolders();
  const profiles = useProfile((s) => s.profiles);
  const profilesReady = useProfile((s) => s.status === "ready");

  const reload = useBookmarks((s) => s.reload);
  useEffect(() => { init(); initProfiles(); }, [init, initProfiles]);
  useStoreChanged(reload);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (b) =>
        (folder === TAB_ALL
          || (tabSet(folder) !== null ? (b.set ?? "") === tabSet(folder)
            : folder === TAB_ANY ? b.folder === "" && !b.set : b.folder === tabFolder(folder))) &&
        (!q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q) || readableUrl(b.url).toLowerCase().includes(q)),
    );
  }, [items, search, folder]);

  // Where a bookmark shows: its Folder's profiles, or every profile. Kept
  // while the profiles and the language stay (`useT` is new each render),
  // so the columns measure again only when a word changes.
  const lang = useLang((s) => s.lang);
  const showsIn = useCallback((b: Bookmark) => {
    // The language's words, by a literal t("…") so check:i18n sees the keys.
    const t = (key: string, vars: Record<string, string | number>) => translate(lang, key, vars);
    if (b.set) {
      const n = profiles.filter((p) => p.bookmark_sets?.includes(b.set!) && (!b.folder || p.folder === b.folder)).length;
      return t("bookmarks.setProfileCount", { set: b.set, n });
    }
    if (!b.folder) return t("bookmarks.everyProfileCount", { n: profiles.length });
    const n = profiles.filter((p) => p.folder === b.folder).length;
    return n === 1 ? t("bookmarks.folderProfileCountOne", { folder: b.folder }) : t("bookmarks.folderProfileCount", { folder: b.folder, n });
  }, [profiles, lang]);
  const sets = useMemo(() => bookmarkSets(items), [items]);
  const rows = useMemo(() => shown.map((b): BookmarkRow => ({ bookmark: b, shows: showsIn(b) })), [shown, showsIn]);
  const allRows = useMemo(() => items.map((b): BookmarkRow => ({ bookmark: b, shows: showsIn(b) })), [items, showsIn]);

  const tabs = [
    { id: TAB_ALL, label: t("bookmarks.tabAll") },
    { id: TAB_ANY, label: t("bookmarks.tabEveryProfile") },
    ...folders.map((f) => ({ id: folderTab(f), label: f })),
    ...sets.map((s) => ({ id: setTab(s), label: t("bookmarks.setTab", { set: s }) })),
  ];

  const loading = useHeldLoading(status === "idle" || status === "loading");
  // No bookmarks at all: nothing to count, filter or narrow to a Folder (LAYOUT-20).
  const empty = status === "ready" && items.length === 0;
  // The Folder chips and the field hide with the last bookmark: back to All,
  // with no query, so nothing hidden still narrows the page or picks the
  // Folder a new bookmark goes into (Pair 3 review, Minor 9).
  useEffect(() => {
    if (!empty) return;
    setFolder(TAB_ALL);
    setSearch("");
  }, [empty, setFolder, setSearch]);
  // A Folder tab whose Folder was renamed or deleted in Profiles: back to
  // All, and the list with it, rather than a filter on nothing with no tab
  // checked (Pair 28 review M4, PC-083's shape). Only once the profiles are
  // loaded, so a first render with no Folders yet never resets a real choice.
  useEffect(() => {
    if (!profilesReady || folder === TAB_ALL || folder === TAB_ANY || folders.includes(tabFolder(folder) ?? "") || sets.includes(tabSet(folder) ?? "\u0000")) return;
    setFolder(TAB_ALL);
  }, [profilesReady, folder, folders, sets, setFolder]);

  const list = useListLayout({
    storageKey: "shardx.bookmarks.layout",
    defs: BOOKMARK_COLUMNS,
    items: rows,
    // Typing in the search or picking a Folder never moves a column.
    sizingRows: allRows,
    selectable: false,
    tail: ACTIONS_TRACK,
    actionsLabel: t("profileTable.colActions"),
  });
  // The list scrolls itself; it keeps its place across page switches (WIG-06).
  useScrollMemory(list.layout.scrollRef, "bookmarks");
  // A new bookmark (or one added through the API) slides in once.
  const arrived = useArrivedIds(items.map((b) => b.id), status === "ready");
  const endRoom = useListEndRoom(false);
  // No rows (nothing yet, no match, an error): a plain region the state
  // centers in, with no header row (owner), as the Trash's is.
  const stateShown = !loading && (status === "error" || shown.length === 0);
  const layout = stateShown
    ? { ...list.layout, scroll: { ...list.layout.scroll, role: "region", "aria-label": t("bookmarks.heading") } }
    : list.layout;
  // A team's rules: making, changing and deleting a bookmark each need their right in the team.
  useRightsChange();
  const noCreate = teamRefusal("create");
  const noDelete = teamRefusal("delete");
  const newBookmark = () => { if (!noCreate) setEditing(emptyBookmark(tabFolder(folder) ?? "", tabSet(folder) ?? "")); };
  // The registry's Import from Chrome: a file picker, then its dialog.
  const importChrome = () => void runCommand(command("bookmark.import"), { ids: [] }, { from: "pageMenu" });

  const emptyState = items.length > 0 && search.trim() ? (
    <EmptyState
      icon={<SearchIcon />}
      title={t("bookmarks.noMatchTitle", { q: search.trim() })}
      actions={<Button variant="neutral" mode="stroke" size="xsmall" onClick={() => { setSearch(""); refocusPageFilter(); }}>{t("listStates.clearSearch")}</Button>}
    />
  ) : (
    <EmptyState
      icon={<NavBookmarksIcon />}
      title={items.length === 0 ? t("bookmarks.emptyTitle") : t("bookmarks.emptyFolderTitle")}
      hint={t("bookmarks.emptyHint")}
      action={noCreate ? undefined : { label: t("bookmarks.emptyAction"), icon: <AddIcon />, onClick: newBookmark }}
      secondary={noCreate ? undefined : { label: labelOf("bookmark.import"), onClick: importChrome }}
    />
  );

  return (
    <>
      <PageHeader
        title={t("bookmarks.heading")}
        count={!loading && status === "ready" && !empty ? shown.length : undefined}
        help={{ title: t("pageHelp.bookmarks.title"), body: t("pageHelp.bookmarks.body"), onTour: () => showMeAround("bookmarks") }}
        filter={empty ? undefined : { value: search, onChange: setSearch }}
        actions={
          <>
            {/* One secondary action: a button of its own, not a menu of one (EMIL-20);
                an icon in a narrow header, so the title keeps its room. */}
            <span className="flex @max-[540px]:hidden">
              <Tooltip content={noCreate ?? undefined}>
                <Button variant="neutral" mode="stroke" size="xsmall" leftIcon={<DownloadIcon className="size-3.5" />} disabled={!!noCreate} aria-description={noCreate ?? undefined} onClick={importChrome}>
                  {labelOf("bookmark.import")}
                </Button>
              </Tooltip>
            </span>
            <span className="flex @min-[540px]:hidden">
              <IconButton label={noCreate ? t("rights.labelWhy", { label: labelOf("bookmark.import"), why: noCreate }) : labelOf("bookmark.import")} icon={<DownloadIcon className="size-3.5" />} mode="stroke" size="xsmall" tooltipSide="bottom" disabled={!!noCreate} onClick={importChrome} />
            </span>
            {/* The registry's New bookmark: its words, and its key (C) in the tooltip. */}
            <Tooltip content={noCreate ?? labelOf("bookmark.new")} shortcut={noCreate ? undefined : capOf(command("bookmark.new"))}>
              <Button
                variant="primary" mode="filled" size="xsmall" leftIcon={<AddIcon className="size-3.5" />}
                data-tour="new-bookmark"
                disabled={!!noCreate}
                aria-description={noCreate ?? undefined}
                onClick={() => void runCommand(command("bookmark.new"), { ids: [] }, { from: "pageMenu" })}
              >
                {labelOf("bookmark.new")}
              </Button>
            </Tooltip>
          </>
        }
      />
      <PageBody scroll={false} className="relative">
        {!empty && (
          // Many Folders scroll sideways inside this row, never the page
          // (LAYOUT-13). p-1.5 with -m-1.5: room for a focused tab's ring
          // (2 px + 2 px offset, 5 px at high contrast), which the scroll box
          // would clip; the tabs stay where they were. The same room when a
          // key scrolls a tab into view (scroll-px-1.5).
          <div className="-mx-1.5 -mt-1.5 mb-2 shrink-0 scroll-px-1.5 overflow-x-auto p-1.5">
            {/* The same tabs as the Fingerprints OS filter (owner): a segment
                at its own width, one control for a list's filter row. */}
            <SegmentControl
              fit
              size="xsmall"
              aria-label={t("bookmarks.folderLabel")}
              value={folder}
              items={tabs.map((tab) => ({ value: tab.id, label: tab.label }))}
              onChange={setFolder}
            />
          </div>
        )}

        {/* The list scrolls itself; the page does not. No bulk selection:
            there is little to act on in bulk. A row opens its editor (a
            click, Enter); Edit on hover, Delete in its menu, not a red
            button on every row (CRAFT-03, IFACE-11). */}
        <ListColumn>
          <DataList<BookmarkRow>
            aria-label={t("bookmarks.heading")}
            items={list.items}
            columns={list.columns}
            layout={layout}
            getId={(r) => r.bookmark.id}
            getName={(r) => bookmarkName(r.bookmark)}
            // An address as a menu heading: cut in the middle, its end kept.
            menuHeadingTruncate="middle"
            labels={{ selectAll: t("dataList.selectAll"), select: (name) => t("dataList.select", { name }), more: t("pageHeader.more"), actions: t("profileTable.colActions") }}
            status={loading ? "loading" : status === "error" ? "error" : "ready"}
            loading={<LoadingRows rows={4} inGrid />}
            error={<LoadError what={t("listStates.bookmarks")} error={loadError} onRetry={() => void init()} />}
            empty={emptyState}
            arrived={arrived}
            onOpen={(r) => setEditing(r.bookmark)}
            onDelete={(ids) => {
              for (const id of ids) {
                const b = items.find((x) => x.id === id);
                if (b) void remove(b);
              }
            }}
            rowActions={(r) => (
              <IconButton
                size="3xsmall"
                label={t("bookmarks.editTooltip")}
                icon={rowActionIcons.edit({ className: "size-3.5" })}
                onClick={(e) => { e.stopPropagation(); setEditing(r.bookmark); }}
              />
            )}
            menuItems={(r) => [
              { label: t("bookmarks.editTooltip"), icon: rowActionIcons.edit({ className: "size-3.5" }), onSelect: () => setEditing(r.bookmark) },
              { type: "separator" },
              { label: t("bookmarks.delete"), icon: rowActionIcons.trash({ className: "size-3.5" }), danger: true, disabled: !!noDelete, hint: noDelete ?? undefined, onSelect: () => void remove(r.bookmark) },
            ]}
            bottomInset={endRoom}
          />
        </ListColumn>
      </PageBody>

      {editLife.mounted && editingShown && (
        <Editor key={editLife.session} open={editing != null} initial={editingShown} folders={folders} sets={sets} team={inTeam} onClose={() => setEditing(null)} />
      )}
      <ImportBookmarksDialog folders={folders} sets={sets} team={inTeam} />
    </>
  );
}
