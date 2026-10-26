/** Where the launcher works: the person's own space, or a team's. */
export type Space = { kind: "personal" } | { kind: "team"; team_id: string };

/** A team this launcher has joined. Its access token never reaches the page.
 *  `revoked`: the team withdrew this member; it can only be forgotten.
 *  `needs_invite`: the admin replaced its token; the new invite brings it back. */
export type TeamLink = {
  id: string; name: string; server: string; admin: boolean;
  /** Who this launcher is in the team. */
  member_id: string;
  /** The key the team's permissions are checked with. */
  perm_key: string;
  revoked?: boolean; needs_invite?: boolean;
};

/** How the team's lists stand (cache.rs `TeamStatus`); `synced_at`: the last good read, unix seconds. */
export type TeamStatus = { state: "loading" | "ready" | "offline" | "refused"; error?: string; synced_at?: number };

/** `epoch`: the space's edition, which every space write carries. `team_status`: in a team only. */
export type SpaceState = { space: Space; teams: TeamLink[]; device_name: string; epoch: number; team_status?: TeamStatus };

export const PERSONAL: Space = { kind: "personal" };

/** The team the launcher works in, or undefined in the personal space. */
export function activeTeam(st: SpaceState | null): TeamLink | undefined {
  const sp = st?.space;
  return sp?.kind === "team" ? st?.teams.find((t) => t.id === sp.team_id) : undefined;
}
