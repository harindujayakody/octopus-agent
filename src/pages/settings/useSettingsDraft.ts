import { useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { useTheme } from "@proxyshard/shardx-ui-kit";
import { settingsGet, settingsSave, type Settings } from "../../entities/settings";
import { clean as cleanTagName, tagNameTaken, useTags, type Tag } from "../../entities/tag";
import { builtinNames, useViews, viewNameTaken, type ProfileView } from "../../entities/profile";
import type { LabelColorId } from "../../shared/constants";
import { riskyLaunchArgs } from "../../shared/lib/launchArgs";
import { confirmModal } from "../../shared/lib/confirm";
import { toast } from "../../shared/model/toast";
import { t, useLang } from "../../shared/i18n";
import { useDirectStart } from "../../shared/model/directStart";
import { useInterfaceSize } from "../../shared/model/interfaceSize";
import { useKeyPrefs } from "../../shared/model/keyPrefs";
import { useMotion } from "../../shared/model/motion";
import { PREF_KEYS, prefOf, type LocalPrefs, type PrefKey } from "./localPrefs";

export type { LocalPrefs } from "./localPrefs";

export type SaveState = "idle" | "saving" | "error";

/** A change to a tag or a view that waits for Save (tags and views live on
 *  this computer, not in the settings file; they join the page's draft). */
export type TagOp = { kind: "rename"; id: string; name: string } | { kind: "recolor"; id: string; color: LabelColorId };
export type ViewOp = { kind: "rename"; id: string; name: string } | { kind: "pin"; id: string; pinned: boolean };

type Patch = Partial<Settings>;
type Field = keyof Settings;

type Draft = {
  /** What is on disk, as this window last read or saved it. */
  confirmed: Settings | null;
  /** The fields that differ from `confirmed`: the draft. */
  edits: Patch;
  /** Renames and recolors of tags, and renames and pins of views, oldest first. */
  tagOps: TagOp[];
  viewOps: ViewOp[];
  /** The window's own preferences (language, theme, size, motion, keys, usage statistics, the direct-start question) that differ from the stored ones. */
  prefs: Partial<LocalPrefs>;
  /** False from a (re)open until its read is done: nothing shows before (LAYOUT-21). */
  ready: boolean;
  state: SaveState;
  /** Why the last save failed, in words, for the bar. */
  error: string | null;
  getError: string | null;
  /** A name the last save found taken, by `tag:<id>` or `view:<id>`, for its field. */
  opErrors: Record<string, string>;
  /** Fields showing text that is not a value yet (a port that is not a number): why Save waits. */
  holds: Record<string, string>;
  /** Counts settings written since the page opened (the API details read again). */
  saves: number;
  /** Counts discards: fields that keep text of their own start over. */
  epoch: number;
};

// One draft for the window. The page reads on every open; nothing here is
// written to disk until Save.
const useDraft = create<Draft>(() => ({
  confirmed: null, edits: {}, tagOps: [], viewOps: [], prefs: {}, ready: false, state: "idle", error: null,
  getError: null, opErrors: {}, holds: {}, saves: 0, epoch: 0,
}));
/** The save on its way, so a second press (a key, the guard) waits for it. */
let running: Promise<boolean> | null = null;
/** A save with no answer by then is a failed one (Pair 34 ruling, M2). */
const SAVE_TIMEOUT_MS = 10_000;

function saveWithin(body: Settings): Promise<unknown> {
  let late: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    late = setTimeout(() => reject(new Error(t("settings.saveTimedOut"))), SAVE_TIMEOUT_MS);
  });
  return Promise.race([settingsSave(body), timeout]).finally(() => clearTimeout(late));
}

const apply = (base: Settings, patch: Patch): Settings => ({ ...base, ...patch });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keysOf = (p: object) => Object.keys(p);
/** The fields of `next` that differ from `base`. */
const diff = (base: Settings, next: Settings): Patch => {
  const keys = [...new Set([...keysOf(base), ...keysOf(next)])] as Field[];
  return Object.fromEntries(keys.filter((k) => !same(base[k], next[k])).map((k) => [k, next[k]])) as Patch;
};
const without = <T extends object>(o: T, key: string): T =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key)) as T;

/// The ops that still change something: a tag or view that is gone (deleted
/// since) has nothing to rename, a blank name keeps the one it had, and a
/// value equal to the stored one is no change.
function liveOps(d: Pick<Draft, "tagOps" | "viewOps">, tags: readonly Tag[], views: readonly ProfileView[]) {
  return {
    tagOps: d.tagOps.filter((o) => {
      const tag = tags.find((x) => x.id === o.id);
      if (!tag) return false;
      return o.kind === "rename" ? o.name.trim() !== "" && o.name !== tag.name : o.color !== tag.color;
    }),
    viewOps: d.viewOps.filter((o) => {
      const view = views.find((x) => x.id === o.id);
      if (!view) return false;
      return o.kind === "rename" ? o.name.trim() !== "" && o.name !== view.name : o.pinned !== view.pinned;
    }),
  };
}

type TagRename = Extract<TagOp, { kind: "rename" }>;
type ViewRename = Extract<ViewOp, { kind: "rename" }>;

/// What Save will apply, in the order it will apply it: the recolors and
/// pins, then the renames, a rename waiting for the name it wants to be freed
/// by another rename (two tags may swap, and a name taken only until the other
/// tag is renamed away is free). The renames that stay stuck meet a taken name:
/// `tag:<id>` or `view:<id>` to the words for its field. Checked before
/// anything is written.
function planOps(live: ReturnType<typeof liveOps>): { tagOps: TagOp[]; viewOps: ViewOp[]; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  let tags = useTags.getState().tags;
  const tagOps: TagOp[] = live.tagOps.filter((o) => o.kind !== "rename");
  let tagWaiting = live.tagOps.filter((o): o is TagRename => o.kind === "rename");
  for (let moved = true; moved && tagWaiting.length > 0;) {
    moved = false;
    for (const op of tagWaiting) {
      if (tagNameTaken(tags, op.name, op.id)) continue;
      tags = tags.map((x) => (x.id === op.id ? { ...x, name: cleanTagName(op.name) } : x));
      tagOps.push(op);
      tagWaiting = tagWaiting.filter((o) => o !== op);
      moved = true;
    }
  }
  for (const op of tagWaiting) errors[`tag:${op.id}`] = t("settings.tagsNameTaken", { name: op.name.trim() });

  let views = useViews.getState().views;
  const builtins = builtinNames();
  const viewOps: ViewOp[] = live.viewOps.filter((o) => o.kind !== "rename");
  let viewWaiting = live.viewOps.filter((o): o is ViewRename => o.kind === "rename");
  for (let moved = true; moved && viewWaiting.length > 0;) {
    moved = false;
    for (const op of viewWaiting) {
      if (viewNameTaken(op.name, views, builtins, op.id)) continue;
      views = views.map((x) => (x.id === op.id ? { ...x, name: op.name.trim().replace(/\s+/g, " ") } : x));
      viewOps.push(op);
      viewWaiting = viewWaiting.filter((o) => o !== op);
      moved = true;
    }
  }
  for (const op of viewWaiting) errors[`view:${op.id}`] = t("views.nameTaken", { name: op.name.trim() });
  return { tagOps, viewOps, errors };
}

/// The preferences that still differ from the stored ones (one the stored
/// value caught up with, by a command, is no change).
function livePrefs(prefs: Partial<LocalPrefs>): [PrefKey, LocalPrefs[PrefKey]][] {
  return PREF_KEYS.filter((k) => k in prefs && !same(prefs[k], prefOf(k).stored()))
    .map((k): [PrefKey, LocalPrefs[PrefKey]] => [k, prefs[k] as LocalPrefs[PrefKey]]);
}

function isDirty(d: Pick<Draft, "edits" | "tagOps" | "viewOps" | "prefs">, tags: readonly Tag[], views: readonly ProfileView[]): boolean {
  const live = liveOps(d, tags, views);
  return keysOf(d.edits).length > 0 || live.tagOps.length > 0 || live.viewOps.length > 0 || livePrefs(d.prefs).length > 0;
}

/// An op replaces the earlier one of its kind for the same tag or view (the
/// last word counts), keeping its place in the queue; one that puts the
/// stored value back takes the earlier one away.
function queued<T extends { kind: string; id: string }>(ops: readonly T[], op: T, undoes: boolean): T[] {
  const at = ops.findIndex((o) => o.kind === op.kind && o.id === op.id);
  if (undoes) return at < 0 ? [...ops] : ops.filter((_, i) => i !== at);
  return at < 0 ? [...ops, op] : ops.map((o, i) => (i === at ? op : o));
}

/** The edit changes the draft: a failed save's words go. */
const fresh = (d: Draft): Pick<Draft, "error" | "state"> => ({ error: null, state: d.state === "error" ? "idle" : d.state });

export function queueTagOp(op: TagOp): void {
  const tag = useTags.getState().tags.find((x) => x.id === op.id);
  if (!tag) return;
  const undoes = op.kind === "rename" ? op.name === tag.name : op.color === tag.color;
  useDraft.setState((cur) => ({
    tagOps: queued(cur.tagOps, op, undoes),
    opErrors: without(cur.opErrors, `tag:${op.id}`),
    ...fresh(cur),
  }));
}

export function queueViewOp(op: ViewOp): void {
  const view = useViews.getState().views.find((x) => x.id === op.id);
  if (!view) return;
  const undoes = op.kind === "rename" ? op.name === view.name : op.pinned === view.pinned;
  useDraft.setState((cur) => ({
    viewOps: queued(cur.viewOps, op, undoes),
    opErrors: without(cur.opErrors, `view:${op.id}`),
    ...fresh(cur),
  }));
}

/// Only the fields `next` changes become the change, so a change never
/// carries another field's older value.
function setSettings(next: Settings) {
  const cur = useDraft.getState();
  if (!cur.confirmed) return;
  const changed = diff(apply(cur.confirmed, cur.edits), next);
  if (keysOf(changed).length === 0) return;
  const edits = diff(cur.confirmed, apply(cur.confirmed, { ...cur.edits, ...changed }));
  useDraft.setState({ edits, ...fresh(cur) });
}

/// A preference of this window changes in the draft. The language, theme,
/// interface size and reduced motion are shown at once, as a preview; none is
/// stored until Save. One put back to the stored value is no change.
export function setPref<K extends PrefKey>(key: K, value: LocalPrefs[K]) {
  const cur = useDraft.getState();
  if (!cur.ready) return;
  const pref = prefOf(key);
  const back = same(value, pref.stored());
  if (back) pref.restore?.();
  else pref.show?.(value);
  useDraft.setState({ prefs: back ? without(cur.prefs, key) : { ...cur.prefs, [key]: value }, ...fresh(cur) });
}

/// A preference was set from elsewhere (a palette theme command): the choice
/// waiting in the draft gives way, so Save does not store it over the command.
export function dropPref(key: PrefKey) {
  useDraft.setState((cur) => (key in cur.prefs ? { prefs: without(cur.prefs, key), ...fresh(cur) } : cur));
}

/** Holds Save while a field shows text that is not a value yet, and says why;
 *  `null` lets go. The field that holds it lets go when it goes. */
export function holdSave(key: string, message: string | null) {
  useDraft.setState((cur) => {
    if ((cur.holds[key] ?? null) === message) return cur;
    return { holds: message === null ? without(cur.holds, key) : { ...cur.holds, [key]: message } };
  });
}

/// A changed risky launch switch applies to every profile: it asks before it
/// is saved (SEC-10). True when the user chose to save it.
async function confirmRiskyArgs(raw: string): Promise<boolean> {
  const risky = riskyLaunchArgs(raw);
  const yes = await confirmModal({
    title: t("settings.argsConfirmTitle"),
    message: t("settings.argsConfirmMessage", { flags: risky.map((r) => r.flag).join(", ") }),
    buttons: [
      { label: t("confirm.cancel"), value: false },
      { label: t("settings.argsConfirmSave"), value: true, danger: true },
    ],
  });
  return yes === true;
}

/// One save: checks the names, asks about risky launch arguments, writes the
/// settings once (10 s at most), then applies the waiting tag and view
/// changes in order. A name that is taken keeps its change, says so on its
/// field and fails the save, with nothing written. True when all is on disk.
async function run(): Promise<boolean> {
  const first = useDraft.getState();
  if (!first.ready || !first.confirmed) return false;
  const live = liveOps(first, useTags.getState().tags, useViews.getState().views);
  const prefsToSave = livePrefs(first.prefs);
  if (!isDirty(first, useTags.getState().tags, useViews.getState().views)) return true;
  if (Object.keys(first.holds).length > 0) return false;
  // A taken name fails the save before anything is written.
  const plan = planOps(live);
  if (Object.keys(plan.errors).length > 0) {
    useDraft.setState({ state: "error", error: Object.values(plan.errors)[0], opErrors: plan.errors });
    return false;
  }

  const args = apply(first.confirmed, first.edits).extra_args ?? "";
  if (args !== (first.confirmed.extra_args ?? "") && riskyLaunchArgs(args).length > 0 && !(await confirmRiskyArgs(args))) {
    // Declined: nothing is saved; the arguments stay in the field to change.
    return false;
  }

  useDraft.setState({ state: "saving", error: null, opErrors: {} });
  try {
    const base = useDraft.getState().confirmed!;
    const body = apply(base, useDraft.getState().edits);
    if (!same(body, base)) {
      try {
        await saveWithin(body);
      } catch (e) {
        useDraft.setState({ state: "error", error: t("settings.saveFailedKept") });
        toast.fail({ title: t("settings.saveFailed"), detail: e });
        return false;
      }
      // What was typed while it saved stays a change over what is now on disk.
      useDraft.setState((cur) => ({
        confirmed: body,
        edits: diff(body, apply(base, cur.edits)),
        saves: cur.saves + 1,
      }));
    }

    // The window's own preferences are stored with the settings.
    for (const [key, value] of prefsToSave) prefOf(key).commit(value as never);
    useDraft.setState((cur) => ({
      prefs: Object.fromEntries(Object.entries(cur.prefs).filter(([k, v]) => !prefsToSave.some(([key, saved]) => key === k && same(saved, v)))),
    }));

    const errors: Record<string, string> = {};
    const done = new Set<TagOp | ViewOp>();
    for (const op of plan.tagOps) {
      if (op.kind === "recolor") {
        useTags.getState().recolor(op.id, op.color);
        done.add(op);
      } else if (useTags.getState().rename(op.id, op.name)) {
        done.add(op);
      } else {
        errors[`tag:${op.id}`] = t("settings.tagsNameTaken", { name: op.name.trim() });
      }
    }
    for (const op of plan.viewOps) {
      if (op.kind === "pin") {
        useViews.getState().setPinned(op.id, op.pinned);
        done.add(op);
      } else if (useViews.getState().rename(op.id, op.name)) {
        done.add(op);
      } else {
        errors[`view:${op.id}`] = t("views.nameTaken", { name: op.name.trim() });
      }
    }
    // The applied ones are on disk; the rest, and anything typed meanwhile, stay.
    useDraft.setState((cur) => ({
      tagOps: cur.tagOps.filter((o) => !done.has(o)),
      viewOps: cur.viewOps.filter((o) => !done.has(o)),
    }));
    const failed = Object.values(errors)[0];
    if (failed) {
      useDraft.setState({ state: "error", error: failed, opErrors: errors });
      return false;
    }
    useDraft.setState({ state: "idle", error: null });
    toast.saved(t("settings.saved"));
    return true;
  } catch (e) {
    // Whatever else goes wrong (a store that throws), the bar never stays on "Saving".
    useDraft.setState({ state: "error", error: t("settings.saveFailedKept") });
    toast.fail({ title: t("settings.saveFailed"), detail: e });
    return false;
  }
}

/// Saves the draft; the save already on its way is the answer to a second ask.
export function saveSettings(): Promise<boolean> {
  if (!running) running = run().finally(() => { running = null; });
  return running;
}

/// Drops every change: the page shows what is on disk again.
export function discardSettings() {
  // A previewed language, theme, size or motion goes back to the stored one.
  for (const key of Object.keys(useDraft.getState().prefs) as PrefKey[]) prefOf(key).restore?.();
  useDraft.setState((cur) => ({ edits: {}, tagOps: [], viewOps: [], prefs: {}, opErrors: {}, error: null, state: cur.state === "saving" ? "saving" : "idle", epoch: cur.epoch + 1 }));
}

/// Reads the settings, after a save still on its way has landed, so the page
/// never shows an older file (I3). A visit starts with no changes.
async function openSettings(): Promise<void> {
  useDraft.setState({
    ready: false, getError: null, state: "idle", error: null, edits: {}, tagOps: [], viewOps: [], prefs: {}, opErrors: {}, saves: 0,
  });
  if (running) await running;
  try {
    const loaded = await settingsGet();
    useDraft.setState({ confirmed: loaded, ready: true });
  } catch (e) {
    useDraft.setState({ getError: String(e) });
  }
}

/** A tag as the page shows it: its waiting rename and color over the saved
 *  ones, and the words of a save that found the name taken. */
export function usePendingTag(tag: Tag) {
  const ops = useDraft((st) => st.tagOps);
  const error = useDraft((st) => st.opErrors[`tag:${tag.id}`]);
  const name = ops.find((o) => o.kind === "rename" && o.id === tag.id);
  const color = ops.find((o) => o.kind === "recolor" && o.id === tag.id);
  return {
    name: name?.kind === "rename" ? name.name : tag.name,
    color: color?.kind === "recolor" ? color.color : tag.color,
    error,
  };
}

/** A view as the page shows it: its waiting rename and pin over the saved ones. */
export function usePendingView(view: ProfileView) {
  const ops = useDraft((st) => st.viewOps);
  const error = useDraft((st) => st.opErrors[`view:${view.id}`]);
  const name = ops.find((o) => o.kind === "rename" && o.id === view.id);
  const pin = ops.find((o) => o.kind === "pin" && o.id === view.id);
  return {
    name: name?.kind === "rename" ? name.name : view.name,
    pinned: pin?.kind === "pin" ? pin.pinned : view.pinned,
    error,
  };
}

/// Settings that change only on Save (manual save, owner 2026-10-07): the
/// page holds a draft of the settings, of the tag and view changes made here,
/// and of this window's own preferences (language, theme, size, motion, keys,
/// usage statistics, the direct-start question); `save` writes it, `discard`
/// drops it. Nothing is shown until the settings are read, so no default flips
/// (LAYOUT-21). Risky launch arguments ask on Save, only when that field
/// changed (SEC-10).
export function useSettingsDraft() {
  const confirmed = useDraft((st) => st.confirmed);
  const edits = useDraft((st) => st.edits);
  const tagOps = useDraft((st) => st.tagOps);
  const viewOps = useDraft((st) => st.viewOps);
  const prefs = useDraft((st) => st.prefs);
  const ready = useDraft((st) => st.ready);
  const state = useDraft((st) => st.state);
  const error = useDraft((st) => st.error);
  const getError = useDraft((st) => st.getError);
  const saves = useDraft((st) => st.saves);
  const epoch = useDraft((st) => st.epoch);
  const held = useDraft((st) => Object.values(st.holds)[0] ?? null);
  const tags = useTags((st) => st.tags);
  const views = useViews((st) => st.views);
  const s = useMemo(() => (ready && confirmed ? apply(confirmed, edits) : null), [ready, confirmed, edits]);

  // What the page shows of this window's own preferences: the previewed ones
  // are what their stores show; the others are the draft over the stored one.
  const lang = useLang((st) => st.lang);
  const { previewTheme, theme: chosenTheme } = useTheme();
  const size = useInterfaceSize((st) => st.choice);
  const reduceMotion = useMotion((st) => st.reduce);
  const singleKeys = useKeyPrefs((st) => st.singleKeys);
  const askDirect = useDirectStart((st) => st.ask);
  const p: LocalPrefs = {
    lang,
    theme: previewTheme ?? chosenTheme,
    size,
    reduceMotion,
    singleKeys: prefs.singleKeys ?? singleKeys,
    askDirect: prefs.askDirect ?? askDirect,
  };
  const dirty = ready && isDirty({ edits, tagOps, viewOps, prefs }, tags, views);

  // One read per open, also under StrictMode's second effect run: a second
  // read that succeeds would show the form beside the first one's error.
  // A page rebuilt while it holds changes (showing another language rebuilds
  // the whole tree) keeps them: it is the same visit.
  const read = useRef(false);
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const cur = useDraft.getState();
    if (cur.ready && isDirty(cur, useTags.getState().tags, useViews.getState().views)) return;
    void openSettings();
  }, []);

  const retry = useCallback(() => void openSettings(), []);
  return {
    s, saved: confirmed, set: setSettings, p, setP: setPref, dirty, save: saveSettings, discard: discardSettings, state, error, held,
    queueTagOp, queueViewOp, getError, retry, saves, epoch,
  };
}
