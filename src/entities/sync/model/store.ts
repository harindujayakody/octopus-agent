import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { rawError } from "../../../shared/lib/errors";
import { syncCall } from "./api";
import { SYNC_CHANGED, type SyncConnectArgs, type SyncKinds, type SyncState } from "./types";

/** The listener, once set up for the app's life; a failed setup tries again on the next load. */
let listening: Promise<() => void> | null = null;
/** A kinds write is on its way: later changes wait for it. */
let writingKinds = false;

type SyncStore = {
  state: SyncState | null;
  /** This build's backend has no sync commands: the tab and the palette hide sync. */
  missing: boolean;
  /** Kinds being written: the switches show these until the last write answers. */
  kindsDraft: SyncKinds | null;
  load: () => Promise<void>;
  connect: (args: SyncConnectArgs) => Promise<void>;
  disconnect: (removeFromServer: boolean) => Promise<void>;
  setKinds: (kinds: SyncKinds) => Promise<void>;
  setDeviceName: (name: string) => Promise<void>;
  syncNow: () => Promise<void>;
};

/// Personal sync as the backend holds it. Every change, from any window or a
/// sync in the background, comes back as SYNC_CHANGED with the whole state.
export const useSync = create<SyncStore>((set, get) => {
  // Replies and events arrive in any order: the newer state wins.
  const take = (next: SyncState) => {
    const now = get().state;
    if (!now || next.rev >= now.rev) set({ state: next });
  };
  return {
    state: null,
    missing: false,
    kindsDraft: null,
    load: async () => {
      if (!listening) {
        const setup = listen<SyncState>(SYNC_CHANGED, (e) => take(e.payload));
        listening = setup;
        setup.catch(() => { if (listening === setup) listening = null; });
      }
      try {
        take(await syncCall("sync_state", {}));
      } catch (e) {
        if (/\bcommand \S+ not found\b/i.test(rawError(e) ?? "")) set({ missing: true });
        throw e;
      }
    },
    connect: async (args) => take(await syncCall("sync_connect", args)),
    disconnect: async (removeFromServer) => take(await syncCall("sync_disconnect", { removeFromServer })),
    // One write at a time, the latest wanted set each time: two quick switches never undo each other.
    setKinds: async (kinds) => {
      set({ kindsDraft: kinds });
      if (writingKinds) return;
      writingKinds = true;
      try {
        let sent: SyncKinds | null = null;
        for (let want = get().kindsDraft; want && want !== sent; want = get().kindsDraft) {
          sent = want;
          take(await syncCall("sync_set_kinds", { kinds: want }));
        }
      } finally {
        writingKinds = false;
        set({ kindsDraft: null });
      }
    },
    setDeviceName: async (name) => take(await syncCall("sync_set_device_name", { name })),
    syncNow: async () => take(await syncCall("sync_now", {})),
  };
});

/** Whether sync is connected, read now (menus and commands). */
export const syncConnected = (): boolean => useSync.getState().state?.connection != null;
