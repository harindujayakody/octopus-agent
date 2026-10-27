import { create } from "zustand";
import { toast } from "../../../shared/model/toast";
import { reportLoadError } from "../../../shared/model/loadError";
import { deferDelete, isPendingDelete } from "../../../shared/lib/deferDelete";
import { onSpaceMoved } from "../../../shared/api/invoke";
import { t } from "../../../shared/i18n";
import { bookmarkDelete, bookmarkList, bookmarkSave } from "../model/api";
import { teamRefusal } from "../../space";
import type { Bookmark } from "../model/types";
import { bookmarkName } from "./name";

// A bookmark deleted behind its Undo toast stays out of every read until the toast goes.
const living = (items: Bookmark[]) => items.filter((x) => !isPendingDelete(`bookmark:${x.id}`));

export const emptyBookmark = (folder = "", set = ""): Bookmark => ({
  id: "",
  title: "",
  url: "",
  folder,
  set,
});

/** Every set the bookmarks name, sorted. */
export const bookmarkSets = (items: Bookmark[]): string[] =>
  [...new Set(items.map((b) => (b.set ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

// The page's tabs: All, Every profile, one per Folder. A Folder's tab has a
// prefix, so a Folder named "all" is still a tab of its own.
export const BOOKMARK_TAB_ALL = "all";
export const BOOKMARK_TAB_ANY = "any";
export const bookmarkFolderTab = (name: string) => `folder:${name}`;
/** The Folder a tab shows, or null on All and Every profile. */
export const bookmarkTabFolder = (tab: string) => (tab.startsWith("folder:") ? tab.slice(7) : null);
export const bookmarkSetTab = (name: string) => `set:${name}`;
/** The set a tab shows, or null on any other tab. */
export const bookmarkTabSet = (tab: string) => (tab.startsWith("set:") ? tab.slice(4) : null);

export type BookmarkStore = {
  status: "idle" | "loading" | "ready" | "error";
  /** Why the first load failed. */
  error: string | null;
  items: Bookmark[];
  /** Open editor, or null. */
  editing: Bookmark | null;
  search: string;
  /** The page's tab (BOOKMARK_TAB_ALL shows everything), not a bookmark's folder. */
  folder: string;

  init: () => Promise<void>;
  reload: () => Promise<void>;
  setEditing: (b: Bookmark | null) => void;
  setSearch: (q: string) => void;
  setFolder: (f: string) => void;
  save: (b: Bookmark) => Promise<void>;
  remove: (b: Bookmark) => Promise<void>;
};

export const useBookmarks = create<BookmarkStore>((set, get) => ({
  status: "idle",
  error: null,
  items: [],
  editing: null,
  search: "",
  folder: BOOKMARK_TAB_ALL,

  init: async () => {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading", error: null });
    try {
      set({ items: living(await bookmarkList()), status: "ready" });
    } catch (e) {
      set({ status: "error", error: String(e) });
      reportLoadError("bookmarks", t("useBookmarks.loadFailed"), e);
    }
  },
  reload: async () => {
    try { set({ items: living(await bookmarkList()) }); }
    catch (e) { toast.fail({ title: t("useBookmarks.refreshFailed"), detail: e }); }
  },
  setEditing: (editing) => set({ editing }),
  setSearch: (search) => set({ search }),
  setFolder: (folder) => set({ folder }),

  save: async (b) => {
    const name = bookmarkName(b);
    // A team's: a new one needs Create, a change Edit, in the team.
    const refused = teamRefusal(b.id ? "edit" : "create");
    if (refused) { toast.fail({ title: t("useBookmarks.saveFailed", { name }), detail: refused, subject: name }); return; }
    try {
      await bookmarkSave(b);
      set({ editing: null });
      await get().reload();
      toast.saved(t("useBookmarks.saved", { name }));
    } catch (e) {
      toast.fail({ title: t("useBookmarks.saveFailed", { name }), detail: e, subject: name });
    }
  },

  // Behind an Undo toast, nothing asked (ruling 18).
  remove: async (b) => {
    const name = bookmarkName(b);
    // Refused by a team's rules: it never leaves the list, so it never comes back.
    const refused = teamRefusal("delete");
    if (refused) { toast.fail({ title: t("useBookmarks.deleteFailed", { name }), detail: refused }); return; }
    deferDelete({
      key: `bookmark:${b.id}`,
      title: t("useBookmarks.deleted", { name }),
      failTitle: t("useBookmarks.deleteFailed", { name }),
      hide: () => set({ items: get().items.filter((x) => x.id !== b.id) }),
      restore: () => void get().reload(),
      commit: async () => { await bookmarkDelete(b.id); await get().reload(); },
    });
  },
}));

// Another space: its bookmarks are read afresh, nothing of the old ones shows or stays open.
onSpaceMoved(() => {
  const was = useBookmarks.getState().status;
  useBookmarks.setState({ status: "idle", error: null, items: [], editing: null, folder: BOOKMARK_TAB_ALL });
  if (was !== "idle") void useBookmarks.getState().init();
});
