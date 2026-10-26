import { create } from "zustand";

/** "sync": the same guide, read as setting up a server for one's own sync. */
export type GuideMode = "team" | "sync";

/** Whether the Create a team guide is open; the space menu, the Team page and Settings > Sync open it. */
export const useCreateTeam = create<{ open: boolean; mode: GuideMode; setOpen: (open: boolean, mode?: GuideMode) => void }>((set) => ({
  open: false,
  mode: "team",
  // Closing keeps the mode, so the guide leaves as it was.
  setOpen: (open, mode) => set(open ? { open, mode: mode ?? "team" } : { open }),
}));
