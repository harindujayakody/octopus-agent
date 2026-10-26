import { create } from "zustand";

/** Whether Join a team is open; the space menu, the Team page, the palette and Settings > Sync open it. */
export const useJoinTeam = create<{
  open: boolean;
  /** Opened from Settings > Sync: joined, the launcher stays in the personal space. */
  forSync: boolean;
  /** The address Join opens with, for a team whose token was replaced: only the new token is missing. */
  server: string;
  /** The team just joined from Settings > Sync, for its server picker to take. */
  joinedForSync: string | null;
  setOpen: (open: boolean, forSync?: boolean) => void;
  /** Opens Join with this server's address filled in. */
  openFor: (server: string) => void;
}>((set) => ({
  open: false,
  forSync: false,
  server: "",
  joinedForSync: null,
  setOpen: (open, forSync = false) => set(open ? { open, forSync, server: "" } : { open }),
  openFor: (server) => set({ open: true, forSync: false, server }),
}));
