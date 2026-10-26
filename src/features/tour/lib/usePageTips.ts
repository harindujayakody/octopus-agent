import { useEffect } from "react";
import { useNav } from "../../../shared/model/navigation";
import { useWhatsNew } from "../../../shared/model/whatsNew";
import { overlayHasKeyboard } from "../../../shared/lib/keyboard";
import { shouldWelcome, useOnboarding, useShouldWelcome } from "../../onboarding/model/onboarding";
import { useTour } from "../model/useTour";
import { pageTips } from "../steps/pageTips";
import { findTarget } from "./findTarget";

/** The tour's own card is a dialog too: it is not "another dialog". */
const TOUR_CARD = "[data-tour-card]";

/** An open dialog, menu or list has the keyboard (the tour's card does not count). */
const somethingOpen = () => overlayHasKeyboard(TOUR_CARD);

/** Resolves once no dialog, menu or list is open: now, or when the last one has closed. `stop` cancels the wait. */
function whenNothingOpen(stop: { current: (() => void) | null }): Promise<void> {
  return new Promise((resolve) => {
    if (!somethingOpen()) { resolve(); return; }
    // Overlays mount in portals under the body and mark their exit.
    const watch = new MutationObserver(() => {
      if (somethingOpen()) return;
      watch.disconnect();
      resolve();
    });
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-ending-style"] });
    stop.current = () => watch.disconnect();
  });
}

/**
 * Page tips (onboarding spec 6), mounted once in the shell. On the first
 * visit to a page that has a tip, and not before it has been seen (in the
 * full tour or as a tip), the tip's two or three steps play once the page's
 * element is there. Never while a tour is running, the welcome is up or
 * waiting, or a dialog is open (it waits for the dialog to close), and never
 * when tips are off or the storage cannot keep what was seen. Any end of a
 * page's run marks the page seen, except a cancelled one (the person was
 * moved off the page before the tip was read: it plays on the next visit).
 */
export function usePageTips() {
  const section = useNav((s) => s.section);
  const storageOk = useOnboarding((s) => s.storageOk);
  const tipsOff = useOnboarding((s) => s.tipsOff);
  const seen = useOnboarding((s) => s.pagesSeen.includes(section));
  const welcome = useShouldWelcome();
  const running = useTour((s) => s.run !== null);
  // What's new may open at the start: a tip waits until that is decided and
  // the dialog is closed. Its code loads late, so the DOM alone says "nothing open" too soon.
  const newsDecided = useWhatsNew((s) => s.decided);
  const newsOpen = useWhatsNew((s) => s.open);
  const steps = pageTips[section];

  useEffect(() => {
    if (!steps || !storageOk || tipsOff || seen || welcome || running || !newsDecided || newsOpen) return;
    let cancelled = false;
    const stop: { current: (() => void) | null } = { current: null };
    const lookup = new AbortController();
    // Read again at the moment of the start: the answers above are from the
    // last render, and a full tour that just ended marks its pages in the
    // same breath as it frees this effect.
    const stillWanted = () => {
      const o = useOnboarding.getState();
      return !cancelled && o.storageOk && !o.tipsOff && !o.pagesSeen.includes(section) && !shouldWelcome()
        && useNav.getState().section === section && useTour.getState().run === null && !useWhatsNew.getState().open;
    };
    void (async () => {
      // The page's element first: a lazy page is still loading, and its first
      // look should not wait under a scrim. A page without it plays the tip anyway.
      if (steps[0].target) await findTarget(steps[0].target, undefined, lookup.signal);
      if (cancelled) return;
      await whenNothingOpen(stop);
      if (!stillWanted()) return;
      useTour.getState().start(steps, "page", section);
    })();
    return () => { cancelled = true; lookup.abort(); stop.current?.(); };
  }, [section, steps, storageOk, tipsOff, seen, welcome, running, newsDecided, newsOpen]);

  // Every end of a page's run (Finish, Skip, Esc, Don't show tips), a tip or
  // a "Show me around", marks the page seen, so the tip does not come back.
  // A cancelled run (the page changed under it, or the guard's Cancel) was not
  // read: its page stays unseen.
  useEffect(() => useTour.subscribe((s, prev) => {
    const ended = s.ended;
    if (ended && ended !== prev.ended && ended.kind !== "full" && ended.page && ended.reason !== "cancelled") useOnboarding.getState().markPageSeen(ended.page);
  }), []);
}
