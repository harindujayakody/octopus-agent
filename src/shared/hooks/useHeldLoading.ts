import { useLayoutEffect, useRef, useState } from "react";
import { sharedTimeout } from "../lib/sharedTimeout";

/** Placeholder rows wait this long before they show: a quicker answer shows none (WIG-12). */
export const SKELETON_DELAY_MS = 150;
/** Once shown, they stay at least this long: one that blinks reads as a flicker (WIG-12). */
export const SKELETON_MIN_MS = 400;

/// Whether a first load still counts as loading: true while `loading`, and a
/// little longer when its placeholder rows were on screen for less than
/// `min`. `LoadingRows` itself waits `delay` before it shows, counted from
/// the same moment: it mounts when `loading` turns true, and both clocks
/// start in that commit's layout effects.
///
/// The minimum counts from when the rows really showed, not from when they
/// were due: a busy page runs their timer late. Their timer and this hook's
/// clock share one task (`sharedTimeout`): the rows commit (LoadingRows, a
/// child, so started first), and the clock notes the time right after, with
/// no task between them. Two timers let an answer land between the two, and
/// rows that had shown went at once (Pair 3 review, Minor 1). That needs
/// `LoadingRows` mounted in the commit `loading` turns true: render it
/// whenever this returns true, and pass only a load the list shows (a page
/// that shows something else first passes false meanwhile).
///
/// The render a load ends in still counts as loading, so the rows stay
/// mounted (a remount would start their delay again). A layout effect then
/// decides, before the frame is painted: rows never shown (a quick answer)
/// or shown long enough go at once; the others stay until `min` is up.
export function useHeldLoading(loading: boolean, delay = SKELETON_DELAY_MS, min = SKELETON_MIN_MS): boolean {
  const shownAt = useRef<number | null>(null);
  const [held, setHeld] = useState(false);
  const [wasLoading, setWasLoading] = useState(loading);
  if (wasLoading !== loading) {
    setWasLoading(loading);
    setHeld(!loading);
  }
  useLayoutEffect(() => {
    if (!loading) return;
    shownAt.current = null;
    return sharedTimeout(delay, () => { shownAt.current = performance.now(); });
  }, [loading, delay]);
  useLayoutEffect(() => {
    if (loading || !held) return;
    const at = shownAt.current;
    const left = at === null ? 0 : at + min - performance.now();
    if (left <= 0) {
      setHeld(false);
      return;
    }
    const timer = setTimeout(() => setHeld(false), left);
    return () => clearTimeout(timer);
  }, [loading, held, min]);
  return loading || held;
}
