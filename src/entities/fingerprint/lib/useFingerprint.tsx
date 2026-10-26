import { create } from "zustand";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "../../../shared/model/toast";
import { reportLoadError } from "../../../shared/model/loadError";
import { deferDelete, isPendingDelete } from "../../../shared/lib/deferDelete";
import { FileTooBig, MB, pickTextFile } from "../../../shared/lib/pickFile";
import { FingerprintEntry } from "../model/types";
import { deviceTypeOf, gpuVendorOf, noFingerprintFilters, type FingerprintFilters } from "./facets";
import { fingerprintList, fingerprintDelete, fingerprintImport, fingerprintDir } from "../model/api";
import { storeBus } from "../../../shared/lib/storeBus";
import { t } from "../../../shared/i18n";

export type FingerprintStore = {
    status: "idle" | "loading" | "ready" | "error";
    error: string | null;

    items: FingerprintEntry[];
    importerOpen: boolean;
    /** The header filter: label, GPU, platform, Chrome version. */
    search: string;
    filters: FingerprintFilters;

    init: () => Promise<void>;
    reload: () => Promise<void>;
    setImporterOpen: (open: boolean) => void;
    setSearch: (q: string) => void;
    setFilters: (f: Partial<FingerprintFilters>) => void;
    /** Clears the filters and the search. */
    clearFilters: () => void;

    /** The fingerprint Peek shows, or null when Peek is closed. */
    peekId: string | null;
    openPeek: (id: string) => void;
    closePeek: () => void;
    /** Hides it behind an Undo toast (ruling 18); true once it is hidden. */
    remove: (id: string) => Promise<boolean>;
    importJsonFile: () => Promise<void>;
    openLibraryFolder: () => Promise<void>;
};

// A fingerprint removed behind its Undo toast stays out of every read until the toast goes.
const living = (items: FingerprintEntry[]) => items.filter((x) => !isPendingDelete(`fingerprint:${x.id}`));

/// The filters, less a GPU vendor or device no fingerprint has any more: it
/// would hide every card with no visible reason (PC-083). The same object
/// when nothing drops. An empty library keeps them: a list read while the
/// library is being rewritten can be empty for a moment, and the empty
/// state hides nothing (Pair 28 review M3).
function keptFilters(filters: FingerprintFilters, items: FingerprintEntry[]): FingerprintFilters {
    if (items.length === 0) return filters;
    const vendorGone = filters.vendor !== "all" && !items.some((e) => gpuVendorOf(e) === filters.vendor);
    const deviceGone = filters.device !== "all" && !items.some((e) => deviceTypeOf(e) === filters.device);
    if (!vendorGone && !deviceGone) return filters;
    return { ...filters, ...(vendorGone ? { vendor: "all" } : {}), ...(deviceGone ? { device: "all" } : {}) };
}

export const useFingerprint = create<FingerprintStore>((set, get) => ({
    status: "idle",
    error: null,
    items: new Array<FingerprintEntry>(),
    importerOpen: false,
    search: "",
    filters: noFingerprintFilters(),
    setSearch: (search) => set({ search }),
    setFilters: (f) => set({ filters: { ...get().filters, ...f } }),
    clearFilters: () => set({ filters: noFingerprintFilters(), search: "" }),

    init: async () => {
        if (get().status === "loading" || get().status === "ready") return;
        set({ status: "loading" });
        try {
            const items = living(await fingerprintList());
            set({ items, filters: keptFilters(get().filters, items), status: "ready" });
        } catch (e) {
            set({ status: "error", error: String(e) });
            reportLoadError("fingerprints", t("useFingerprint.loadFailed"), e);
        }
    },
    reload: async () => {
        try {
            const items = living(await fingerprintList());
            set({ items, filters: keptFilters(get().filters, items) });
            storeBus.emit("fingerprints");
        } catch (e) { toast.fail({ title: t("useFingerprint.refreshFailed"), detail: e }); }
    },
    setImporterOpen: (importerOpen) => set({ importerOpen }),

    peekId: null,
    openPeek: (peekId) => set({ peekId }),
    closePeek: () => set({ peekId: null }),
    remove: async (id) => {
        const entry = get().items.find((e) => e.id === id);
        if (!entry || entry.builtin) return false;
        // Its label, as its card shows it.
        const name = entry.label;
        deferDelete({
            key: `fingerprint:${id}`,
            title: t("useFingerprint.removed", { name }),
            failTitle: t("useFingerprint.removeFailed", { name }),
            // Its Peek closes with it.
            hide: () => set({ items: get().items.filter((e) => e.id !== id), ...(get().peekId === id ? { peekId: null } : {}) }),
            restore: () => void get().reload(),
            commit: async () => { await fingerprintDelete(id); await get().reload(); },
        });
        return true;
    },
    importJsonFile: async () => {
        try {
            const picked = await pickTextFile({ accept: ".json,application/json", maxBytes: 5 * MB });
            if (!picked) return;
            const e = await fingerprintImport(picked.text, null);
            toast.ok(t("useFingerprint.imported", { label: e.label }));
            get().reload();
        } catch (e) {
            if (e instanceof FileTooBig) toast.fail({ title: e.message });
            else toast.fail({ title: t("useFingerprint.importFailed"), detail: e });
        }
    },
    openLibraryFolder: async () => {
        try {
            // Shown in its folder; reveal never runs anything (SEC-04).
            await revealItemInDir(await fingerprintDir());
        } catch (e) { toast.fail({ title: t("useFingerprint.openFolderFailed"), detail: e }); }
    },
}));
