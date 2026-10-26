import type { ProxyEntry } from "../../proxy";
import { tagsOf, type TagStore } from "../../tag";
import type { ProfileMeta } from "../model/types";
import { makeProfileFilter, searchTextOf, sortProfiles, type ProfileFilters, type ProfileSort } from "./listing";

/** Everything the Profiles list's rows depend on. */
export type VisibleInputs = {
  profiles: ProfileMeta[];
  proxies: ProxyEntry[];
  search: string;
  folder: string;
  filters: ProfileFilters;
  /** `NO_RUNNING` unless `needsRunning` says the query reads the running state. */
  running: Record<string, number>;
  sort: ProfileSort;
  tags: TagStore["tags"];
  byProfile: TagStore["byProfile"];
  /** Proxy id to its last seen IP, while the Proxies store has its tests. */
  proxyIps: Readonly<Record<string, string>>;
  /** ms: the Last run filter and the Run time order's live session. Only
   *  its minute counts, and only for a query that `readsClock`; any other
   *  gets the same answer for any value (0 included). */
  now: number;
  /** Only these profiles (a problem card's click: `ProfileUiStore.only`). */
  only?: ReadonlySet<string> | null;
};

/** The rows the list paints, in order, with each row's index by id. */
export type Visible = {
  list: ProfileMeta[];
  ids: string[];
  /** Keys, ranges and the selection look a row up instead of searching (PERF-04). */
  indexById: Map<string, number>;
};

/** Stands in for `running` when the query does not read it, so the 2 s poll
 *  changes nothing here (PERF-01). */
export const NO_RUNNING: Record<string, number> = {};

/** Whether the query reads the running state: a status filter, and the two
 *  orders that sort by it (Status, and Most run time's live session on top
 *  of the stored total). */
export const needsRunning = (filters: ProfileFilters, sort: ProfileSort) =>
  filters.status !== "all" || sort === "status" || sort === "runtime-desc";

/** Whether the query reads the clock: Most run time adds the live session,
 *  the Last run filter compares with now. */
export const readsClock = (filters: ProfileFilters, sort: ProfileSort) =>
  sort === "runtime-desc" || filters.lastRun !== "any";

/** The minute a query reads the clock at, or 0 when it does not. */
const clockOf = (i: Pick<VisibleInputs, "sort" | "filters" | "now">) =>
  readsClock(i.filters, i.sort) ? Math.floor(i.now / 60_000) : 0;

const KEYS = ["profiles", "proxies", "search", "folder", "filters", "running", "sort", "tags", "byProfile", "proxyIps", "only"] as const;
const sameInputs = (a: VisibleInputs, b: VisibleInputs) => KEYS.every((k) => a[k] === b[k]) && clockOf(a) === clockOf(b);

// The order depends on the list and the sort, and for the Status and Run time
// orders on the running state (and the minute): a keystroke never sorts.
let sorted: { profiles: ProfileMeta[]; sort: ProfileSort; running: Record<string, number> | null; clock: number; out: ProfileMeta[] } | null = null;
// Each profile's search text, per list and tags.
let texts: { profiles: ProfileMeta[]; tags: VisibleInputs["tags"]; byProfile: VisibleInputs["byProfile"]; proxies: ProxyEntry[]; proxyIps: VisibleInputs["proxyIps"]; out: Map<string, string> } | null = null;
// The last two answers used, newest first: the table renders from the
// deferred search while the keys and the selection read the current one, and
// both stay cached. A third answer pushes out the one used longest ago.
const answers: { inputs: VisibleInputs; out: Visible }[] = [];

/// The Profiles list for these inputs, computed once: every caller with the
/// same inputs gets the same object (PERF-04).
export function computeVisible(inputs: VisibleInputs): Visible {
  const at = answers.findIndex((a) => sameInputs(a.inputs, inputs));
  if (at >= 0) {
    if (at > 0) answers.unshift(...answers.splice(at, 1));
    return answers[0].out;
  }
  const { profiles, sort, tags, byProfile, now } = inputs;
  const running = sort === "status" || sort === "runtime-desc" ? inputs.running : null;
  const clock = sort === "runtime-desc" ? Math.floor(now / 60_000) : 0;
  if (!sorted || sorted.profiles !== profiles || sorted.sort !== sort || sorted.running !== running || sorted.clock !== clock) {
    sorted = { profiles, sort, running, clock, out: sortProfiles(profiles, sort, running ?? NO_RUNNING, now) };
  }
  const tagsOfId = (id: string) => tagsOf(id, { tags, byProfile });
  let text: Map<string, string> | undefined;
  if (inputs.search.trim()) {
    if (!texts || texts.profiles !== profiles || texts.tags !== tags || texts.byProfile !== byProfile || texts.proxies !== inputs.proxies || texts.proxyIps !== inputs.proxyIps) {
      const byId = new Map(inputs.proxies.map((x) => [x.id, x]));
      texts = {
        profiles, tags, byProfile, proxies: inputs.proxies, proxyIps: inputs.proxyIps,
        out: new Map(profiles.map((p) => [p.id, searchTextOf(p, tagsOfId(p.id).map((t) => t.name), p.proxy_id ? byId.get(p.proxy_id) : null, p.proxy_id ? inputs.proxyIps[p.proxy_id] : undefined)])),
      };
    }
    text = texts.out;
  }
  const keep = makeProfileFilter(inputs.proxies, inputs.search, inputs.folder, inputs.filters, inputs.running, tagsOfId, now, text, profiles);
  // Filtering keeps the sorted order, so this equals sorting the kept rows.
  const only = inputs.only;
  const list = sorted.out.filter(only ? (p) => only.has(p.id) && keep(p) : keep);
  const ids = list.map((p) => p.id);
  const out: Visible = { list, ids, indexById: new Map(ids.map((id, i) => [id, i])) };
  answers.unshift({ inputs, out });
  answers.length = Math.min(answers.length, 2);
  return out;
}
