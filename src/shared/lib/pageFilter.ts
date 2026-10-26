// The page header's filter field, so `/` (a registry command, app.filter) can
// reach it. The header registers how to focus it rather than the field: a
// folded filter (F2) has to unfold before its field can take the keyboard.
let current: (() => void) | null = null;

/** The page header registers its filter's focus; the returned function unregisters it. */
export function setPageFilter(focus: () => void): () => void {
  current = focus;
  return () => { if (current === focus) current = null; };
}

export function hasPageFilter(): boolean {
  return current !== null;
}

/** Puts the keyboard in the page's filter, its text selected. False when the page has none. */
export function focusPageFilter(): boolean {
  if (!current) return false;
  current();
  return true;
}
