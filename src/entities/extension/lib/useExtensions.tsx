import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "../../../shared/model/toast";
import { reportLoadError } from "../../../shared/model/loadError";
import { deferDelete, isPendingDelete } from "../../../shared/lib/deferDelete";
import { onSpaceMoved } from "../../../shared/api/invoke";
import { storeBus } from "../../../shared/lib/storeBus";
import { t } from "../../../shared/i18n";
import { extensionDelete, extensionImport, extensionImportUrl, extensionList } from "../model/api";
import { confirmModal } from "../../../shared/model/confirm";
import { inTeam, teamRefusal } from "../../space";
import { extensionLinkAllowed, normalizeExtensionLink } from "../model/link";
import { extensionName } from "../model/name";
import { parseAlreadyInLibrary } from "../model/updates";
import { explainError } from "../../../shared/lib/errors";
import type { AlreadyInLibrary, ExtensionEntry, ExtensionImport } from "../model/types";
import { useExtensionUpdates } from "./useExtensionUpdates";

// An extension removed behind its Undo toast stays out of every read until the toast goes.
const living = (items: ExtensionEntry[]) => items.filter((x) => !isPendingDelete(`extension:${x.id}`));

/** Two sentences: no space after a full-width stop (Chinese "。"). */
const joined = (a: string, b: string) => (/[。！？]$/.test(a) ? a + b : `${a} ${b}`);

/** Each refused file on a line of its own: its name and why. */
const refusals = (r: ExtensionImport) =>
  r.refused.map((x) => `${x.path.split(/[\\/]/).pop() || x.path}: ${explainError(x.error) ?? x.error}`).join("\n");

/** The library holds it already (§3.1.6): Update it, or a copy beside when the copy's id would differ. */
async function askAlreadyThere(found: AlreadyInLibrary, addCopy: () => Promise<void>) {
  const find = () => useExtensions.getState().items.find((x) => x.id === found.entry_id);
  if (!find()) await useExtensions.getState().reload();
  const entry = find();
  const name = entry ? extensionName(entry) : found.entry_id;
  // A team's extensions get no updates here yet (v1): it only says so.
  if (inTeam() || !entry) { toast.info(t("extensions.alreadyInLibraryTitle", { name })); return; }
  // Update it only where there is one to put in, or one the store may have:
  // not for one up to date, nor for one not linked to the Web Store.
  const u = useExtensionUpdates.getState().byId[entry.id];
  const updatable = !!u && u.state !== "current" && u.state !== "unlinked";
  const body = updatable ? t("extensions.alreadyInLibraryBody", { version: found.installed })
    : u?.state === "current" ? t("extensions.alreadyUpToDate", { version: found.installed })
      : t("extensions.alreadyInstalled", { version: found.installed });
  // Nothing to update and no copy to add: said, not asked.
  if (!updatable && !found.separate) { toast.info(t("extensions.alreadyInLibraryTitle", { name }), { detail: body }); return; }
  const pick = await confirmModal({
    title: t("extensions.alreadyInLibraryTitle", { name }),
    message: found.separate ? joined(body, t("extensions.separateCopyHelp")) : body,
    buttons: updatable ? [
      { label: t("extensions.cancel"), value: null },
      ...(found.separate ? [{ label: t("extensions.addSeparateCopy"), value: "copy" }] : []),
      { label: t("extensions.updateExisting"), value: "update", primary: true },
    ] : [
      { label: t("extensions.addSeparateCopy"), value: "copy" },
      { label: t("extensions.cancel"), value: null, primary: true },
    ],
  });
  if (pick === "update") await useExtensionUpdates.getState().update(entry);
  else if (pick === "copy") await addCopy();
}

export type ExtensionStore = {
  status: "idle" | "loading" | "ready" | "error";
  /** Why the first load failed. */
  error: string | null;
  items: ExtensionEntry[];
  busy: boolean;
  search: string;
  /// The "paste a link" dialog.
  linkOpen: boolean;

  init: () => Promise<void>;
  reload: () => Promise<void>;
  setSearch: (q: string) => void;
  setLinkOpen: (open: boolean) => void;
  /** `separate`: a copy beside the one the library holds (§3.1.6). */
  importUrl: (url: string, separate?: boolean) => Promise<void>;
  importFiles: () => Promise<void>;
  importFolder: () => Promise<void>;
  remove: (e: ExtensionEntry) => Promise<void>;
};

export const useExtensions = create<ExtensionStore>((set, get) => ({
  status: "idle",
  error: null,
  items: [],
  busy: false,
  search: "",
  linkOpen: false,

  init: async () => {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading", error: null });
    try {
      set({ items: living(await extensionList()), status: "ready" });
    } catch (e) {
      set({ status: "error", error: String(e) });
      reportLoadError("extensions", t("useExtensions.loadFailed"), e);
    }
  },
  reload: async () => {
    try {
      set({ items: living(await extensionList()) });
      storeBus.emit("extensions");
    } catch (e) { toast.fail({ title: t("useExtensions.refreshFailed"), detail: e }); }
  },
  setSearch: (search) => set({ search }),
  setLinkOpen: (linkOpen) => set({ linkOpen }),

  importUrl: async (url, separate = false) => {
    const link = normalizeExtensionLink(url);
    if (!link) return;
    // A bare id or a parsed https URL only, whoever calls (SEC-08; the
    // backend should refuse anything else too, B8).
    if (!extensionLinkAllowed(link)) { toast.err(t("extensions.linkHttp")); return; }
    // A team's are added with Create in the team.
    const refused = teamRefusal("create");
    if (refused) { toast.fail({ title: t("useExtensions.downloadFailed"), detail: refused }); return; }
    set({ busy: true });
    try {
      const added = await extensionImportUrl(link, separate);
      await get().reload();
      set({ linkOpen: false });
      toast.ok(t("useExtensions.addedNamed", { name: extensionName(added) }));
    } catch (e) {
      const found = parseAlreadyInLibrary(e);
      if (found && !separate) {
        set({ linkOpen: false });
        void askAlreadyThere(found, () => get().importUrl(link, true));
      } else toast.fail({ title: t("useExtensions.downloadFailed"), detail: e });
    }
    finally { set({ busy: false }); }
  },

  importFiles: async () => {
    const refused = teamRefusal("create");
    if (refused) { toast.fail({ title: t("useExtensions.importFilesFailed"), detail: refused }); return; }
    const picked = await open({
      multiple: true,
      title: t("useExtensions.pickFilesTitle"),
      filters: [{ name: t("useExtensions.fileFilter"), extensions: ["crx", "zip"] }],
    });
    const paths = (Array.isArray(picked) ? picked : picked ? [picked] : []) as string[];
    if (paths.length === 0) return;
    const add = async (separate: boolean) => {
      set({ busy: true });
      try {
        const r = await extensionImport(paths, separate);
        await get().reload();
        const n = r.added.length;
        // One file refused alone is asked about as before; several are listed.
        if (n === 0 && r.refused.length === 1) throw r.refused[0].error;
        if (n === 0) toast.fail({ title: t("useExtensions.importFilesFailed"), detail: refusals(r) });
        else if (r.refused.length > 0) toast.warn({ title: t("useExtensions.addedSome", { n, total: paths.length }), detail: refusals(r) });
        else toast.ok(n === 1 ? t("useExtensions.addedCountOne", { n }) : t("useExtensions.addedCountMany", { n }));
      } catch (e) {
        const found = paths.length === 1 ? parseAlreadyInLibrary(e) : null;
        if (found && !separate) void askAlreadyThere(found, () => add(true));
        else toast.fail({ title: t("useExtensions.importFilesFailed"), detail: e });
      }
      finally { set({ busy: false }); }
    };
    await add(false);
  },

  importFolder: async () => {
    const refused = teamRefusal("create");
    if (refused) { toast.fail({ title: t("useExtensions.importFolderFailed"), detail: refused }); return; }
    const dir = await open({ directory: true, title: t("useExtensions.pickFolderTitle") });
    if (typeof dir !== "string") return;
    const add = async (separate: boolean) => {
      set({ busy: true });
      try {
        const r = await extensionImport([dir], separate);
        await get().reload();
        if (r.refused.length > 0) throw r.refused[0].error;
        toast.ok(r.added.length > 0
          ? t("useExtensions.addedFolderNamed", { name: extensionName(r.added[0]) })
          : t("useExtensions.nothingAdded"));
      } catch (e) {
        const found = separate ? null : parseAlreadyInLibrary(e);
        if (found) void askAlreadyThere(found, () => add(true));
        else toast.fail({ title: t("useExtensions.importFolderFailed"), detail: e });
      }
      finally { set({ busy: false }); }
    };
    await add(false);
  },

  // Behind an Undo toast, nothing asked (ruling 18).
  remove: async (e) => {
    // The name as a card shows it, never a path.
    const name = extensionName(e);
    // Refused by a team's rules: it never leaves the list, so it never comes back.
    const refused = teamRefusal("delete");
    if (refused) { toast.fail({ title: t("useExtensions.removeFailed", { name }), detail: refused }); return; }
    deferDelete({
      key: `extension:${e.id}`,
      title: t("useExtensions.removed", { name }),
      failTitle: t("useExtensions.removeFailed", { name }),
      hide: () => set({ items: get().items.filter((x) => x.id !== e.id) }),
      restore: () => void get().reload(),
      commit: async () => { await extensionDelete(e.id); await get().reload(); },
    });
  },
}));

// Another space: its extensions are read afresh, nothing of the old ones shows.
onSpaceMoved(() => {
  const was = useExtensions.getState().status;
  useExtensions.setState({ status: "idle", error: null, items: [], linkOpen: false });
  if (was !== "idle") void useExtensions.getState().init();
});
