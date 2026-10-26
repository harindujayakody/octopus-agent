import { create } from "zustand";

const KEY = "shardx.reduceMotion";

function readStored(): boolean {
  try { return localStorage.getItem(KEY) === "true"; } catch { return false; }
}

/** Writes the preference onto <html>, where the reduced-motion CSS rule reads it. */
function apply(reduce: boolean) {
  document.documentElement.dataset.reduceMotion = String(reduce);
}

/** What is stored (or applied since a private window could not store it), whatever is shown. */
let saved = readStored();
export const savedMotion = () => saved;

/// The user's reduced-motion override, applied as html[data-reduce-motion].
/// Kept in this browser's storage: it is a property of the launcher window,
/// not of the backend settings. `previewReduce` shows a choice without
/// storing it (Settings, until Save).
export const useMotion = create<{ reduce: boolean; setReduce: (v: boolean) => void; previewReduce: (v: boolean) => void }>((set) => ({
  reduce: saved,
  setReduce: (reduce) => {
    try { localStorage.setItem(KEY, String(reduce)); } catch { /* private mode: applies until reload */ }
    saved = reduce;
    apply(reduce);
    set({ reduce });
  },
  previewReduce: (reduce) => {
    apply(reduce);
    set({ reduce });
  },
}));

/** Applies the stored preference; run once at startup. */
export function applyStoredMotion() {
  apply(useMotion.getState().reduce);
}
