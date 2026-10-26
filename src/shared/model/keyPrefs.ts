import { create } from "zustand";

const KEY = "shardx.singleKeys";

function readStored(): boolean {
  try { return localStorage.getItem(KEY) !== "false"; } catch { return true; }
}

/// The Single-key shortcuts switch (O14, WCAG 2.1.4): off turns the page-wide
/// single keys (C, /, ?, the G sequences) off. On by default. A property of
/// this launcher window, kept in its storage like the reduced-motion switch.
export const useKeyPrefs = create<{ singleKeys: boolean; setSingleKeys: (on: boolean) => void }>((set) => ({
  singleKeys: readStored(),
  setSingleKeys: (singleKeys) => {
    try { localStorage.setItem(KEY, String(singleKeys)); } catch { /* private mode: applies until reload */ }
    set({ singleKeys });
  },
}));
