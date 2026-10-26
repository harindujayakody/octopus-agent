import { useNav } from "../../../shared/model/navigation";
import { openProfileForm, useProfileForm } from "../../profile-form/model/useProfileForm";
import { useTour } from "../model/useTour";
import { profileTour } from "../steps/profileTour";

/** How long to wait for the form to have its draft: the fingerprints' GPU
 *  verdicts come first, and a form that never loads (no fingerprints) shows
 *  its error instead, which the walk has nothing to say about. */
const READY_MS = 5000;
/** How long the form may take to put the keyboard on Name, its own first
 *  move, so the walk's card takes it after and not before. */
const SETTLE_MS = 500;

/**
 * The walk through the form that is open now (the form's own "Show me
 * around"): from the first step, on the first tab, with whatever was typed
 * kept. A form that is not open, or is an edit form, has no walk.
 */
export function walkTheForm(): void {
  const form = useProfileForm.getState();
  if (!form.open || form.mode !== "create") return;
  useTour.getState().start(profileTour, "form");
}

/** Resolves true once the form of `session` has its draft; false when it closed, failed to load, or took too long. */
function formReady(session: number): Promise<boolean> {
  return new Promise((resolve) => {
    const ready = () => {
      const s = useProfileForm.getState();
      return s.session === session && s.open && s.draft !== null;
    };
    if (ready()) { resolve(true); return; }
    let stop = () => {};
    const timer = window.setTimeout(() => { stop(); resolve(false); }, READY_MS);
    stop = useProfileForm.subscribe((s) => {
      if (ready()) { window.clearTimeout(timer); stop(); resolve(true); }
      else if (s.session !== session || !s.open || s.status === "error") { window.clearTimeout(timer); stop(); resolve(false); }
    });
  });
}

/** Resolves once the keyboard is in the form (its Name field takes it as the form opens), or after a moment. */
function formSettled(): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      if (document.activeElement?.closest("[data-profile-form]") || performance.now() - started > SETTLE_MS) { resolve(); return; }
      window.setTimeout(check, 16);
    };
    check();
  });
}

/**
 * "Create your first profile" on the end card: opens the New profile form on
 * the Profiles page, through the unsaved-changes guard (Cancel there leaves
 * everything as it was), and walks it. Nothing is created by this: only
 * Create profile makes the profile.
 */
export async function startProfileTour(): Promise<void> {
  if (!(await useNav.getState().setSection("profiles"))) return;
  openProfileForm({ mode: "create" });
  const session = useProfileForm.getState().session;
  if (!(await formReady(session))) return;
  await formSettled();
  if (useProfileForm.getState().session !== session) return;
  walkTheForm();
}
