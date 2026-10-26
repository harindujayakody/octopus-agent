import { create } from "zustand";
import { PROFILE_TABLE } from "./columns";

/// The row actions' track, px: Start's 76 px, or as wide as its longest word needs
/// ("Остановить"), measured by the list (ProfileTable's probe), so the button never
/// runs over the strip of icons beside it.
export const useActionsTail = create<{ tail: number }>(() => ({ tail: PROFILE_TABLE.tail }));

/** The widest Start, Stop or Cancel the list measured, px. */
export function setRunButtonWidth(px: number): void {
  const tail = PROFILE_TABLE.tail + Math.max(0, Math.ceil(px) - RUN_BUTTON_MIN);
  if (useActionsTail.getState().tail !== tail) useActionsTail.setState({ tail });
}

/** Start's own floor (ProfileRowActions `min-w-[76px]`). */
export const RUN_BUTTON_MIN = 76;
