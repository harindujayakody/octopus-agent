import { create } from "zustand";

/// Whether the command palette is open. Mod+K and the sidebar's Search open
/// it. `session` counts openings: each starts with an empty search. `ran`
/// says it closed because a command ran: then it leaves with no fade (ANIM-02).
export const usePalette = create<{
  open: boolean;
  session: number;
  ran: boolean;
  setOpen: (open: boolean) => void;
  closeAfterRun: () => void;
}>((set, get) => ({
  open: false,
  session: 0,
  ran: false,
  setOpen: (open) => set(open && !get().open ? { open, session: get().session + 1, ran: false } : { open }),
  closeAfterRun: () => set({ open: false, ran: true }),
}));
