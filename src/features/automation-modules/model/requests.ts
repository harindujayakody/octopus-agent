import type { ModulePermissions } from "../../../entities/automation";

/// A module's request to call other modules and projects, and the operator's
/// answer. A module may call nothing until this says otherwise, including one
/// that asks for nothing, which is every module written before calling
/// existed. "*" among the projects it asks for means any project.
export const ANY_PROJECT = "*";

type Flow = { id: string; name: string };

/** The id a request for a project is granted under: "*" for any, the project's
 *  id for a named one, null for a name no project on this computer has. */
export const flowGrantId = (name: string, flows: readonly Flow[]): string | null =>
  name === ANY_PROJECT ? ANY_PROJECT : flows.find((f) => f.name === name)?.id ?? null;

/** What is still to answer: asked, grantable and not granted yet. A project
 *  no project on this computer has can never be granted, so it is not
 *  pending: it is `missing` (said in words on the row), and never keeps a
 *  request open after the rest was allowed. */
export function unanswered(perm: ModulePermissions, flows: readonly Flow[]): { modules: string[]; flows: string[]; missing: string[] } {
  const grantedM = new Set(perm.granted.call_modules);
  const grantedF = new Set(perm.granted.call_flows);
  const missing: string[] = [];
  const open: string[] = [];
  for (const name of perm.asks.flows) {
    const id = flowGrantId(name, flows);
    if (id === null) missing.push(name);
    else if (!grantedF.has(id)) open.push(name);
  }
  return { modules: perm.asks.modules.filter((id) => !grantedM.has(id)), flows: open, missing };
}

/** Whether a module waits for an answer: it asks for something still
 *  ungranted, and a Deny does not already hold for exactly this request. */
export function needsApproval(moduleId: string, perm: ModulePermissions, flows: readonly Flow[]): boolean {
  const open = unanswered(perm, flows);
  return open.modules.length + open.flows.length > 0 && !isDenied(moduleId, perm);
}

/** The grant after Allow: what was granted, plus every request that can be. */
export function allowed(perm: ModulePermissions, flows: readonly Flow[]): { modules: string[]; flows: string[] } {
  const ids = perm.asks.flows.map((name) => flowGrantId(name, flows)).filter((id): id is string => id !== null);
  return {
    modules: [...new Set([...perm.granted.call_modules, ...perm.asks.modules])],
    flows: [...new Set([...perm.granted.call_flows, ...ids])],
  };
}

/** What a request asks, as a stable text: a Deny holds only for this one, so a
 *  module that asks for something new asks again. */
export const requestKey = (perm: ModulePermissions): string =>
  JSON.stringify([[...perm.asks.modules].sort(), [...perm.asks.flows].sort()]);

// Deny grants nothing, and the backend has no record of it (backend B44), so
// the answer is kept on this computer, per module.
const DENIED = "shardx.automation.denied";

function readDenied(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(DENIED) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch { return {}; }
}

export const isDenied = (moduleId: string, perm: ModulePermissions): boolean => readDenied()[moduleId] === requestKey(perm);

export function deny(moduleId: string, perm: ModulePermissions): void {
  try { localStorage.setItem(DENIED, JSON.stringify({ ...readDenied(), [moduleId]: requestKey(perm) })); } catch { /* private mode */ }
}
