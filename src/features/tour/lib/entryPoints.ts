import type { Section } from "../../../shared/types";
import { useNav } from "../../../shared/model/navigation";
import { useOnboarding } from "../../onboarding/model/onboarding";
import { useTour } from "../model/useTour";
import { fullTour } from "../steps/fullTour";
import { pageTips } from "../steps/pageTips";

/**
 * "Take the tour" and "Replay the tour" (Settings > About, the palette,
 * What's new after an update): the full tour from step 1. It goes to
 * Profiles first, through the unsaved-changes guard, so Cancel there leaves
 * everything as it was. Then it forgets what the tour and the tips
 * remembered (the tour, and every page seen), and starts. The welcome counts
 * as answered: a replay is its own answer, and a tour that starts must not
 * share the screen with the welcome.
 */
export async function takeTheTour(): Promise<void> {
  const moved = await useNav.getState().setSection("profiles");
  if (!moved) return;
  const onboarding = useOnboarding.getState();
  if (!onboarding.welcomeDone) onboarding.setWelcomeDone();
  onboarding.resetTour();
  useTour.getState().start(fullTour, "full");
}

/** The steps a page's "Show me around" plays: its tip, and for Profiles, which has none, its part of the full tour (the first nine steps). */
const aroundSteps = (section: Section) =>
  section === "profiles" ? fullTour.filter((step) => step.section === "profiles") : pageTips[section];

/**
 * A page's (i) "Show me around": only that page's steps, from the first. The
 * person asked, so the run has no "Don't show tips" (`around`, not `page`),
 * and it still marks the page seen when it ends. The full tour's record
 * (done or skipped) is left alone.
 */
export function showMeAround(section: Section): void {
  const steps = aroundSteps(section);
  if (!steps) return;
  useTour.getState().start(steps, "around", section);
}
