/** How long a scroll box keeps its scrollbar after the last scroll. */
export const SCROLL_IDLE_MS = 700;

const timers = new WeakMap<Element, number>();

function onScroll(e: Event) {
  const el = e.target instanceof Element ? e.target : document.scrollingElement;
  if (!el) return;
  if (!el.hasAttribute("data-scroll-active")) el.setAttribute("data-scroll-active", "");
  window.clearTimeout(timers.get(el));
  timers.set(el, window.setTimeout(() => el.removeAttribute("data-scroll-active"), SCROLL_IDLE_MS));
}

/// Scrollbars show only while a box scrolls (owner, 2026-10-02: "scrollbar
/// need to hide after activity and be a bit thiner"; app.css). One capture
/// listener marks whichever box scrolled with `data-scroll-active` and clears
/// it SCROLL_IDLE_MS after its last scroll: a DOM attribute, not React state,
/// so a scrolling list never re-renders for it. The attribute is set once per
/// gesture, not per scroll event.
export function installScrollActivity(): void {
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
}
