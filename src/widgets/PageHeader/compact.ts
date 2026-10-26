import { useLayoutEffect, type RefObject } from "react";

/// A header too narrow for its actions with their words (a 1024 px window at
/// 150 %, a long title in Russian) lets the words go before the title does.
/// It is measured, not set by a width: what fits depends on the language, the
/// page's own actions and the interface size. Each level is a step further,
/// kept only when the one before does not fit (`data-compact`, drawn by
/// app.css and the title block's own classes):
///   1  the secondary buttons show their icons alone; the title may take 60 %
///   2  so does the last one (the primary); the title takes what it needs
///   3  the count and the info button go too, and only now does the title
///      truncate rather than push the header past its edge
/// Up to level 2 the title never shrinks: only its cap cuts it.

/** A long title cut to this many px still reads: its actions keep their words for it. */
const READABLE = 240;
const LAST = 3;

/** A kit Button with an icon and a label (its two first spans): its label can give way. */
function labelled(b: HTMLElement): boolean {
  const [icon, label] = b.children;
  return icon?.tagName === "SPAN" && !!icon.querySelector("svg") && label?.tagName === "SPAN" && !!label.textContent?.trim();
}

/** Nothing runs past the header's content edge (the captions' room on Windows and Linux
 *  is its padding), and the title is whole, or long and still readable. */
function fits(header: HTMLElement): boolean {
  const end = header.clientWidth - parseFloat(getComputedStyle(header).paddingRight);
  for (const c of header.children) {
    if (c instanceof HTMLElement && c.offsetLeft + c.offsetWidth > end + 0.5) return false;
  }
  const title = header.querySelector<HTMLElement>("[data-title-block] [data-page-title]");
  return !title || title.scrollWidth <= title.clientWidth + 0.5 || title.clientWidth >= READABLE;
}

function setLevel(header: HTMLElement, level: number) {
  const next = level ? String(level) : undefined;
  if (header.dataset.compact !== next) {
    if (next) header.dataset.compact = next;
    else delete header.dataset.compact;
  }
}

/** Measures `header` as it and its content change, and collapses the labels in `actions` as needed. */
export function useCompactActions(header: RefObject<HTMLElement | null>, actions: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const h = header.current;
    const a = actions.current;
    if (!h || !a) return;
    const run = () => {
      const buttons = [...a.querySelectorAll<HTMLElement>("button")].filter(labelled);
      for (const b of a.querySelectorAll<HTMLElement>("[data-collapse]")) if (!buttons.includes(b)) delete b.dataset.collapse;
      buttons.forEach((b, i) => {
        const v = i === buttons.length - 1 ? "2" : "1";
        if (b.dataset.collapse !== v) b.dataset.collapse = v;
      });
      // From the widest form down: each step is laid out and measured before the next paint.
      let level = 0;
      setLevel(h, 0);
      while (level < LAST && !fits(h)) setLevel(h, ++level);
    };
    run();
    // The header's own size moves with the window and the interface size; what is in it with
    // the language, the page and its state (a count, an open search). Neither sees its own writes.
    const sized = new ResizeObserver(run);
    sized.observe(h);
    const changed = new MutationObserver(run);
    changed.observe(h, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-open"] });
    let live = true;
    void document.fonts?.ready.then(() => { if (live) run(); });
    return () => {
      live = false;
      sized.disconnect();
      changed.disconnect();
    };
  }, [header, actions]);
}
