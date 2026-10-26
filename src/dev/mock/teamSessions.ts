// The team and synced profiles open on this device, as space/open.rs keeps them: team_sessions
// lists them, and a team profile's close is told with "team-session" (open.rs `tell`).
import type { MockState, StoredProfile } from "./fixtures";
import type { Ctx } from "./handlers";
import { personal } from "./spaces";
import type { OpenSession, SessionOutcome } from "../../entities/space/model/sessions";
import { TEAM_WARNINGS } from "../../shared/api/backendWarnings";

/** The team whose lists hold profile `id`, in use or waiting, and the profile; null for a personal one. */
function teamOf(state: MockState, id: string): { team: string; p: StoredProfile } | null {
  const have = state.dataOf ?? "personal";
  if (have !== "personal" && state.profiles[id]) return { team: have, p: state.profiles[id] };
  for (const [team, lists] of Object.entries(state.spaceData ?? {})) {
    if (team !== "personal" && lists.profiles?.[id]) return { team, p: lists.profiles[id] };
  }
  return null;
}

/** As open.rs `listed()`: the team profiles running here, then the person's synced ones. */
export function openSessions(state: MockState): OpenSession[] {
  const out: OpenSession[] = [];
  const m = state.sync;
  const own = personal(state).profiles;
  // Closing ones too: their browser is gone, their session still on its way.
  for (const id of [...Object.keys(state.running), ...Object.keys(state.saving ?? {})]) {
    const t = teamOf(state, id);
    if (t) out.push({ team_id: t.team, profile_id: id, name: t.p.name, mine: false });
    else if (m?.connection && own[id] && (m.kinds.profiles === "all" || m.picked.includes(id))) {
      out.push({ team_id: m.connection.teamId, profile_id: id, name: own[id].name, mine: true });
    }
  }
  return out;
}

/** As open.rs send_back when the server does not take a closed profile's session: it stays
 *  listed and is sent again, said once; `sessionEnded` ends it. */
export function sessionResent(state: MockState, id: string, emit: Ctx["emit"], why = "the team server did not answer: timed out"): void {
  const t = teamOf(state, id);
  if (!t) return;
  delete state.running[id];
  (state.saving ??= {})[id] = true;
  emit("launcher-warning", TEAM_WARNINGS.resending(t.p.name, why));
}

/** As open.rs claim: a start finds a copy kept unsent, sends it first (listed meanwhile) and is refused BUSY. */
export function resendUnsent(state: MockState, id: string, emit: Ctx["emit"], save: () => void, ms: number): boolean {
  if (!state.unsent?.[id]) return false;
  delete state.unsent[id];
  (state.saving ??= {})[id] = true;
  setTimeout(() => { sessionEnded(state, id, "saved", emit); save(); }, ms);
  return true;
}

/** As open.rs `tell`: a team profile's close says what became of its session; a synced one says nothing. */
export function sessionEnded(state: MockState, id: string, outcome: SessionOutcome, emit: Ctx["emit"], why = "the team server did not answer: timed out", unsent = false): void {
  // A synced one's send ends too, untold.
  delete state.saving?.[id];
  const t = teamOf(state, id);
  if (!t) return;
  const name = t.p.name;
  if (outcome === "stale") emit("launcher-warning", TEAM_WARNINGS.stale(name));
  // Unsent: kept on this computer for the next start (Outcome::Unsent).
  if (outcome === "not_saved") emit("launcher-warning", unsent ? TEAM_WARNINGS.unsent(name, why) : TEAM_WARNINGS.notSaved(name, why));
  if (outcome === "not_saved" && unsent) (state.unsent ??= {})[id] = true;
  emit("team-session", { team_id: t.team, profile_id: id, name, outcome });
  emit("store-changed", "profiles");
}
