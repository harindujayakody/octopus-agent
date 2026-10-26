import { create } from "zustand";
import { prefersReducedMotion } from "@proxyshard/shardx-ui-kit";
import { useNav } from "../../../shared/model/navigation";
import { toast } from "../../../shared/model/toast";
import { t } from "../../../shared/i18n";
import type { Section } from "../../../shared/types";
import { setProfileFormTab, useProfileForm } from "../../profile-form/model/useProfileForm";
import { PAGE_TITLE, findTarget, lookupTarget, navKey } from "../lib/findTarget";
import type { TourEnded, TourEndReason, TourRun, TourStep } from "./types";

/** Between two steps: the page is changing (the unsaved-changes guard may
 *  ask, so the tour steps aside), or the next element is being looked for. */
export type TourPending = "page" | "target" | null;

/** The page the tour has just moved to, shown on its own before the step's
 *  action: the cut-out is on the page's item in the sidebar (`key`: its
 *  `navKey`, or the page title when the sidebar is folded to its rail) and
 *  the card names the page. */
export type TourBeat = { section: Section; key: string };

/** How long the beat holds, at least: a second, and about half of that with
 *  Reduce motion (no glide to wait for). The step's element is waited for
 *  too, so the beat is never shorter than the lookup. */
const BEAT_MS = 1000;
const BEAT_REDUCED_MS = 600;

type TourState = {
  run: TourRun | null;
  /** The element the step on screen points at; null shows its card centred.
   *  Kept after the run ends, so the scrim leaves from where it was; the
   *  layer clears it as it unmounts. */
  target: HTMLElement | null;
  pending: TourPending;
  /** Set while a page change shows which page it moved to, before the step
   *  lands (a full tour only: a page's run stays on its page). */
  beat: TourBeat | null;
  /** Counts runs: each one gets a layer of its own (its focus, its first step). */
  runId: number;
  /** How the last run ended; null before any end and while a new run starts. */
  ended: TourEnded | null;
  /** Starts `steps` from the first (a run under way gives way to it). A run
   *  in the profile form (`form`) needs the form open and starts nothing otherwise. */
  start: (steps: TourStep[], kind: TourRun["kind"], page?: TourRun["page"]) => void;
  /** The next step, on its page; Finish on the last ends the run ("done").
   *  During a beat: on to the step's action at once. */
  next: () => Promise<void>;
  back: () => Promise<void>;
  end: (reason: TourEndReason) => void;
};

/** Bumped by every move and by the end, so a page change or a lookup that
 *  finishes after a newer one (or after the end) drops its result. */
let seq = 0;
/** Counts ends (`TourEnded.id`). */
let endedCount = 0;
/** The furthest step that has been on screen in this run (-1 before the
 *  first lands): `run.index` is 0 from the start, before step 1 is there. */
let landed = -1;
/** Stops the element lookup of the move it belongs to once a newer move or the end supersedes it. */
let lookupAbort: AbortController | null = null;
/** Ends the beat's hold now (Next during the beat, a newer move, the end). */
let endHold: (() => void) | null = null;
const stopLookup = () => { lookupAbort?.abort(); lookupAbort = null; endHold?.(); };
/** Resolves after `ms`, or as soon as `endHold` is called. */
const hold = (ms: number) => new Promise<void>((resolve) => {
  const done = () => { clearTimeout(timer); if (endHold === done) endHold = null; resolve(); };
  const timer = setTimeout(done, ms);
  endHold = done;
});

export const useTour = create<TourState>((set, get) => {
  /** Shows step `index`: its page first (through the guard), then its element. */
  const go = async (index: number) => {
    const run = get().run;
    const step = run?.steps[index];
    if (!run || !step) return;
    const my = ++seq;
    stopLookup();
    // A run in the profile form is in the form, not on a page: it changes no
    // page (so no beat, no guard), and it shows the step's tab itself.
    const form = run.kind === "form";
    if (form) {
      if (!useProfileForm.getState().open) { get().end("cancelled"); return; }
      if (step.formTab) setProfileFormTab(step.formTab);
    }
    const nav = useNav.getState();
    const otherTab = !form && step.section === "settings" && step.settingsTab !== undefined && nav.settingsTab !== step.settingsTab;
    const otherPage = !form && step.section !== nav.section;
    if (otherPage || otherTab) {
      set({ pending: "page" });
      const moved = step.section === "settings" ? await nav.openSettings(step.settingsTab) : await nav.setSection(step.section);
      if (my !== seq) return;
      // Cancel in the guard: the person stays on the page, and the tour ends there.
      if (!moved) { get().end("cancelled"); return; }
    }
    lookupAbort = new AbortController();
    const { signal } = lookupAbort;
    let held: Promise<void> | undefined;
    if (otherPage && run.kind === "full") {
      // The page is opening: the cut-out lands on its item in the sidebar (on
      // its title when the sidebar is a rail) and holds there while the
      // step's element is looked for, so the change of page is seen.
      const section = step.section;
      const key = lookupTarget(navKey(section)) ? navKey(section) : PAGE_TITLE;
      const mark = lookupTarget(key);
      set({ pending: "target", beat: { section, key }, target: mark });
      held = hold(prefersReducedMotion() ? BEAT_REDUCED_MS : BEAT_MS);
      // A page title may not be drawn yet (its code is on its way): the cut-out lands on it when it is.
      if (!mark) void findTarget(key, undefined, signal).then((el) => { if (el && my === seq && get().beat) set({ target: el }); });
    } else {
      set({ pending: "target" });
    }
    const [target] = await Promise.all([step.target ? findTarget(step.target, undefined, signal) : null, held]);
    const now = get().run;
    if (my !== seq || !now) return;
    landed = Math.max(landed, index);
    set({ run: { ...now, index }, target, pending: null, beat: null });
  };

  return {
    run: null,
    target: null,
    pending: null,
    beat: null,
    runId: 0,
    ended: null,
    start: (steps, kind, page) => {
      if (steps.length === 0) return;
      if (kind === "form" && !useProfileForm.getState().open) return;
      seq++;
      stopLookup();
      landed = -1;
      set((s) => ({ run: { kind, page, steps, index: 0 }, target: null, pending: "target", beat: null, runId: s.runId + 1, ended: null }));
      void go(0);
    },
    next: async () => {
      const { run, pending, beat } = get();
      if (!run) return;
      // Next during a beat: on to the action now (it still waits for its element).
      if (beat) { endHold?.(); return; }
      if (pending) return;
      if (run.index >= run.steps.length - 1) { get().end("done"); return; }
      await go(run.index + 1);
    },
    back: async () => {
      const { run, pending } = get();
      if (!run || pending || run.index === 0) return;
      await go(run.index - 1);
    },
    end: (reason) => {
      const run = get().run;
      if (!run) return;
      seq++;
      stopLookup();
      const shown = reason === "done" ? run.steps : run.steps.slice(0, landed + 1);
      const visited = [...new Set(shown.map((s) => s.section))];
      set({ run: null, pending: null, beat: null, ended: { id: ++endedCount, reason, kind: run.kind, page: run.page, visited } });
      // Where to get it back: a tip comes back from the (i), the walk from the
      // form's link, the tour from Settings.
      if (reason === "esc") toast.info(run.kind === "page" ? t("tour.tipsHint") : run.kind === "form" ? t("tour.formHint") : t("tour.replayHint"));
    },
  };
});

// A page change the tour did not make ends the run: a link elsewhere in the
// app, a deep link, anything. The card would sit over a page it was not written
// for, and Next would drive the person back. The tour's own moves set
// `pending: "page"` before they ask for the page, and the section changes
// inside that call, so they never end here. "cancelled" marks no page seen.
useNav.subscribe((state, prev) => {
  if (state.section === prev.section) return;
  const tour = useTour.getState();
  if (tour.run && tour.pending !== "page") tour.end("cancelled");
});

// A walk through the profile form lives and dies with the form: it ends when
// the form closes (or opens on something else), and when Create profile is
// pressed (the form starts saving: the normal create flow runs, with nothing
// of the tour left over it). The form's other changes, a tab, a typed name,
// a pick, are the person's and leave the run alone.
useProfileForm.subscribe((state, prev) => {
  const tour = useTour.getState();
  if (tour.run?.kind !== "form") return;
  if (!state.open || state.session !== prev.session) tour.end("cancelled");
  else if (state.status === "saving" && prev.status !== "saving") tour.end("done");
});
