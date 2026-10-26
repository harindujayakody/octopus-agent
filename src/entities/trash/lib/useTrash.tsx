import { create } from "zustand";
import { toast } from "../../../shared/model/toast";
import { reportLoadError } from "../../../shared/model/loadError";
import { storeBus } from "../../../shared/lib/storeBus";
import { onSpaceMoved } from "../../../shared/api/invoke";
import { confirmModal } from "../../../shared/lib/confirm";
import { eachReporting } from "../../../shared/lib/eachReporting";
import { t } from "../../../shared/i18n";
import { useTags } from "../../tag";
import { useProfile, useProfileUi } from "../../profile";
import { trashEmpty, trashList, trashPurge, trashRestore } from "../model/api";
import type { TrashEntry } from "../model/types";

/** The Trash list's saved layout: its columns, widths and sort, as every
 *  list's (owner: layouts persist). Its one order control is a column's sort. */
export const TRASH_LAYOUT_KEY = "shardx.trash.layout";

/// The entries the Trash page shows for a search: by name or Folder. The
/// page, and the palette acting on the page's selection, read the same.
export function trashShown(items: TrashEntry[], search: string): TrashEntry[] {
  const q = search.trim().toLowerCase();
  return q ? items.filter((e) => e.name.toLowerCase().includes(q) || e.folder.toLowerCase().includes(q)) : items;
}

/** A read younger than this is current enough for the palette (Pair 45 review, I2). */
const FRESH_MS = 30_000;
/// Entries a restore or a delete for good is taking out right now. A read
/// that lands meanwhile leaves them out, so no ghost row comes back while
/// the backend still lists them; each leaves this set when its call settles,
/// and the read after it shows any that failed.
const leaving = new Set<string>();
const settle = (ids: Iterable<string>) => { for (const id of ids) leaving.delete(id); };
const shownOf = (read: TrashEntry[]) => (leaving.size > 0 ? read.filter((e) => !leaving.has(e.id)) : read);
/// The first read while it runs. A caller that needs the list waits for it
/// rather than returning while it is still loading: the palette's Empty
/// Trash… opened during the palette's own quiet read used to see no entries
/// and ask nothing (merge point 7, trash-list race).
let firstRead: Promise<void> | null = null;

export type TrashStore = {
  status: "idle" | "loading" | "ready" | "error";
  /** When the list was last read (ms); 0 before the first read. */
  readAt: number;
  /** Something outside this store changed the Trash since that read. */
  stale: boolean;
  /** Why the first load failed. */
  error: string | null;
  items: TrashEntry[];
  /** The page's search: by name or Folder. */
  search: string;
  setSearch: (q: string) => void;
  /** The page's picks, here so the palette and the keys act on them (F25b).
   *  Only Esc, the X or the entries leaving the Trash clear it (owner). */
  selected: Set<string>;
  setSelected: (selected: Set<string>) => void;

  /** `quiet`: a read nobody asked for (the palette reading whether Empty
   *  Trash can run) says nothing when it fails; the Trash page shows why
   *  when it opens. */
  init: (opts?: { quiet?: boolean }) => Promise<void>;
  /** `quiet`: a failure says nothing (the Trash page says it). */
  reload: (opts?: { quiet?: boolean }) => Promise<void>;
  /** Reads the Trash quietly only when this copy may be out of date: never
   *  read, older than 30 s, or changed since (the palette, as it opens). */
  refresh: () => Promise<void>;
  restore: (e: TrashEntry) => Promise<void>;
  purge: (e: TrashEntry) => Promise<void>;
  /** Brings several back, one toast for all (IFACE-07). */
  restoreMany: (entries: TrashEntry[]) => Promise<void>;
  /** Deletes several for good after one question that names how many. */
  purgeMany: (entries: TrashEntry[]) => Promise<void>;
  empty: () => Promise<void>;
};

export const useTrash = create<TrashStore>((set, get) => ({
  status: "idle",
  readAt: 0,
  stale: false,
  error: null,
  items: [],
  search: "",
  setSearch: (search) => set({ search }),
  selected: new Set(),
  setSelected: (selected) => set({ selected }),

  init: async (opts) => {
    if (get().status === "loading" && firstRead) return firstRead;
    // Already loaded: refresh in place, the list stays on screen.
    if (get().status === "ready") return get().reload(opts);
    set({ status: "loading", error: null });
    firstRead = (async () => {
      try { const read = await trashList(); set({ items: shownOf(read), status: "ready", readAt: Date.now(), stale: false }); }
      catch (e) { set({ status: "error", error: String(e) }); if (!opts?.quiet) reportLoadError("trash", t("useTrash.loadFailed"), e); }
      finally { firstRead = null; }
    })();
    return firstRead;
  },
  reload: async (opts) => {
    try { const read = await trashList(); set({ items: shownOf(read), readAt: Date.now(), stale: false }); }
    catch (e) { if (!opts?.quiet) toast.fail({ title: t("useTrash.refreshFailed"), detail: e }); }
  },
  refresh: async () => {
    const s = get();
    if (s.status === "loading") return firstRead ?? undefined;
    if (s.status === "ready" && !s.stale && Date.now() - s.readAt < FRESH_MS) return;
    await s.init({ quiet: true });
  },

  restore: async (e) => {
    // Out of the Trash at once (LQ-03); back in its place, with the reason, when it fails.
    const at = get().items.findIndex((x) => x.id === e.id);
    leaving.add(e.id);
    set({ items: get().items.filter((x) => x.id !== e.id) });
    try {
      const meta = await trashRestore(e.id);
      settle([e.id]);
      await useProfile.getState().reload();
      // The profile is on another page: the toast takes you to it (IFACE-14).
      toast.ok(t("useTrash.restored", { name: meta.name }), {
        action: { label: t("toast.showInList"), run: () => { void useProfileUi.getState().showInList(meta.id); } },
      });
    } catch (err) {
      settle([e.id]);
      // A reload meanwhile may have listed it again already.
      if (!get().items.some((x) => x.id === e.id)) {
        const items = [...get().items];
        items.splice(Math.max(0, at), 0, e);
        set({ items });
      }
      toast.fail({ title: t("useTrash.restoreFailed", { name: e.name }), detail: err, subject: e.name });
    }
  },

  purge: async (e) => {
    const ok = await confirmModal({
      title: t("useTrash.purgeTitle", { name: e.name }),
      message: t("useTrash.purgeMessage", { name: e.name }),
      confirmLabel: t("useTrash.purgeConfirm"),
      danger: true,
    });
    if (ok !== true) return;
    leaving.add(e.id);
    try {
      await trashPurge(e.id);
      settle([e.id]);
      // Gone for good: its tags go with it.
      useTags.getState().forgetProfiles([e.id]);
      await get().reload();
    }
    catch (err) { settle([e.id]); toast.fail({ title: t("useTrash.purgeFailed", { name: e.name }), detail: err, subject: e.name }); }
  },

  restoreMany: async (entries) => {
    if (entries.length === 0) return;
    if (entries.length === 1) return get().restore(entries[0]);
    // Out of the Trash at once, as one restore is (LQ-03); a reload puts back
    // any that failed.
    const gone = new Set(entries.map((e) => e.id));
    for (const id of gone) leaving.add(id);
    set({ items: get().items.filter((x) => !gone.has(x.id)) });
    const { done, failed, firstError } = await eachReporting([...gone], (id) => trashRestore(id));
    settle(gone);
    await Promise.all([get().reload(), useProfile.getState().reload()]);
    if (failed.length > 0) toast.fail({ title: t("useTrash.restoredSome", { n: done.length, total: entries.length, failed: failed.length }), detail: firstError });
    else toast.ok(t("useTrash.restoredMany", { n: done.length }));
  },

  purgeMany: async (entries) => {
    if (entries.length === 0) return;
    if (entries.length === 1) return get().purge(entries[0]);
    const n = entries.length;
    const ok = await confirmModal({
      title: t("useTrash.purgeManyTitle", { n }),
      message: t("useTrash.purgeManyMessage"),
      danger: true,
      buttons: [
        { label: t("confirm.cancel"), value: false },
        { label: t("useTrash.purgeManyConfirm", { n }), value: true, danger: true },
      ],
    });
    if (ok !== true) return;
    const ids = entries.map((e) => e.id);
    for (const id of ids) leaving.add(id);
    const { done, failed, firstError } = await eachReporting(ids, (id) => trashPurge(id));
    settle(ids);
    // Gone for good: their tags go with them.
    useTags.getState().forgetProfiles(done);
    await get().reload();
    if (failed.length > 0) toast.fail({ title: t("useTrash.purgedSome", { failed: failed.length }), detail: firstError });
  },

  empty: async () => {
    const n = get().items.length;
    if (n === 0) return;
    const ok = await confirmModal({
      title: t("useTrash.emptyTitle"),
      message: n === 1 ? t("useTrash.emptyMessageOne") : t("useTrash.emptyMessageMany", { n }),
      confirmLabel: t("useTrash.emptyConfirm"),
      danger: true,
    });
    if (ok !== true) return;
    const ids = get().items.map((x) => x.id);
    for (const id of ids) leaving.add(id);
    try {
      await trashEmpty();
      settle(ids);
      useTags.getState().forgetProfiles(ids);
      await get().reload();
      toast.ok(n === 1 ? t("useTrash.deletedOne") : t("useTrash.deletedMany", { n }));
    } catch (err) { settle(ids); toast.fail({ title: t("useTrash.emptyFailed"), detail: err }); }
  },
}));

// Profiles moved in or out from elsewhere (Move to Trash, its Undo, another
// window): the next palette opening reads the Trash again.
storeBus.on("trash", (from) => { if (from !== "trash") useTrash.setState({ stale: true }); });

// Another space has a trash of its own (a team's shows none here): read afresh.
onSpaceMoved(() => {
  const was = useTrash.getState().status;
  useTrash.setState({ status: "idle", error: null, items: [], selected: new Set<string>(), readAt: 0, stale: true });
  if (was !== "idle") void useTrash.getState().init({ quiet: true });
});
