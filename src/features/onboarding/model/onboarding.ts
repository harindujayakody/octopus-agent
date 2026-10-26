import { create } from "zustand";
import { SECTIONS, type Section } from "../../../shared/types";
import { useWhatsNew, type InstallKind } from "../../../shared/model/whatsNew";

/// Whether setup is under way, and the tour's progress, kept on this computer
/// (Phase 5: frontend only). "unknown" until the Profiles list first loads:
/// no profiles then means a fresh install ("active"); any profile means the
/// user is past it. Version 2 adds the welcome, the tour and the page tips
/// (onboarding spec 7); a version 1 record keeps its state and gets the new
/// fields at their defaults. `firstInstall` joined version 2 later: a record
/// without it reads as false.
const KEY = "shardx.onboarding";
const VERSION = 2;

export type OnboardingState = "unknown" | "active" | "done";
/** The full tour: never offered or never answered, put away, or seen to the end. */
export type TourState = "never" | "skipped" | "done";

type Saved = {
  state: OnboardingState;
  welcomeDone: boolean;
  tour: TourState;
  /** Pages whose steps the user has seen (the full tour or the page's tip). */
  pagesSeen: Section[];
  tipsOff: boolean;
  /** The launch that first set this computer up was this record's (the What's
   *  new gate found no seen version): the welcome is owed to it until it is
   *  answered, however many starts that takes. An updated computer never has
   *  it, so a setup it left unfinished does not open the welcome later. */
  firstInstall: boolean;
};

const DEFAULTS: Saved = { state: "unknown", welcomeDone: false, tour: "never", pagesSeen: [], tipsOff: false, firstInstall: false };
const TOURS: readonly TourState[] = ["never", "skipped", "done"];
const isSection = (v: unknown): v is Section => (SECTIONS as readonly unknown[]).includes(v);

/** What is stored, as this version reads it. A broken value decides again. */
function parse(text: string | null): Saved {
  let raw: Partial<Saved> & { version?: unknown } | null = null;
  try { raw = JSON.parse(text ?? "null"); } catch { /* broken: decide again */ }
  if (!raw || typeof raw !== "object" || (raw.version !== 1 && raw.version !== VERSION)) return { ...DEFAULTS };
  const v2 = raw.version === VERSION;
  return {
    state: raw.state === "active" || raw.state === "done" ? raw.state : "unknown",
    welcomeDone: v2 && raw.welcomeDone === true,
    tour: v2 && TOURS.includes(raw.tour as TourState) ? (raw.tour as TourState) : "never",
    pagesSeen: v2 && Array.isArray(raw.pagesSeen) ? [...new Set(raw.pagesSeen.filter(isSection))] : [],
    tipsOff: v2 && raw.tipsOff === true,
    firstInstall: v2 && raw.firstInstall === true,
  };
}

/** Writes the record; false when the storage refuses (blocked, private mode, full). */
function write(r: Saved): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: VERSION, ...r }));
    return true;
  } catch {
    return false;
  }
}

/** The stored record, written straight back (a version 1 record leaves as
 *  version 2). `ok` is false when the storage cannot be read or written (it
 *  throws): then nothing extra shows (no welcome, no tips), so a storage that
 *  refuses can never bring the welcome back on every start. One that takes
 *  writes and silently loses them cannot be told apart; the app's own
 *  storage does not do that. */
function load(): Saved & { ok: boolean } {
  let text: string | null;
  try { text = localStorage.getItem(KEY); } catch { return { ...DEFAULTS, ok: false }; }
  const r = parse(text);
  return { ...r, ok: write(r) };
}

const initial = load();

type Actions = {
  /** Only while unknown: the first loaded list decides. */
  decide: (hasProfiles: boolean) => void;
  /** Done, or put away: it never shows again. */
  finish: () => void;
  /** The welcome was answered (Skip or Start tour): it never shows again. */
  setWelcomeDone: () => void;
  setTour: (tour: TourState) => void;
  /** A page whose steps the user has seen: its tip does not play. */
  markPageSeen: (section: Section) => void;
  setTipsOff: (off: boolean) => void;
  /** This launch is the first install: remembered, so a later start still owes the welcome. */
  markFirstInstall: () => void;
  /** Settings > About, "Replay the tour": the tour and every page's tip again. */
  resetTour: () => void;
};

export const useOnboarding = create<Saved & Actions & {
  /** False once a read or a write of the record threw: nothing extra shows then. */
  storageOk: boolean;
}>((set, get) => {
  /** Sets and stores in one go; a write that throws turns `storageOk` off for good. */
  const change = (patch: Partial<Saved>) => {
    const { state, welcomeDone, tour, pagesSeen, tipsOff, firstInstall } = { ...get(), ...patch };
    const ok = write({ state, welcomeDone, tour, pagesSeen, tipsOff, firstInstall });
    set(ok ? patch : { ...patch, storageOk: false });
  };
  const { ok, ...record } = initial;
  return {
    ...record,
    storageOk: ok,
    decide: (hasProfiles) => {
      if (get().state !== "unknown") return;
      change({ state: hasProfiles ? "done" : "active" });
    },
    finish: () => change({ state: "done" }),
    setWelcomeDone: () => change({ welcomeDone: true }),
    setTour: (tour) => change({ tour }),
    markPageSeen: (section) => {
      if (get().pagesSeen.includes(section)) return;
      change({ pagesSeen: [...get().pagesSeen, section] });
    },
    setTipsOff: (tipsOff) => change({ tipsOff }),
    markFirstInstall: () => { if (!get().firstInstall) change({ firstInstall: true }); },
    resetTour: () => change({ tour: "never", pagesSeen: [] }),
  };
});

/** The What's new gate reads the seen version once per start, after the app is
 *  up. The launch it calls "first" is written into the record at once, so that
 *  a start that quits before the welcome is answered still owes it next time. */
const rememberFirstInstall = (installKind: InstallKind) => {
  if (installKind === "first") useOnboarding.getState().markFirstInstall();
};
useWhatsNew.subscribe((s, prev) => { if (s.installKind !== prev.installKind) rememberFirstInstall(s.installKind); });
rememberFirstInstall(useWhatsNew.getState().installKind);

/** The welcome's conditions, over a snapshot of the record: storage works, it
 *  was never answered, the tour was never offered, this is no update (an
 *  updated user gets What's new with its Take the tour button, never both
 *  stacked), and this is the launch of a first install (the What's new gate
 *  found no version), or a later start of one whose setup is still under way
 *  (onboarding spec 3). A computer that was updated, or whose record has no
 *  `firstInstall`, never gets the welcome from an unfinished setup alone. */
const wantsWelcome = (o: Pick<Saved, "state" | "welcomeDone" | "tour" | "firstInstall"> & { storageOk: boolean }, installKind: InstallKind) =>
  o.storageOk && !o.welcomeDone && o.tour === "never" && installKind !== "update" && (installKind === "first" || (o.firstInstall && o.state === "active"));

/** Whether the welcome opens: see `wantsWelcome`. */
export function shouldWelcome(): boolean {
  return wantsWelcome(useOnboarding.getState(), useWhatsNew.getState().installKind);
}

/** `shouldWelcome` as a value a component renders from: it changes the moment
 *  the answer, the install kind or the setup state does. */
export function useShouldWelcome(): boolean {
  const installKind = useWhatsNew((s) => s.installKind);
  return useOnboarding((s) => wantsWelcome(s, installKind));
}
