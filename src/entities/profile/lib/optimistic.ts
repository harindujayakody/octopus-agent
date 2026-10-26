import type { ProfileMeta } from "../model/types";

/// Changes the Profiles list shows before the backend has answered (PERF-13,
/// LQ-03): edits laid over rows, and rows that exist only here for now (a
/// profile being created, cloned or brought back from the Trash). The store
/// lays them over every list the backend returns until their calls settle,
/// so a reload that lands meanwhile (the poll, a store-changed event) never
/// brings an old value back for a moment.

const PLACEHOLDER = "pending:";
let placeholderSeq = 0;

/** A row the backend has not given an id yet (a profile being created or cloned). */
export const isPlaceholder = (id: string) => id.startsWith(PLACEHOLDER);
export const newPlaceholderId = () => `${PLACEHOLDER}${++placeholderSeq}`;

/** One local edit. `id` follows a placeholder to its real id. `before`: what
 *  the row showed for each field it sets when it began (a failure goes back
 *  to it). `seq`: the order edits began in. */
export type Edit = { id: string; patch: Partial<ProfileMeta>; before: Partial<ProfileMeta>; seq: number };
const edits = new Set<Edit>();
let editSeq = 0;
/** Each pending edit's end, for `editsSettled`. */
const endOf = new WeakMap<Edit, { done: Promise<void>; resolve: () => void }>();

/** Starts an edit of row `id`; `shown` is the row as the list shows it now. */
export function beginEdit(id: string, patch: Partial<ProfileMeta>, shown?: ProfileMeta): Edit {
  const before: Partial<ProfileMeta> = {};
  if (shown) for (const key of Object.keys(patch) as (keyof ProfileMeta)[]) Object.assign(before, { [key]: shown[key] });
  const edit: Edit = { id, patch, before, seq: ++editSeq };
  edits.add(edit);
  let resolve = () => {};
  const done = new Promise<void>((r) => { resolve = r; });
  endOf.set(edit, { done, resolve });
  return edit;
}

export function endEdit(edit: Edit) {
  edits.delete(edit);
  endOf.get(edit)?.resolve();
}

/** Resolves once no edit of row `id` is pending: the backend then has every
 *  change the list shows for it (Peek reads the profile only after that). */
export async function editsSettled(id: string): Promise<void> {
  for (;;) {
    const open = [...edits].filter((e) => e.id === id);
    if (open.length === 0) return;
    await Promise.all(open.map((e) => endOf.get(e)!.done));
  }
}

/// What a failed edit puts back on its row (`row`: as the list shows it now).
/// Per field it set: a newer edit of that field still on its way keeps the
/// row as it is and takes over this edit's before-value, so its own failure
/// goes back past both; otherwise the row goes back to what it showed when
/// this edit began (an older edit's value, or the backend's), if it still
/// shows this edit's value. An older edit never blocks the revert.
export function revertOf(edit: Edit, row: ProfileMeta | undefined): Partial<ProfileMeta> {
  const revert: Partial<ProfileMeta> = {};
  for (const key of Object.keys(edit.before) as (keyof ProfileMeta)[]) {
    let next: Edit | undefined;
    for (const e of edits) {
      if (e !== edit && e.id === edit.id && e.seq > edit.seq && key in e.patch && (!next || e.seq < next.seq)) next = e;
    }
    if (next) Object.assign(next.before, { [key]: edit.before[key] });
    else if (row && row[key] === edit.patch[key]) Object.assign(revert, { [key]: edit.before[key] });
  }
  return revert;
}

/** Every pending edit on the rows it touches; a later edit wins. */
export function applyEdits(list: ProfileMeta[]): ProfileMeta[] {
  if (edits.size === 0) return list;
  const byId = new Map<string, Partial<ProfileMeta>>();
  for (const e of edits) byId.set(e.id, { ...byId.get(e.id), ...e.patch });
  return list.map((p) => {
    const patch = byId.get(p.id);
    return patch ? { ...p, ...patch } : p;
  });
}

/** Rows shown before the backend lists them, with the index they go in at. */
const placeholders = new Map<string, { meta: ProfileMeta; at: number }>();

export function addPlaceholder(meta: ProfileMeta, at: number) {
  placeholders.set(meta.id, { meta, at });
}

export function dropPlaceholder(id: string) {
  placeholders.delete(id);
}

/** The list to show: the backend's rows without `hidden` (on their way to the
 *  Trash), the placeholders it does not list yet, and every pending edit. */
export function localView(fresh: ProfileMeta[], hidden: ReadonlySet<string>): ProfileMeta[] {
  let out = hidden.size > 0 ? fresh.filter((p) => !hidden.has(p.id)) : fresh;
  if (placeholders.size > 0) {
    const listed = new Set(out.map((p) => p.id));
    // A row being created that is already on its way to the Trash stays hidden too.
    const missing = [...placeholders.values()].filter((x) => !listed.has(x.meta.id) && !hidden.has(x.meta.id)).sort((a, b) => a.at - b.at);
    if (missing.length > 0) {
      out = [...out];
      for (const x of missing) out.splice(Math.min(x.at, out.length), 0, x.meta);
    }
  }
  return applyEdits(out);
}

/** Rows the backend does not have yet, and their real id once it does (null
 *  when it failed): a placeholder until its create or clone answers, a row
 *  Undo put back until its restore answers. */
const arrivals = new Map<string, Promise<string | null>>();

export function trackCreation(id: string, real: Promise<string | null>) {
  arrivals.set(id, real);
  // A restored row is itself again once its restore answered; a placeholder
  // keeps its answer for whoever still holds the placeholder id.
  if (!isPlaceholder(id)) void real.then(() => { if (arrivals.get(id) === real) arrivals.delete(id); });
}

/** Whether the backend does not have `id`'s row yet (a create, an Undo's restore). */
export const isArriving = (id: string) => isPlaceholder(id) || arrivals.has(id);

/** The backend id for `id`, once the backend has the row: itself, or a
 *  placeholder's real id. Null when its create or restore failed. */
export async function resolveId(id: string): Promise<string | null> {
  const arriving = arrivals.get(id);
  if (arriving) return (await arriving) ?? null;
  return isPlaceholder(id) ? null : id;
}

/** Each settled placeholder's id, by the real id it became. */
const firstIds = new Map<string, string>();

/** A placeholder became `to`: its row keeps the key it had. */
export function keepRowKey(from: string, to: string) {
  firstIds.set(to, rowKey(from));
}

/** The key the list gives a row: the id it first had, so a row that took its
 *  real id stays mounted (an open field keeps its text and the keyboard). */
export const rowKey = (id: string) => firstIds.get(id) ?? id;

/** Edits made to a placeholder carry over to its real row. */
export function moveEdits(from: string, to: string) {
  for (const e of edits) if (e.id === from) e.id = to;
}

/** Field by field; arrays (`extensions`) by value. */
export function sameMeta(a: ProfileMeta, b: ProfileMeta): boolean {
  const keys = Object.keys(a) as (keyof ProfileMeta)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => {
    const x = a[k];
    const y = b[k];
    if (x === y) return true;
    // A fresh read brings new objects every time.
    if (k === "sync" || k === "rights" || k === "open_on") return sameJson(x, y);
    return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => v === y[i]);
  });
}

/** For small records the backend sends (a proxy): equal when their JSON is. */
export const sameJson = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

/// `next`, keeping the previous object for every row whose fields did not
/// change, and `prev` itself when no row changed: memoized rows skip and
/// selectors see no change (PERF-13c).
export function shareRows<T extends { id: string }>(prev: T[], next: T[], same: (a: T, b: T) => boolean): T[] {
  const old = new Map(prev.map((p) => [p.id, p]));
  let unchanged = prev.length === next.length;
  const out = next.map((p, i) => {
    const o = old.get(p.id);
    const kept = o && (o === p || same(o, p)) ? o : p;
    if (kept !== prev[i]) unchanged = false;
    return kept;
  });
  return unchanged ? prev : out;
}
