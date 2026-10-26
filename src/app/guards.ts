// Only inputs whose type is meant for typed text: a checkbox, radio or
// button keeps no useful "Copy" or "Paste" and must not keep the webview
// menu either (review finding). Shared with `keyboardIsTaken`, which the
// list keyboards use for the same "is this really a text field" question
// (fix round 1, finding 3).
import { TEXT_INPUT_TYPES } from "../shared/lib/keyboard";

/// Whether `target` is a field the webview's own menu (Copy/Paste/spellcheck)
/// is actually useful in: an `input` whose type takes typed text, a
/// `textarea`, or something `contenteditable` that isn't explicitly turned off.
function isTextField(target: Element): boolean {
  const input = target.closest("input");
  if (input) return TEXT_INPUT_TYPES.has(input.type);
  if (target.closest("textarea")) return true;
  const editable = target.closest("[contenteditable]");
  return editable ? editable.getAttribute("contenteditable") !== "false" : false;
}

/// Window-wide guards for the desktop window (overview A10).
///
/// A file dragged onto the window must not make the webview open that file in
/// place of the app (SEC-18). A profile row's drag carries no files and is
/// left alone. The webview's own context menu ("Reload", "Back", "Print")
/// must not appear outside a text field or a selection that actually covers
/// the right-clicked spot (EMIL-22 review). The menu guard runs in release
/// builds and in the mock; `tauri dev` keeps the menu for Inspect.
export function installWindowGuards(): void {
  const blockFileDrop = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  };
  window.addEventListener("dragover", blockFileDrop);
  window.addEventListener("drop", blockFileDrop);

  // Cmd/Ctrl+A selects the field it is pressed in or, in a list, the list's
  // rows (the list handles it first and prevents the default); anywhere else
  // it would paint the whole window blue, so it does nothing (WIG-04).
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (e.code !== "KeyA" && e.key.toLowerCase() !== "a") return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest("input, textarea, [contenteditable='true'], [data-selectable]")) return;
    e.preventDefault();
  });

  if (import.meta.env.DEV && import.meta.env.VITE_MOCK !== "1") return;
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return; // a row or item opened its own menu
    const target = e.target instanceof Element ? e.target : null;
    if (target && isTextField(target)) return;
    const sel = window.getSelection();
    if (target && sel && !sel.isCollapsed && sel.containsNode(target, true)) return;
    e.preventDefault();
  });
}
