// Web Store updates of extensions (updates.rs), as the window sees them. Every
// state can be reached with a knob on `window`, set before load or between steps:
//   __shardxMockExtUpdates   { [entryId]: Partial<ExtensionUpdate> } records as a check left them (read once a load)
//   __shardxMockExtStore     { [storeId]: Offer } what the Web Store offers now (else MetaMask 13.53.0, the rest as installed)
//   __shardxMockExtCheck     "offline": a check reaches nobody
//   __shardxMockExtStepMs    each progress step (120 ms)
//   __shardxMockExtFail      { [entryId]: "text" } the next Update fails with it
//   __shardxMockExtNotServed [entryId] the Web Store no longer serves the version it named
//   __shardxMockExtLink      { [storeId]: LinkKnob } how linking by hand goes (files alike, "same", by default)
//   __shardxMockExtSeparate  false: a copy beside one already there would get no id of its own
//   __shardxMockExtImportSame an entry id: the next file import is that extension again
import type { Ctx, Handler } from "./handlers";
import type { MockState } from "./fixtures";
import { sleep } from "./store";
import { teamInUse } from "./spaces";
import type {
  ExtensionEntry, ExtensionFlag, ExtensionHolder, ExtensionUpdate, Grant, LinkResult, UpdatePhase, UpdateResult,
} from "../../entities/extension/model/types";

type Offer = {
  version: string;
  size?: number;
  name?: string;
  flags?: ExtensionFlag[];
  allowlisted?: boolean | null;
  /** The new version asks for more: Update asks first. */
  grown?: Grant[];
  /** A weak link: the files barely match. */
  identity?: { overlap: number; names: { old: string; new: string } };
  /** `minimum_chrome_version` newer than the engine. */
  minEngine?: string;
};
type LinkKnob = { kin?: "same" | "unsure" | "other" | "missing" | "key"; overlap?: number; name?: string; allowlisted?: boolean | null; flags?: ExtensionFlag[] };
type Knobs = {
  __shardxMockExtUpdates?: Record<string, Partial<ExtensionUpdate>>;
  __shardxMockExtStore?: Record<string, Offer>;
  __shardxMockExtCheck?: "offline";
  __shardxMockExtStepMs?: number;
  __shardxMockExtFail?: Record<string, string>;
  __shardxMockExtNotServed?: string[];
  __shardxMockExtLink?: Record<string, LinkKnob>;
  __shardxMockExtSeparate?: boolean;
  __shardxMockExtImportSame?: string;
};
const knobs = () => window as Knobs;

/** The words updates.rs uses. */
const FLAGGED = "the Web Store marks this extension as harmful, so it is not updated";
const UNLINKED = "the extension is not linked to the Web Store yet: link it first";
const CANCELLED = "the update was cancelled";
const BUSY = "this extension is being updated already";

const BUILT_IN: Record<string, Offer> = {
  nkbihfbeogaeaoehlefnkodbefgpgknn: { version: "13.53.0", size: 29_515_399, name: "MetaMask" },
};
const offerOf = (storeId: string): Offer | undefined => knobs().__shardxMockExtStore?.[storeId] ?? BUILT_IN[storeId];

const now = () => Math.floor(Date.now() / 1000);
const storeId = (e: ExtensionEntry) => (e.source?.kind === "webstore" ? e.source.id : null);

/** Chrome's version order: numbers part by part, missing parts are zero. */
function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

function base(e: ExtensionEntry): ExtensionUpdate {
  const linked = !!storeId(e);
  return {
    id: e.id, state: linked ? "current" : "unlinked", installed: e.version, latest: null, size: null, first_seen: null,
    ready_since: null, waiting_on: [], progress: null, error: null, checked_at: linked ? now() - 3600 : null,
    flags: [], allowlisted: linked ? true : null, skipped: null, needs_engine: null,
  };
}

let seeded = false;
/** The record of each library extension, made on first sight (and from the knob once a load). */
function records(state: MockState): Record<string, ExtensionUpdate> {
  const all = (state.extUpdates ??= {});
  if (!seeded) {
    seeded = true;
    for (const [id, over] of Object.entries(knobs().__shardxMockExtUpdates ?? {})) {
      const e = state.extensions.find((x) => x.id === id);
      if (e) all[id] = { ...base(e), ...over, id };
    }
  }
  for (const e of state.extensions) {
    all[e.id] ??= base(e);
    all[e.id].installed = e.version;
  }
  for (const id of Object.keys(all)) if (!state.extensions.some((e) => e.id === id)) delete all[id];
  return all;
}

const entryOf = (state: MockState, id: string) => {
  const e = state.extensions.find((x) => x.id === id);
  if (!e) throw "the extension is not in the library";
  return e;
};

/** The running profiles that load this extension. */
const holders = (state: MockState, id: string): ExtensionHolder[] =>
  Object.keys(state.running)
    .map((pid) => state.profiles[pid])
    .filter((p) => p && p._meta.extensions.includes(id))
    .map((p) => ({ id: p._meta.id, name: p.name }));

const told = (ctx: Ctx, ...topics: string[]) => { ctx.save(); for (const t of topics) ctx.emit("store-changed", t); };

/** The new version goes in: the entry's version moves, the record is current. */
function apply(e: ExtensionEntry, r: ExtensionUpdate): { from: string; to: string } {
  const from = e.version;
  const to = r.latest ?? e.version;
  e.version = to;
  Object.assign(r, { state: "current", installed: to, latest: null, size: null, first_seen: null, ready_since: null, waiting_on: [], progress: null, error: null, confirm: undefined, needs_engine: null });
  return { from, to };
}

const cancelled = new Set<string>();
const working = new Set<string>();

async function steps(ctx: Ctx, id: string, r: ExtensionUpdate, phases: UpdatePhase[], total: number) {
  const ms = Number(knobs().__shardxMockExtStepMs ?? 120);
  for (const phase of phases) {
    const parts = phase === "download" ? 4 : 1;
    for (let i = 1; i <= parts; i++) {
      if (cancelled.has(id)) { cancelled.delete(id); throw CANCELLED; }
      const received = phase === "download" ? Math.round((total * i) / parts) : total;
      r.state = phase === "apply" ? "applying" : "downloading";
      r.progress = { phase, received, total };
      ctx.emit("extension-update:progress", { id, phase, received, total });
      await sleep(ms);
    }
  }
}

/** Where a record with nothing under way stands: a skipped latest is no offer (updates.rs view). */
const offered = (r: ExtensionUpdate) => (r.latest && r.latest !== r.skipped ? "available" : "current");

/** A check's answer for one record (updates.rs check). */
function checked(r: ExtensionUpdate, e: ExtensionEntry) {
  const sid = storeId(e);
  if (!sid) return;
  const o = offerOf(sid);
  r.checked_at = now();
  r.flags = o?.flags ?? [];
  r.allowlisted = o?.allowlisted ?? true;
  if (["waiting", "ready", "confirm", "downloading", "applying", "needs_engine"].includes(r.state)) return;
  if (o && newer(o.version, e.version)) {
    if (r.latest !== o.version) r.first_seen = now();
    // A skipped version stays named, the extension current (updates.rs view).
    Object.assign(r, { state: o.version === r.skipped ? "current" : "available", latest: o.version, size: o.size ?? 12_400_000, error: null });
  } else Object.assign(r, { state: "current", latest: null, size: null, error: null });
}

/** A profile's browser closed: what waited on it alone goes in (updates.rs profile_closed). */
export function extProfileClosed(ctx: Ctx, profileId: string) {
  const all = ctx.state.extUpdates;
  if (!all) return;
  let moved = false;
  for (const r of Object.values(all)) {
    if (r.state !== "waiting" || !r.waiting_on.some((h) => h.id === profileId)) continue;
    r.waiting_on = r.waiting_on.filter((h) => h.id !== profileId);
    if (r.waiting_on.length > 0) continue;
    const e = ctx.state.extensions.find((x) => x.id === r.id);
    if (e) { apply(e, r); moved = true; }
  }
  if (moved) told(ctx, "extensions", "extension-updates");
}

/** extensions.rs already_in_library, as the window reads it. */
export function alreadyInLibrary(state: MockState, e: ExtensionEntry): string {
  const separate = !teamInUse(state) && (knobs().__shardxMockExtSeparate ?? true);
  return `already_in_library ${JSON.stringify({ entry_id: e.id, installed: e.version, separate })}`;
}

/** The library entry a file import repeats (`__shardxMockExtImportSame`), once. */
export function importSame(state: MockState): ExtensionEntry | undefined {
  const id = knobs().__shardxMockExtImportSame;
  if (!id) return undefined;
  delete knobs().__shardxMockExtImportSame;
  return state.extensions.find((e) => e.id === id);
}

export const extUpdateHandlers: Record<string, Handler> = {
  // A team's: none in v1 (space/mod.rs extensions::updates).
  extension_updates: (_a, { state }) => (teamInUse(state) ? [] : Object.values(records(state))),
  extension_updates_check: async (_a, ctx) => {
    if (teamInUse(ctx.state)) return [];
    await sleep(Number(knobs().__shardxMockExtStepMs ?? 120) * 3);
    if (knobs().__shardxMockExtCheck === "offline") {
      throw "could not reach the Web Store: error sending request for url (https://update.googleapis.com/service/update2/crx)";
    }
    const all = records(ctx.state);
    for (const e of ctx.state.extensions) checked(all[e.id], e);
    told(ctx, "extension-updates");
    return Object.values(all);
  },
  extension_update: async ({ id, confirmed }, ctx): Promise<UpdateResult> => {
    // updates.rs update: busy, not in the library, unlinked, then the store asked anew.
    if (working.has(String(id))) throw BUSY;
    const e = entryOf(ctx.state, String(id));
    const r = records(ctx.state)[e.id];
    if (r.state === "unlinked") throw UNLINKED;
    const asked = offerOf(storeId(e) ?? "");
    if (asked?.flags?.length) { r.flags = asked.flags; told(ctx, "extension-updates"); }
    if (r.flags.length) throw FLAGGED;
    const fail = knobs().__shardxMockExtFail?.[e.id];
    if (fail) {
      delete knobs().__shardxMockExtFail![e.id];
      Object.assign(r, { state: "failed", error: fail, progress: null });
      told(ctx, "extension-updates");
      throw fail;
    }
    if (knobs().__shardxMockExtNotServed?.includes(e.id)) return { result: "not_served" };
    const o = offerOf(storeId(e) ?? "");
    r.latest ??= o && newer(o.version, e.version) ? o.version : null;
    if (!r.latest || !newer(r.latest, e.version)) { Object.assign(r, { state: "current", latest: null }); told(ctx, "extension-updates"); return { result: "current" }; }
    // `confirmed` lets in what a stage here asked about, never a fresh download.
    if (r.state === "confirm" && !confirmed) return { result: "confirm", update: r };
    working.add(e.id);
    try {
      if (!["ready", "confirm", "waiting"].includes(r.state)) {
        await steps(ctx, e.id, r, ["download", "verify", "unpack"], r.size ?? o?.size ?? 12_400_000);
        r.progress = null;
        if (o?.minEngine) {
          Object.assign(r, { state: "needs_engine", needs_engine: o.minEngine });
          told(ctx, "extension-updates");
          return { result: "needs_engine", version: o.minEngine };
        }
        if (o?.grown?.length || o?.identity) {
          Object.assign(r, {
            state: "confirm",
            confirm: o.identity
              ? { reason: "identity", grown: o.grown ?? [], names: o.identity.names, overlap: o.identity.overlap }
              : { reason: "permissions", grown: o.grown ?? [] },
          });
          told(ctx, "extension-updates");
          return { result: "confirm", update: r };
        }
      }
      // Waiting with no profile named: the launcher itself is busy.
      const launcherBusy = r.state === "waiting" && r.waiting_on.length === 0;
      const held = launcherBusy ? [] : holders(ctx.state, e.id);
      if (launcherBusy || held.length > 0) {
        Object.assign(r, { state: "waiting", waiting_on: held, ready_since: r.ready_since ?? now(), confirm: undefined, progress: null });
        told(ctx, "extension-updates");
        return { result: "waiting", waiting_on: held };
      }
      await steps(ctx, e.id, r, ["apply"], 0);
      const done = apply(e, r);
      told(ctx, "extensions", "extension-updates");
      return { result: "applied", ...done };
    } catch (err) {
      // Cancelled on its way: the version offered stays offered.
      Object.assign(r, { state: offered(r), progress: null });
      told(ctx, "extension-updates");
      throw err;
    } finally {
      working.delete(e.id);
    }
  },
  extension_update_cancel: ({ id }, ctx) => {
    const r = records(ctx.state)[String(id)];
    if (!r) return null;
    if (working.has(r.id) && r.state === "downloading") { cancelled.add(r.id); return null; }
    Object.assign(r, { state: offered(r), waiting_on: [], ready_since: null, confirm: undefined, needs_engine: null, progress: null });
    told(ctx, "extension-updates");
    return null;
  },
  extension_update_skip: ({ id, version }, ctx) => {
    const r = records(ctx.state)[String(id)];
    if (!r) return null;
    // As updates.rs skip: a failed try of another version stays failed; of this one it goes with it.
    if (r.state === "failed" && r.latest !== String(version)) r.skipped = String(version);
    // The view keeps the skipped version as `latest`, its state current (updates.rs view).
    else Object.assign(r, { state: "current", skipped: String(version), confirm: undefined, waiting_on: [], ready_since: null, needs_engine: null, ...(r.state === "failed" ? { error: null } : {}) });
    told(ctx, "extension-updates");
    return null;
  },
  extension_link_source: async ({ id, link, confirmed }, ctx): Promise<LinkResult> => {
    const e = entryOf(ctx.state, String(id));
    const sid = /[a-p]{32}/.exec(String(link))?.[0];
    if (!sid) throw "that is not a Web Store link or extension id";
    // The same item again is linked already: said so, as linked.
    if (storeId(e) === sid) return { result: "linked", source: e.source!, allowlisted: records(ctx.state)[e.id].allowlisted, update: records(ctx.state)[e.id] };
    if (storeId(e)) throw `it is linked to the Web Store item ${storeId(e)} already`;
    const k = knobs().__shardxMockExtLink?.[sid] ?? {};
    const kin = k.kin ?? "same";
    // The store's current package is fetched and its files weighed (updates.rs
    // link), told as an update's download and verify are, under the entry's id.
    const ms = Number(knobs().__shardxMockExtStepMs ?? 120);
    const size = offerOf(sid)?.size ?? 12_400_000;
    const rec = records(ctx.state)[e.id];
    const was = rec.state;
    // A read meanwhile sees it downloading, as view() does while the registry holds it.
    for (const [phase, received] of [["download", size / 2], ["download", size], ["verify", 0]] as const) {
      Object.assign(rec, { state: "downloading", progress: { phase, received, total: phase === "verify" ? 0 : size } });
      ctx.emit("extension-update:progress", { id: e.id, phase, received, total: phase === "verify" ? 0 : size });
      await sleep(ms);
    }
    Object.assign(rec, { state: was, progress: null });
    if (kin === "missing") throw "the Web Store has no extension with that id";
    const overlap = k.overlap ?? (kin === "same" ? 0.96 : kin === "unsure" ? 0.12 : 0);
    if (kin === "other") throw `by its files, that is a different extension (${Math.round(overlap * 100)}% of its files match)`;
    const o = offerOf(sid);
    if (kin !== "key" && !confirmed) {
      return {
        result: "confirm", names: { old: e.name, new: k.name ?? o?.name ?? e.name }, installed: e.version, store: o?.version ?? e.version,
        overlap, kin, allowlisted: k.allowlisted ?? true, flags: k.flags ?? o?.flags ?? [],
      };
    }
    e.source = { kind: "webstore", id: sid };
    const r = records(ctx.state)[e.id];
    Object.assign(r, { state: "unchecked" });
    checked(r, e);
    told(ctx, "extensions", "extension-updates");
    return { result: "linked", source: e.source, allowlisted: r.allowlisted, update: r };
  },
};
