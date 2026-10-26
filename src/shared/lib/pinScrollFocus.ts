/** Controls inside a list's pinned parts: always in view, never padded clear. */
const PINNED = ".list-pin-check *, .list-pin-end *, [data-pin-first] .list-pin-name *";

let marked: Element | null = null;

/** Marks the list `focused` sits in when it is a control in a part that scrolls. */
function mark(focused: EventTarget | null) {
  const el = focused instanceof Element ? focused : null;
  const list = el && !el.matches(PINNED) ? el.parentElement?.closest(".list-pin-scroll") ?? null : null;
  if (list === marked) return;
  marked?.removeAttribute("data-focus-scrolls");
  list?.setAttribute("data-focus-scrolls", "");
  marked = list;
}

/// Focus not obscured (WCAG 2.4.11, app.css `.list-pin-scroll`): a list that
/// scrolls sideways pads a focused control clear of its pinned parts only
/// while focus is on a control in a part that scrolls. The list carries
/// `data-focus-scrolls` then, set as focus moves, before the browser brings
/// the control into view. A `:has(:focus…)` rule said the same, but it made
/// the browser restyle the list for every row a scroll added or took away.
export function installPinScrollFocus(): void {
  document.addEventListener("focusin", (e) => mark(e.target), true);
  document.addEventListener("focusout", (e) => mark(e.relatedTarget), true);
}
