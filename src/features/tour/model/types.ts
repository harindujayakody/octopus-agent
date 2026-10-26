import type { Section } from "../../../shared/types";
import type { SettingsTab } from "../../../shared/model/navigation";
import type { ProfileFormTab } from "../../profile-form/model/useProfileForm";

/** A small drawing of a part of the app, shown on a centred card when the
 *  step's element is not on screen yet (no profiles: no list, no Start
 *  button, no Filters). */
export type TourPictureId = "panel" | "startButton" | "automationEditor" | "profileList" | "filters";

/** One step of a tour. `target` is the element's `data-tour` key, or
 *  `page-title` for the page's heading (null: a centred card that points at
 *  nothing). `title` and `body` are translation keys; text that is no key
 *  shows as it is. */
export type TourStep = {
  id: string;
  section: Section;
  /** With `section: "settings"`: the tab the step is on. */
  settingsTab?: SettingsTab;
  /** In a run in the profile form (`kind: "form"`): the form's tab the step
   *  is on, which the tour switches to itself. None: the tab stays as it is. */
  formTab?: ProfileFormTab;
  target: string | null;
  title: string;
  body: string;
  picture?: TourPictureId;
};

/** A tour under way: the full tour, one page's tip that nobody asked for
 *  (`page`: it offers "Don't show tips"), one page's steps played because
 *  the person pressed "Show me around" in its (i) (`around`: no such link),
 *  or the walk through the New profile form (`form`: it stays in the open
 *  form, switches its tabs, has no change of page and no "Don't show tips",
 *  and lets presses through to the part it frames). `index` is the step on screen. */
export type TourRun = { kind: "full" | "page" | "around" | "form"; page?: Section; steps: TourStep[]; index: number };

/** How a run ended: Finish on the last step, Skip tour, Esc, or a page change the person cancelled. */
export type TourEndReason = "done" | "skip" | "esc" | "cancelled";

/** The last run's end, kept on the store for what comes after it (the
 *  onboarding record, the end card). `id` counts ends, so the same reason
 *  twice in a row is still a new end. `visited` lists the pages whose steps
 *  were shown, in order: every page of a finished run, up to the step on
 *  screen for any other end. */
export type TourEnded = { id: number; reason: TourEndReason; kind: TourRun["kind"]; page?: Section; visited: Section[] };
