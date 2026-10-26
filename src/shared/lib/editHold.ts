/// Whether the person is editing, so a list holds back what would move
/// beside them: its columns never change width while someone types
/// (autofit review I2). Editing is the keyboard in a field that takes text,
/// anywhere in the app.

/** Input types a person types text into. */
const TEXT = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

export function editing(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT.has(el.type) && !el.readOnly;
}
