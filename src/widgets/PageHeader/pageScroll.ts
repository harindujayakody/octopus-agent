import { create } from "zustand";

/// Whether the page body under the header has been scrolled. The header draws
/// its bottom rule only then (LQ-09): at rest the list card's own border
/// starts the content, and a rule on the same canvas above it is a third line.
export const usePageScrolled = create<{ scrolled: boolean; set: (scrolled: boolean) => void }>((set) => ({
  scrolled: false,
  set: (scrolled) => set({ scrolled }),
}));
