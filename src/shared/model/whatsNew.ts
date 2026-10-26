import { create } from "zustand";

/** What this start is to the What's new gate: the first run on this
 *  computer, the first run after an update, or neither (the same version as
 *  last time; or unknown: plain-browser dev, or a storage it cannot read). */
export type InstallKind = "first" | "update" | null;

/// Whether the What's new dialog is open. Opened by WhatsNewGate after an
/// update, by the sidebar's version item and by Settings > About. The gate
/// also records `installKind`, read before it stores the new version.
export const useWhatsNew = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
  installKind: InstallKind;
  setInstallKind: (kind: InstallKind) => void;
  /** The gate has decided whether this start opens What's new. */
  decided: boolean;
  setDecided: () => void;
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  installKind: null,
  setInstallKind: (installKind) => set({ installKind }),
  decided: false,
  setDecided: () => set({ decided: true }),
}));
