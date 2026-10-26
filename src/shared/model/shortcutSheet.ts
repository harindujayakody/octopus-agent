import { create } from "zustand";

/// Whether the keyboard shortcuts sheet is open (`?`, or the palette).
export const useShortcutSheet = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
