import { create } from "zustand";
import { FOLDER_ICON_GLYPHS } from "../../../shared/icons";
import { LABEL_COLORS, type LabelColorId } from "../../../shared/constants";
import { hasOwn } from "../../../shared/lib/utils";
import { handOver, windowStorage } from "../../../shared/lib/handOver";
import { writeQueue } from "../../../shared/lib/writeQueue";
import { onSpaceMoved } from "../../../shared/api/invoke";
import { toast } from "../../../shared/model/toast";
import { t } from "../../../shared/i18n";
import { folderImport, folderList, folderMetaSet } from "../model/api";
import { fromLegacy, LEGACY_META, LEGACY_REGISTRY, looks, names } from "./folderStored";

export type FolderIcon = keyof typeof FOLDER_ICON_GLYPHS;
/** A Folder's look: a palette color id (or none) and an icon id. */
export type FolderMeta = { color: LabelColorId | null; icon: FolderIcon };

export const DEFAULT_FOLDER_META: FolderMeta = { color: null, icon: "folder" };

// The backend keeps the looks and the folders kept while empty (folders.rs).
// Builds before it kept them in this window's storage, handed over once.
const KNOWN = {
  colors: LABEL_COLORS.map((c) => c.id),
  icons: Object.keys(FOLDER_ICON_GLYPHS) as FolderIcon[],
};

// The profile store keeps the folders kept while empty; it imports this
// module, so it says here where a read puts them.
let applyRegistry: (registry: string[]) => void = () => {};
export function onRegistry(fn: (registry: string[]) => void) { applyRegistry = fn; }

let queue: ReturnType<typeof writeQueue> | null = null;

async function read() {
  const s = await folderList();
  useFolderMeta.setState({ byName: looks(s.meta, KNOWN) });
  applyRegistry(names(s.registry));
  // A change made while this read was out shows again after it is sent.
  queue?.shown();
}

let loading: Promise<void> | null = null;
/** Reads the folders from the backend once, after handing it the copy a
 *  build before it kept here. Never rejects: a failure is shown. */
export function loadFolders(): Promise<void> {
  return loading ??= (async () => {
    try {
      await handOver(windowStorage(), [LEGACY_REGISTRY, LEGACY_META], (raw) => folderImport(fromLegacy(raw, KNOWN)));
      await read();
    } catch (e) {
      toast.fail({ title: t("folderMeta.loadFailed"), detail: e });
    }
  })();
}

/** Reads them again (a change made elsewhere, another space). Never rejects. */
export async function reloadFolders(): Promise<void> {
  await loadFolders();
  try { await read(); } catch (e) { toast.fail({ title: t("folderMeta.loadFailed"), detail: e }); }
}

// Another space: none of the old folders' looks or kept folders show while its own are read.
onSpaceMoved(() => {
  if (!loading) return;
  useFolderMeta.setState({ byName: {} });
  applyRegistry([]);
  void reloadFolders();
});

/** Sends a folder change after the first read, in the order made. */
export function sendFolders(call: () => Promise<unknown>) {
  queue ??= writeQueue(loadFolders(), (e) => toast.fail({ title: t("folderMeta.saveFailed"), detail: e }), read);
  void queue(call);
}

type FolderMetaState = {
  byName: Record<string, FolderMeta>;
  setMeta: (name: string, meta: FolderMeta) => void;
  /** Moves a Folder's look to its new name here: `folder_rename` moved it in the backend. */
  renameMeta: (from: string, to: string) => void;
  /** Drops a Folder's look here: `folder_delete` dropped it in the backend. */
  dropMeta: (name: string) => void;
};

export const useFolderMeta = create<FolderMetaState>((set, get) => ({
  byName: {},
  setMeta: (name, meta) => {
    set({ byName: { ...get().byName, [name]: meta } });
    sendFolders(() => folderMetaSet(name, meta));
  },
  renameMeta: (from, to) => {
    const byName = { ...get().byName };
    if (hasOwn(byName, from)) { byName[to] = byName[from]; delete byName[from]; }
    set({ byName });
  },
  dropMeta: (name) => {
    const byName = { ...get().byName };
    delete byName[name];
    set({ byName });
  },
}));

/** A Folder's look, or the default one. */
export function useFolderLook(name: string): FolderMeta {
  return useFolderMeta((s) => (hasOwn(s.byName, name) ? s.byName[name] : undefined)) ?? DEFAULT_FOLDER_META;
}

/** A Folder's stored look, or null when it has none (read before a delete, for its Undo). */
export function lookOf(name: string): FolderMeta | null {
  const byName = useFolderMeta.getState().byName;
  return hasOwn(byName, name) ? byName[name] : null;
}
