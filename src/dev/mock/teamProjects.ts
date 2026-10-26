// A team's automation projects as space/items.rs keeps them: each one has the server's revision,
// a save names the revision it was read at, and one from an older read is refused as stale.
import type { MockState } from "./fixtures";
import type { Project } from "../../entities/automation/model/types";
import { teamInUse } from "./spaces";
import { TEAM_REFUSALS } from "../../shared/api/teamRefusals";

/** A project new to the team (create, duplicate, import): the server's first revision. */
export function teamNew(state: MockState, p: Project): Project {
  if (!teamInUse(state)) return p;
  p.revision = 1;
  p.run = { ...p.run, profiles: [] };
  return p;
}

/** A team's save (put_project): null outside a team; else the stored project, or its refusal thrown. */
export function teamSave(state: MockState, sent: Project): Project | null {
  if (!teamInUse(state)) return null;
  const i = state.automation.findIndex((x) => x.id === sent.id);
  if (i < 0) throw `no project ${sent.id} in this team`;
  const now = state.automation[i].revision ?? 1;
  // No revision named: the save is not checked against one, as the backend's base None.
  if (sent.revision !== undefined && sent.revision !== now) throw TEAM_REFUSALS.stale("project", now, sent.revision);
  const stored: Project = { ...sent, updated_at: Math.floor(Date.now() / 1000), revision: now + 1, run: { ...sent.run, profiles: [] } };
  state.automation[i] = stored;
  return stored;
}

/** Test knob: another member saves project `id`. Unannounced: a test that wants the live refresh emits it. */
export function savedElsewhere(state: MockState, id: string): void {
  const p = state.automation.find((x) => x.id === id);
  if (p) p.revision = (p.revision ?? 1) + 1;
}
