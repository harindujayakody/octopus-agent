import { create } from "zustand";

const KEY = "shardx.confirmDirectStart";

function readStored(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}

/// Whether starting a profile without a proxy asks first while proxies
/// exist (owner decision O9a). On by default. Kept in this window's storage,
/// like the motion switch: frontend only for now (backend list, Task 38).
export const useDirectStart = create<{ ask: boolean; setAsk: (ask: boolean) => void }>((set) => ({
  ask: readStored(),
  setAsk: (ask) => {
    try {
      if (ask) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, "off");
    } catch { /* private mode: until reload */ }
    set({ ask });
  },
}));
