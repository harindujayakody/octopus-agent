import { useEffect, useRef } from "react";
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { t } from "../../../shared/i18n";
import { decide, type Target } from "../../team/lib/decide";
import { teamCall } from "../../team/model/api";
import type { Grant, TeamAction } from "../../team/model/types";
import { useSpace } from "./store";
import { activeTeam } from "./types";

/// What this person may do in the team in use beyond one profile, whose rights
/// come on its row: the team's proxies, folders, tags, bookmarks, extensions and
/// projects. Read with `team_my_access`; shown, never trusted, as every write is
/// judged again by the backend and the team server.

type Read = { teamId: string; grants: Grant[] | null; failed: boolean };
export const useAccess = create<{ read: Read | null }>(() => ({ read: null }));

/** Where a team-level right is asked about. */
export type Where = { kind: "team" } | { kind: "folder"; name: string } | { kind: "proxy"; id: string };
export const TEAM: Where = { kind: "team" };
export const inFolder = (name: string): Where => ({ kind: "folder", name });
export const onProxy = (id: string): Where => ({ kind: "proxy", id });

/** A right's name as the rights editor shows it. Each key called literally, for the i18n check. */
export function rightName(a: TeamAction): string {
  switch (a) {
    case "see": return t("team.actSee");
    case "start": return t("team.actStart");
    case "edit": return t("team.actEdit");
    case "create": return t("team.actCreate");
    case "delete": return t("team.actDelete");
    case "cookies": return t("team.actCookies");
    case "take_out": return t("team.actTakeOut");
  }
}

/** The team the launcher works in, or undefined in the personal space. */
const team = () => activeTeam(useSpace.getState().state);

/** Whether the launcher works in a team now. */
export const inTeam = (): boolean => !!team();

/** Why the team does not let this person do `action` at `where`, or null when it does (and always in the personal space). */
export function teamRefusal(action: TeamAction, where: Where = TEAM): string | null {
  const now = team();
  // The admin's token holds every right on the whole team.
  if (!now || now.admin) return null;
  const read = useAccess.getState().read;
  if (!read || read.teamId !== now.id || !read.grants) return read?.teamId === now.id && read.failed ? t("rights.unknown") : t("rights.reading");
  const target: Target = where.kind === "team" ? {} : where.kind === "folder" ? { folder: where.name } : { profileId: where.id };
  if (decide(read.grants, action, target).kind === "allowed") return null;
  const right = rightName(action);
  if (where.kind === "proxy") return t("rights.needsProxy", { right });
  if (where.kind === "folder") return where.name ? t("rights.needsFolder", { right, folder: where.name }) : t("rights.needsNoFolder", { right });
  return t("rights.needsTeam", { right });
}

/** Why this member may not bind the proxy `id` to a profile: the server takes only one they
 *  may use, See and Start, Edit or Take out on it (team-server api.rs `bad_proxy`). */
export function bindRefusal(id: string): string | null {
  const why = (["start", "edit", "take_out"] as const).map((a) => teamRefusal(a, onProxy(id)));
  if (why.some((r) => r === null)) return null;
  const read = useAccess.getState().read;
  return read?.grants ? t("rights.proxyNotUsable") : why[0];
}

/** Why folders cannot be changed here: in a team only its admin makes, renames and deletes them. */
export function adminRefusal(): string | null {
  const now = team();
  return now && !now.admin ? t("rights.adminOnly") : null;
}

/** Why no new profile can be made anywhere in the team, or null when one folder (or the team) allows it. */
export function createAnywhereRefusal(folders: readonly string[]): string | null {
  const whole = teamRefusal("create", TEAM);
  if (whole === null) return null;
  return ["", ...folders].some((f) => teamRefusal("create", inFolder(f)) === null) ? null : whole;
}

let seq = 0;
async function readAccess(): Promise<void> {
  const now = team();
  const mine = ++seq;
  if (!now || now.admin) { useAccess.setState({ read: null }); return; }
  const had = useAccess.getState().read;
  // What was read of this team stays shown while it is read again.
  if (had?.teamId !== now.id) useAccess.setState({ read: { teamId: now.id, grants: null, failed: false } });
  try {
    const grants = await teamCall("team_my_access", { teamId: now.id });
    if (mine !== seq) return;
    // The same rules read again are no news: what was built from them stays.
    const was = useAccess.getState().read;
    if (was?.teamId === now.id && !was.failed && JSON.stringify(was.grants) === JSON.stringify(grants)) return;
    useAccess.setState({ read: { teamId: now.id, grants, failed: false } });
  } catch {
    if (mine === seq) useAccess.setState((s) => ({ read: { teamId: now.id, grants: s.read?.teamId === now.id ? s.read.grants : null, failed: true } }));
  }
}

let wired = false;
/** Reads the access of the team in use, and again whenever it may have moved:
 *  another space, a new permission (its rows change with it), the server back. */
export function wireAccess(): void {
  if (wired) return;
  wired = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => void readAccess(), 300); };
  const key = () => { const now = team(); return now ? `${now.id}|${now.admin}` : ""; };
  let last = key();
  if (last) void readAccess();
  useSpace.subscribe((s, prev) => {
    const k = key();
    if (k !== last) { last = k; void readAccess(); return; }
    // The server answers again after a failed read.
    if (s.state?.team_status?.state === "ready" && prev.state?.team_status?.state !== "ready" && useAccess.getState().read?.failed) soon();
  });
  // A new permission is news for every row: the team's own rights may have moved with it.
  void listen<string>("store-changed", (e) => { if (e.payload === "profiles" && team() && !team()?.admin) soon(); });
}

/** Whether the launcher works in a team now, for a component. */
export const useInTeam = (): boolean => useSpace((s) => !!activeTeam(s.state));

/** Runs `fn` when the rules this person holds change (not on the first render): a menu
 *  built from the old ones closes, so nothing in it says what is no longer so. */
export function useOnRightsMoved(fn: () => void): void {
  const grants = useAccess((s) => s.read?.grants);
  const call = useRef(fn);
  useEffect(() => { call.current = fn; });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    call.current();
  }, [grants]);
}

/** Renders again whenever what `teamRefusal` reads changes: the space, its access. */
export function useRightsChange(): void {
  useSpace((s) => s.state);
  useAccess((s) => s.read);
}
