import { flushSync } from "react-dom";

/// A manual save reads its draft when it is pressed, but a field that still
/// has the keyboard may hold text its form has not taken yet (a number typed
/// past its range, brought into range only when the field is left). Such a
/// field registers here; every save calls `commitFocusedField()` first, so
/// what the screen shows is what is saved.
type Committable = {
  /** The element that has the keyboard when this field is the focused one. */
  owns: (focused: Element) => boolean;
  /** Takes what is typed into the form, as leaving the field would. */
  commit: () => void;
};

const fields = new Set<Committable>();

/** Registers a field; the returned function takes it away again. */
export function registerCommittable(field: Committable): () => void {
  fields.add(field);
  return () => { fields.delete(field); };
}

/** The focused field, if it registered, commits now and the screen is up to
 *  date before this returns, so the save that follows reads the new draft. */
export function commitFocusedField(): void {
  const focused = document.activeElement;
  if (!focused) return;
  for (const field of [...fields]) if (field.owns(focused)) flushSync(field.commit);
}
