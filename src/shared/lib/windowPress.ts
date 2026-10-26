// Which presses on a drag surface may move the window. No imports: node --test reads it.

/** A press on these is a control's, never the ground's: native controls and
 *  labels, ARIA widget roles, editable text, a disabled control (PC-011). */
export const CONTROL_SELECTOR = [
  "button", "a", "input", "select", "textarea", "label",
  "[contenteditable]:not([contenteditable='false'])",
  ...["button", "link", "checkbox", "radio", "switch", "tab", "combobox", "listbox", "option",
    "menuitem", "menuitemcheckbox", "menuitemradio", "slider", "spinbutton", "textbox", "searchbox", "treeitem"]
    .map((r) => `[role='${r}']`),
  "[aria-disabled='true']", "[data-disabled]",
].join(", ");

type Press = { button: number; target: EventTarget | null; currentTarget: EventTarget | null };

/** Primary button, off controls, and inside the surface's own DOM: React bubbles
 *  portal presses (menus, popovers) here too, and a drag on Windows eats their click. */
export function pressMovesWindow(e: Press): boolean {
  if (e.button !== 0) return false;
  const surface = e.currentTarget as Node | null;
  const target = e.target as Node | null;
  if (!surface || !target || !surface.contains(target)) return false;
  return !(target as Partial<Element>).closest?.(CONTROL_SELECTOR);
}
