import type { KeyboardEvent } from "react";

/** Arrow keys move the choice, and the focus with it, inside a radio group, as
 *  native radios do. */
export function onRadioKeys<T>(e: KeyboardEvent<HTMLElement>, options: T[], current: T, pick: (v: T) => void) {
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const at = Math.max(0, options.indexOf(current));
  const next = (at + step + options.length) % options.length;
  pick(options[next]);
  // React clears currentTarget once the handler returns: take the group now.
  const group = e.currentTarget;
  requestAnimationFrame(() => {
    group.querySelectorAll<HTMLElement>("[role='radio']")[next]?.focus();
  });
}
