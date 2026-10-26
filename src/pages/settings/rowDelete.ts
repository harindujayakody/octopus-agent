import { focusNextIn, pageTitle } from "../../shared/lib/focus";

/// A Settings list row's delete button (Tags, Views) takes its row away: the
/// keyboard goes to the next row's delete, else the one before, else the
/// section's tab once the list is empty (A11Y-04). Read the place before the
/// delete; call what this returns after it.
export function focusAfterRowDelete(button: HTMLElement): () => void {
  const list = button.closest<HTMLElement>("ul");
  const index = list ? [...list.querySelectorAll<HTMLElement>("[data-row-delete]")].indexOf(button) : -1;
  return () => focusNextIn(list, "[data-row-delete]", Math.max(0, index), () =>
    document.querySelector<HTMLElement>("main [role='tab'][aria-selected='true']") ?? pageTitle());
}
