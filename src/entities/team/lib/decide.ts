// The rights rule, as team-model's `decide`: among the grants that match, the
// narrowest decides, and a refusal beats an allowance of the same width.
import type { Grant, GrantScope, TeamAction } from "../model/types";

/** What is asked about: a profile in its folder, a folder, or the team. */
export type Target = { profileId?: string; folder?: string };

export type Decision =
  | { kind: "allowed"; by: GrantScope }
  | { kind: "refused"; by: GrantScope }
  | { kind: "none" };

const WIDTH: Record<GrantScope["kind"], number> = { team: 0, folder: 1, profile: 2 };

/** Create is about the team or a folder: a profile rule never carries it. */
export const isTeamLevel = (action: TeamAction): boolean => action === "create";

export function decide(grants: readonly Grant[], action: TeamAction, target: Target): Decision {
  let best: Grant | null = null;
  for (const g of grants) {
    if (g.action !== action) continue;
    const s = g.scope;
    const matches = s.kind === "team"
      || (s.kind === "folder" && target.folder !== undefined && target.folder === s.name)
      || (s.kind === "profile" && target.profileId !== undefined && target.profileId === s.id);
    if (!matches) continue;
    if (isTeamLevel(action) && s.kind === "profile") continue;
    const wider = best === null ? -1 : WIDTH[best.scope.kind];
    if (best === null || WIDTH[s.kind] > wider || (WIDTH[s.kind] === wider && !g.allow && best.allow)) best = g;
  }
  if (!best) return { kind: "none" };
  return best.allow ? { kind: "allowed", by: best.scope } : { kind: "refused", by: best.scope };
}

/** A scope as one string, for keys and comparisons. */
export const scopeKey = (s: GrantScope): string =>
  s.kind === "team" ? "team" : s.kind === "folder" ? `folder:${s.name}` : `profile:${s.id}`;

export const sameScope = (a: GrantScope, b: GrantScope): boolean => scopeKey(a) === scopeKey(b);

/** One cell of the grid: a rule that allows, one that refuses, or none (inherit). */
export type Cell = "allow" | "refuse" | null;

/** The grants as cells by scope and action; two rules on one cell read as the refusal. */
export function toCells(grants: readonly Grant[]): Map<string, Cell> {
  const out = new Map<string, Cell>();
  for (const g of grants) {
    const key = `${scopeKey(g.scope)}|${g.action}`;
    if (out.get(key) === "refuse") continue;
    out.set(key, g.allow ? "allow" : "refuse");
  }
  return out;
}

/** The next state a press gives a cell: not set, allowed, refused, not set. */
export const nextCell = (c: Cell): Cell => (c === null ? "allow" : c === "allow" ? "refuse" : null);

/** The grants a grid holds, in the server's order (team, folders, profiles;
 *  then by name, action and refusal first), as team-server's `sort_rules`. */
export function sortGrants(grants: readonly Grant[], actions: readonly TeamAction[]): Grant[] {
  const name = (s: GrantScope) => (s.kind === "team" ? "" : s.kind === "folder" ? s.name : s.id);
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...grants].sort((a, b) =>
    WIDTH[a.scope.kind] - WIDTH[b.scope.kind]
    || cmp(name(a.scope), name(b.scope))
    || actions.indexOf(a.action) - actions.indexOf(b.action)
    || Number(a.allow) - Number(b.allow));
}

/** One rule per cell, as the server stores them: the same rule twice is one,
 *  and an allowance beside a refusal is the refusal. */
export function mergeGrants(grants: readonly Grant[]): Grant[] {
  const out = new Map<string, Grant>();
  for (const g of grants) {
    const key = `${scopeKey(g.scope)}|${g.action}`;
    const had = out.get(key);
    out.set(key, had && !had.allow ? had : { scope: g.scope, action: g.action, allow: g.allow });
  }
  return [...out.values()];
}

/** Two grant lists say the same thing, whatever their order. */
export function sameGrants(a: readonly Grant[], b: readonly Grant[]): boolean {
  const key = (g: Grant) => `${scopeKey(g.scope)}|${g.action}|${g.allow}`;
  const as = new Set(a.map(key));
  const bs = new Set(b.map(key));
  return as.size === bs.size && [...as].every((k) => bs.has(k));
}

/** A cell set: its rule replaced, or gone when it inherits. */
export function setCell(grants: readonly Grant[], scope: GrantScope, action: TeamAction, cell: Cell): Grant[] {
  const key = scopeKey(scope);
  const rest = grants.filter((g) => !(g.action === action && scopeKey(g.scope) === key));
  return cell === null ? rest : [...rest, { scope, action, allow: cell === "allow" }];
}

/** What the server checks See before (its `see_then`): on a profile the member
 *  cannot See, these are refused whatever their own rule says. Create is not. */
export const NEEDS_SEE: readonly TeamAction[] = ["start", "edit", "delete", "cookies", "take_out"];

/** Allowed here, and still nothing: See is not allowed in the same place. */
export function idle(grants: readonly Grant[], action: TeamAction, target: Target): boolean {
  return NEEDS_SEE.includes(action) && decide(grants, action, target).kind === "allowed" && decide(grants, "see", target).kind !== "allowed";
}

/** A press on a row's cell. Allowing an action that needs See, where See is
 *  not allowed and the row has no See rule of its own, allows See there too. */
export function pressCell(grants: readonly Grant[], scope: GrantScope, target: Target, action: TeamAction, cell: Cell): { grants: Grant[]; addedSee: boolean } {
  let next = setCell(grants, scope, action, cell);
  const own = toCells(next).get(`${scopeKey(scope)}|see`) ?? null;
  const addedSee = cell === "allow" && NEEDS_SEE.includes(action) && own === null && decide(next, "see", target).kind !== "allowed";
  if (addedSee) next = setCell(next, scope, "see", "allow");
  return { grants: next, addedSee };
}

/** The ways to fill a row at once: nothing, or a growing set of allowances. */
export type Preset = "none" | "view" | "run" | "edit" | "full";
export const PRESET_IDS: readonly Preset[] = ["none", "view", "run", "edit", "full"];
export const PRESETS: Record<Preset, readonly TeamAction[]> = {
  none: [],
  view: ["see"],
  run: ["see", "start"],
  edit: ["see", "start", "edit", "create"],
  full: ["see", "start", "edit", "create", "delete", "cookies"],
};

const presetActions = (scope: GrantScope, p: Preset) => PRESETS[p].filter((a) => !(scope.kind === "profile" && isTeamLevel(a)));

/** A row set to a preset: exactly its allowances, its other rules gone. Create
 *  stays off a profile row, which cannot carry it. */
export function applyPreset(grants: readonly Grant[], scope: GrantScope, p: Preset): Grant[] {
  const key = scopeKey(scope);
  return [...grants.filter((g) => scopeKey(g.scope) !== key), ...presetActions(scope, p).map((action) => ({ scope, action, allow: true }))];
}

/** The preset a row's own rules are, if they are one. */
export function presetOf(grants: readonly Grant[], scope: GrantScope): Preset | null {
  const key = scopeKey(scope);
  const own = mergeGrants(grants.filter((g) => scopeKey(g.scope) === key));
  if (own.some((g) => !g.allow)) return null;
  const allowed = new Set(own.map((g) => g.action));
  return PRESET_IDS.find((p) => {
    const want = presetActions(scope, p);
    return want.length === allowed.size && want.every((a) => allowed.has(a));
  }) ?? null;
}

/** One place a member's rules allow something, for a short summary. */
export type AccessPart = { scope: GrantScope; actions: TeamAction[]; preset: Preset | null };

/** What a member's rules allow, place by place in the grid's order; refusals
 *  and places with none are left out. */
export function summarize(grants: readonly Grant[], actions: readonly TeamAction[]): AccessPart[] {
  const merged = sortGrants(mergeGrants(grants), actions);
  const out: AccessPart[] = [];
  for (const g of merged) {
    if (!g.allow) continue;
    const last = out[out.length - 1];
    if (last && sameScope(last.scope, g.scope)) last.actions.push(g.action);
    else out.push({ scope: g.scope, actions: [g.action], preset: null });
  }
  for (const part of out) part.preset = presetOf(merged, part.scope);
  return out;
}
