import { useLayoutEffect } from "react";

/// Marks a list that scrolls sideways inside its card (owner decision
/// 2026-09-26): `data-x-scrolled` while it is scrolled away from its start
/// (columns pass under the select box and Name; app.css draws their edge
/// shadow), `data-x-more` while columns wait past its right edge (under the
/// row actions, which draw no shadow: owner bug 2026-09-28; tests read it).
/// DOM attributes, not state: a scroll never renders the list. The same
/// `ResizeObserver` on the list also reports its inner width (C13):
/// `onWidth`, when given, decides whether Name can stay pinned
/// (`TableLayout.pinFirst`) — one observer per element, not a second one
/// beside it for the width alone (Task 7 shares this hook).
export function useSideScroll(
  scrollRef: React.RefObject<HTMLElement | null>,
  wrapRef: React.RefObject<HTMLElement | null>,
  onWidth?: (px: number) => void,
) {
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // The room the columns get: a header-carrying list tile insets its rows
    // 4 px on each side (`--list-row-inset`, the kit's tokens.css). Read
    // once, never on a scroll.
    const inset = 2 * (parseFloat(getComputedStyle(el).getPropertyValue("--list-row-inset")) || 0);
    const mark = () => {
      el.toggleAttribute("data-x-scrolled", el.scrollLeft > 0);
      el.toggleAttribute("data-x-more", el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    // A scroll moves what is past the edges, never the width: the width is
    // told on a resize only.
    const resized = () => {
      mark();
      onWidth?.(el.clientWidth - inset);
    };
    el.addEventListener("scroll", mark, { passive: true });
    // The card's width and the columns' width both move what is past its edges.
    const ro = new ResizeObserver(resized);
    ro.observe(el);
    if (wrapRef.current) ro.observe(wrapRef.current);
    resized();
    return () => {
      el.removeEventListener("scroll", mark);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onWidth is a store setter, stable in practice
  }, [scrollRef, wrapRef]);
}
