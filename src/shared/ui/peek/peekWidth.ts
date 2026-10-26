import { useNarrowWindow } from "../../hooks/useNarrowWindow";

/** Peek's width from 1280 layout px: wide enough for a property sheet. */
export const PEEK_WIDTH = 420;
/** Below 1280 layout px (Interface size counts): the width the smallest
 *  window keeps for the list's Name, Status and Proxy beside Peek. */
export const PEEK_WIDTH_NARROW = 360;
/** The row's gap between the list's column and Peek (`gap-panel`, 8 px). */
export const PEEK_GAP = 8;

/** Peek's width now: 420 px, or 360 px when the window is narrower than
 *  1280 layout px. Peek always sits beside the list, never over it. */
export function usePeekWidth(): number {
  return useNarrowWindow() ? PEEK_WIDTH_NARROW : PEEK_WIDTH;
}
