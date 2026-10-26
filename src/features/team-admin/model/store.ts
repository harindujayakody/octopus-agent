import { create } from "zustand";

/** Add member asked for from elsewhere (the palette): the Team page opens it once it has the team. */
export const useTeamAsk = create<{ addMember: boolean; askAddMember: (on: boolean) => void }>((set) => ({
  addMember: false,
  askAddMember: (on) => set({ addMember: on }),
}));
