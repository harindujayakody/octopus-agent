import { create } from "zustand";
import { teamCall } from "./api";
import type { CreatedMember, Grant, TeamFolder, TeamMember, TeamOverview } from "./types";

type Status = "idle" | "loading" | "ready" | "error";

/// The Team page's data: the admin's overview, or a member's own rules.
/// Each change answers with what the server now holds, which replaces the row.
export const useTeamAdmin = create<{
  teamId: string | null;
  status: Status;
  error: string | null;
  overview: TeamOverview | null;
  /** A member's own rules (`team_my_access`). */
  access: Grant[] | null;
  load: (teamId: string, admin: boolean) => Promise<void>;
  createMember: (name: string) => Promise<CreatedMember>;
  setActive: (memberId: string, active: boolean) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  reissue: (memberId: string) => Promise<string>;
  /** Writes a member's whole rule list; answers what the server now holds. */
  saveGrants: (memberId: string, grants: Grant[]) => Promise<Grant[]>;
  rename: (name: string) => Promise<void>;
  createFolder: (name: string, color: string) => Promise<void>;
  /** Rename first, then the color if one is given; `renamed` hears the new
   *  name at once, so a retry after a refused color starts from it. */
  editFolder: (name: string, next: string, color: string | null, renamed?: (now: string) => void) => Promise<void>;
  deleteFolder: (name: string) => Promise<void>;
}>((set, get) => {
  /** The team the page shows; a call made for another one is never applied. */
  const id = () => {
    const teamId = get().teamId;
    if (!teamId) throw new Error("no team");
    return teamId;
  };
  // Only the last read lands, and a change made meanwhile outdates it: an
  // overview read before an add must not put the list back without it.
  let seq = 0;
  const patch = (teamId: string, fn: (o: TeamOverview) => TeamOverview) => {
    seq++;
    const { overview } = get();
    if (overview && get().teamId === teamId) set({ overview: fn(overview) });
  };
  const putMember = (m: TeamMember) => (o: TeamOverview) => ({ ...o, members: o.members.map((x) => (x.id === m.id ? m : x)) });
  // The rules that name a folder follow its new name, and go with it.
  const mapRules = (o: TeamOverview, fn: (g: Grant) => Grant | null) => o.grants && Object.fromEntries(
    Object.entries(o.grants).map(([m, gs]) => [m, gs.flatMap((g) => fn(g) ?? [])]),
  );
  const putFolder = (old: string, f: TeamFolder) => (o: TeamOverview) => ({
    ...o,
    folders: o.folders.map((x) => (x.name === old ? f : x)),
    profiles: o.profiles.map((p) => (p.folder === old ? { ...p, folder: f.name } : p)),
    grants: old === f.name ? o.grants : mapRules(o, (g) => (g.scope.kind === "folder" && g.scope.name === old ? { ...g, scope: { kind: "folder", name: f.name } } : g)),
  });

  return {
    teamId: null,
    status: "idle",
    error: null,
    overview: null,
    access: null,
    load: async (teamId, admin) => {
      const mine = ++seq;
      const fresh = get().teamId !== teamId;
      set({ teamId, status: fresh || get().status === "error" ? "loading" : get().status, error: null, ...(fresh ? { overview: null, access: null } : {}) });
      try {
        if (admin) {
          const overview = await teamCall("team_admin_overview", { teamId });
          if (mine === seq) set({ overview, access: null, status: "ready" });
        } else {
          const access = await teamCall("team_my_access", { teamId });
          if (mine === seq) set({ access, overview: null, status: "ready" });
        }
      } catch (e) {
        if (mine === seq) set({ status: "error", error: String(e) });
      }
    },
    createMember: async (name) => {
      const teamId = id();
      const r = await teamCall("team_admin_member_create", { teamId, name });
      patch(teamId, (o) => ({ ...o, members: [...o.members, r.member], grants: o.grants ? { ...o.grants, [r.member.id]: [] } : o.grants }));
      return r;
    },
    setActive: async (memberId, active) => {
      const teamId = id();
      const m = await teamCall("team_admin_member_set_active", { teamId, memberId, active });
      patch(teamId, putMember(m));
    },
    removeMember: async (memberId) => {
      const teamId = id();
      await teamCall("team_admin_member_delete", { teamId, memberId });
      patch(teamId, (o) => ({ ...o, members: o.members.filter((m) => m.id !== memberId) }));
    },
    reissue: async (memberId) => {
      const teamId = id();
      const r = await teamCall("team_admin_member_reissue", { teamId, memberId });
      // Their row as the server now has it: invited again, until the new invite is used.
      patch(teamId, putMember(r.member));
      return r.invite;
    },
    saveGrants: async (memberId, grants) => {
      const teamId = id();
      const saved = await teamCall("team_admin_set_grants", { teamId, memberId, grants });
      patch(teamId, (o) => ({ ...o, grants: { ...o.grants, [memberId]: saved } }));
      return saved;
    },
    rename: async (name) => {
      const teamId = id();
      const team = await teamCall("team_admin_rename", { teamId, name });
      patch(teamId, (o) => ({ ...o, team }));
    },
    createFolder: async (name, color) => {
      const teamId = id();
      const f = await teamCall("team_admin_folder_create", { teamId, name, color });
      patch(teamId, (o) => ({ ...o, folders: [...o.folders, f] }));
    },
    editFolder: async (name, next, color, renamed) => {
      const teamId = id();
      let now = name;
      // The rename first: a taken name is the likely refusal, and leaves nothing half-done.
      if (next !== name) {
        const f = await teamCall("team_admin_folder_rename", { teamId, name, next });
        patch(teamId, putFolder(name, f));
        now = f.name;
        renamed?.(now);
      }
      if (color !== null) {
        const f = await teamCall("team_admin_folder_color", { teamId, name: now, color });
        patch(teamId, putFolder(now, f));
      }
    },
    deleteFolder: async (name) => {
      const teamId = id();
      await teamCall("team_admin_folder_delete", { teamId, name });
      patch(teamId, (o) => ({
        ...o,
        folders: o.folders.filter((f) => f.name !== name),
        grants: mapRules(o, (g) => (g.scope.kind === "folder" && g.scope.name === name ? null : g)),
      }));
    },
  };
});
