import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { setSpaceEpoch, setSpaceReader } from "../../../shared/api/invoke";
import { confirmLeave } from "../../../shared/model/unsaved";
import type { Space, SpaceState, TeamStatus } from "./types";

let listening = false;

/// The space in use and the teams joined; every window follows "space-changed".
/// A switch from here asks about unsaved changes first; false: the person stayed.
export const useSpace = create<{
  state: SpaceState | null;
  load: () => Promise<void>;
  choose: (space: Space) => Promise<boolean>;
  join: (server: string, token: string) => Promise<boolean>;
  leave: (teamId: string) => Promise<boolean>;
}>((set, get) => {
  // The state first, then its edition: the stores reset for it read the new space.
  const take = (state: SpaceState) => {
    set({ state });
    setSpaceEpoch(state.epoch);
  };
  return {
    state: null,
    load: async () => {
      if (!listening) {
        listening = true;
        void listen("space-changed", () => void get().load().catch(() => {}));
        // The team server's reach as the backend's reads find it; the team in use only.
        void listen<TeamStatus>("team-status", (e) => {
          const st = get().state;
          if (st?.space.kind === "team") set({ state: { ...st, team_status: e.payload } });
        });
      }
      take(await invoke<SpaceState>("space_state"));
    },
    choose: async (space) => {
      // The space already in use moves nothing, so nothing unsaved is at stake.
      const now = get().state?.space;
      const same = now?.kind === space.kind && (now.kind !== "team" || space.kind !== "team" || now.team_id === space.team_id);
      if (!same && !(await confirmLeave())) return false;
      take(await invoke<SpaceState>("space_set", { space }));
      return true;
    },
    join: async (server, token) => {
      if (!(await confirmLeave())) return false;
      take(await invoke<SpaceState>("team_join", { server, token }));
      return true;
    },
    leave: async (teamId) => {
      // Leaving the team in use moves the launcher to the personal space.
      const st = get().state;
      if (st?.space.kind === "team" && st.space.team_id === teamId && !(await confirmLeave())) return false;
      take(await invoke<SpaceState>("team_leave", { teamId }));
      return true;
    },
  };
});

// A write refused for a switch it had not heard of reads the space again.
setSpaceReader(() => useSpace.getState().load());
