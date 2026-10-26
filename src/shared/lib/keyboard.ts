import { HOST_OS } from "./utils";

// Only inputs whose type is meant for typed text: a checkbox, radio or
// button input keeps no useful "Copy"/"Paste" (src/app/guards.ts, which
// shares this list) and must not swallow the list's own keys either — a
// ticked checkbox is not a text field (fix round 1, finding 3).
export const TEXT_INPUT_TYPES = new Set([
  "text", "search", "email", "url", "tel", "password", "number",
]);

/** An open dialog, menu or list box has the keyboard. One that is leaving
 *  (its exit fading) does not: the next key belongs to the page (ANIM-03).
 *  Nor does one inside or around `except` (the palette asking about the
 *  others, PC-111). */
export function overlayHasKeyboard(except?: string): boolean {
  const found = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
  return [...found].some((el) =>
    !el.closest("[data-ending-style]") && !(except && (el.closest(except) || el.querySelector(except))));
}

/** Something else wants the keyboard: a field meant for typed text (an `input` whose
 *  type takes typed text, a `textarea`, a `select`, or something
 *  contenteditable), a surface marked `data-own-keys` (the Automation live
 *  browser view), or an open dialog or menu. A checkbox, radio or plain
 *  button `input` is not a text field: the list's own keys still act with
 *  focus there (fix round 1, finding 3 — ticking a row with the mouse must
 *  not kill S/X/the arrows). */
export function keyboardIsTaken(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null;
  if (el) {
    if (el.isContentEditable || el.closest("[data-own-keys]")) return true;
    const input = el.closest("input");
    if (input) return TEXT_INPUT_TYPES.has(input.type);
    // A kit Select or Combobox trigger owns its keys too (type-ahead, "?").
    if (el.closest('textarea, select, [role="combobox"]')) return true;
  }
  return overlayHasKeyboard();
}

/** The platform's command modifier: Cmd on macOS, Ctrl elsewhere. */
export function isMod(e: KeyboardEvent): boolean {
  return HOST_OS === "macOS" ? e.metaKey : e.ctrlKey;
}

/** Shift+F10 or the Menu key: the keyboard's way to a context menu. */
export function isContextMenuKey(e: KeyboardEvent): boolean {
  return (e.shiftKey && e.key === "F10") || e.key === "ContextMenu";
}

/** Opens `el`'s own context menu from the keyboard (PC-006). macOS engines
 *  send no `contextmenu` for Shift+F10, so a list sends it itself, with no
 *  pointer (0,0), as Windows does: the kit menu host opens it under `el`,
 *  never at the window's corner. */
export function openContextMenuFromKeys(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
}
