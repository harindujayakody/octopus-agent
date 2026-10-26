import { invoke } from "@tauri-apps/api/core";

/** A team or synced profile open on this device (open.rs `Listed`). `mine`: the person's
 *  own synced profile, whose `team_id` is the sync server's, not a joined team's. */
export type OpenSession = { team_id: string; profile_id: string; name: string; mine: boolean };

/** What became of a team profile's session when it closed (open.rs `Outcome`). */
export type SessionOutcome = "saved" | "stale" | "not_saved" | "discarded" | "kept";

/** The "team-session" event: told for a team's profiles, never for synced ones. */
export type SessionEnded = { team_id: string; profile_id: string; name: string; outcome: SessionOutcome };
export const TEAM_SESSION = "team-session";

/** The team and synced profiles open here, opening ones and closing ones too; none from an older backend. */
export async function teamSessions(): Promise<OpenSession[]> {
  try {
    return (await invoke<OpenSession[]>("team_sessions")) ?? [];
  } catch {
    return [];
  }
}
