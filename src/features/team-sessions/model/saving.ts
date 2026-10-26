import { listen } from "@tauri-apps/api/event";
import { onSpaceMoved } from "../../../shared/api/invoke";
import { TEAM_WARNINGS, warningRe } from "../../../shared/api/backendWarnings";
import { TEAM_REFUSALS } from "../../../shared/api/teamRefusals";
import { TEAM_SESSION, activeTeam, teamSessions, useSpace, type OpenSession, type SessionEnded } from "../../../entities/space";
import { useProfile, useSaving } from "../../../entities/profile";

/** While any is saving, `team_sessions` is read again this often. */
const AGAIN_MS = 3_000;
/** The first read waits for the first process poll: a running profile is listed too. */
const FIRST_MS = 2_500;
const RESENDING = warningRe(TEAM_WARNINGS.resending);

const same = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

let wired = false;
let seq = 0;
let first = true;
/** The space just moved: the running list changes wholesale then, and nothing closed. */
let settling = false;
let settle: ReturnType<typeof setTimeout> | undefined;
/** Seen running here, then closed: listed after that, it is being saved. */
const closed = new Set<string>();
let again: ReturnType<typeof setTimeout> | undefined;

/** A session of the space in use: the team's own in a team, the synced ones in the personal space.
 *  Another space's profiles are not in the running list, so nothing is said of them. */
function ofSpaceInUse(s: OpenSession): boolean {
  const team = activeTeam(useSpace.getState().state);
  return team ? !s.mine && s.team_id === team.id : s.mine;
}

async function look(): Promise<void> {
  if (settling) return;
  const mine = ++seq;
  const open = await teamSessions();
  if (mine !== seq) return;
  const p = useProfile.getState();
  const listed = new Set(open.filter(ofSpaceInUse).map((s) => s.profile_id));
  for (const id of [...closed]) if (!listed.has(id)) closed.delete(id);
  const ids = new Set([...listed].filter((id) =>
    !p.running[id] && !p.startBusy.has(id) && p.pending[id]?.kind !== "start" && (first || closed.has(id))));
  first = false;
  if (!same(ids, useSaving.getState().ids)) useSaving.setState({ ids });
  clearTimeout(again);
  if (ids.size > 0) again = setTimeout(() => void look(), AGAIN_MS);
}

function drop(id: string) {
  closed.delete(id);
  // A start refused only because this send was under way did not fail: it may start now.
  const p = useProfile.getState();
  if (p.startFailed[id] !== undefined && p.failReasons[id]?.includes(TEAM_REFUSALS.busy)) {
    useProfile.setState({ startFailed: Object.fromEntries(Object.entries(p.startFailed).filter(([k]) => k !== id)) });
  }
  const ids = useSaving.getState().ids;
  if (!ids.has(id)) return;
  const next = new Set(ids);
  next.delete(id);
  useSaving.setState({ ids: next });
}

/** Follows closes, resends and their ends; returns the way to stop. */
export function watchSaving(): () => void {
  if (wired) return () => {};
  wired = true;
  const offs: (() => void)[] = [];
  let gone = false;
  const keep = (p: Promise<() => void>) => void p.then((fn) => { if (gone) fn(); else offs.push(fn); }).catch(() => {});
  const timer = setTimeout(() => void look(), FIRST_MS);
  offs.push(useProfile.subscribe((s, was) => {
    if (settling) return;
    const left = Object.keys(was.running).filter((id) => !s.running[id]);
    // A start refused BUSY: open.rs claim may have just begun sending a copy kept here.
    const busy = s.startFailed === was.startFailed ? [] : Object.keys(s.startFailed)
      .filter((id) => s.startFailed[id] !== was.startFailed[id] && s.failReasons[id]?.includes(TEAM_REFUSALS.busy));
    if (left.length === 0 && busy.length === 0) return;
    for (const id of [...left, ...busy]) closed.add(id);
    void look();
  }));
  // Every end of a team profile's session, saved or not, takes it off the list.
  keep(listen<SessionEnded>(TEAM_SESSION, (e) => { if (e.payload?.profile_id) drop(e.payload.profile_id); }));
  keep(listen<string>("launcher-warning", (e) => { if (typeof e.payload === "string" && RESENDING.test(e.payload)) void look(); }));
  // Another space: read afresh once the running list is that space's.
  offs.push(onSpaceMoved(() => {
    settling = true;
    closed.clear();
    first = true;
    seq++;
    clearTimeout(again);
    useSaving.setState({ ids: new Set<string>() });
    clearTimeout(settle);
    settle = setTimeout(() => { settling = false; void look(); }, FIRST_MS);
  }));
  return () => {
    gone = true;
    wired = false;
    clearTimeout(timer);
    clearTimeout(again);
    clearTimeout(settle);
    for (const fn of offs) fn();
  };
}
