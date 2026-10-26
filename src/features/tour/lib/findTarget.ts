import { clientScale } from "@proxyshard/shardx-ui-kit";
import { hasOwn } from "../../../shared/lib/utils";
import { useNav } from "../../../shared/model/navigation";
import type { Section } from "../../../shared/types";

/** How long nothing may load or change before a missing element counts as
 *  not coming (no profiles: no Start button), well before the cap. */
const QUIET_MS = 300;

/** The key of the page's title (its `h1`): a step that points at the page
 *  itself, wherever its own control is not on screen. */
export const PAGE_TITLE = "page-title";

/** The key of a page's item in the sidebar, while the sidebar shows its
 *  names: the tour's beat on a page change lights it. A sidebar folded to its
 *  rail (`data-rail`) has none, and the beat falls back to the page title. */
export const navKey = (section: Section) => `nav:${section}`;

/** Parts of a kit component that takes no `data-tour`, found by what they
 *  are: the profile form's confirm button ("Create profile"), the submit
 *  button of the form that holds the profile form's fields. */
const BY_SHAPE: Record<string, string> = {
  "form-create": 'form:has([data-profile-form]) button[type="submit"]',
};

/** The selector a key stands for. Most keys are `data-tour` keys; the page
 *  title, a sidebar item and a few parts of the kit are found by what they
 *  are. The title is the current page's: the page that was left may still be
 *  in the document for a moment, with a title of its own. */
function selectorOf(key: string): string {
  if (hasOwn(BY_SHAPE, key)) return BY_SHAPE[key];
  if (key === PAGE_TITLE) return `main[data-section="${CSS.escape(useNav.getState().section)}"] [data-page-title]`;
  if (key.startsWith("nav:")) return `aside:not([data-rail]) [data-nav="${CSS.escape(key.slice(4))}"]`;
  return `[data-tour="${CSS.escape(key)}"]`;
}

/** The element a step points at (`[data-tour="key"]`, or the page title or a
 *  sidebar item by their own keys) that a person can see, with a box of its
 *  own. Never the loading header of a page whose code is still on its way,
 *  and never a part that is shut: inert (a fold, a closed panel, a surface on
 *  its way out), `aria-hidden`, `visibility: hidden` or `display: none`. A
 *  shut part still reports its full box, so the box alone would put the
 *  cut-out on nothing. */
export function lookupTarget(key: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selectorOf(key))) {
    if (el.closest('[data-page-loading], [inert], [aria-hidden="true"]')) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return el;
  }
  return null;
}

/** The page is still on its way: its code, its first rows, a list that says it is busy. */
const loading = () => document.querySelector('[data-page-loading], main [data-loading], main [aria-busy="true"]') !== null;

/** Scrolls `el` to the middle of every scrolling box it sits in that does
 *  not show all of it, the innermost first. Boxes that clip without
 *  scrolling (`overflow: hidden`, the app's frame) are left alone: moving
 *  them would shift the window's layout. At once, never smoothly: the
 *  cut-out lands where the element ends up. */
function reveal(el: HTMLElement) {
  for (let box = el.parentElement; box; box = box.parentElement) {
    const style = getComputedStyle(box);
    const scrollsY = /auto|scroll/.test(style.overflowY) && box.scrollHeight > box.clientHeight;
    const scrollsX = /auto|scroll/.test(style.overflowX) && box.scrollWidth > box.clientWidth;
    if (!scrollsY && !scrollsX) continue;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    // Client rects; scroll offsets are layout px (Interface size is CSS zoom).
    const k = clientScale();
    const top = scrollsY && (r.top < b.top || r.bottom > b.bottom) ? (r.top + r.height / 2 - (b.top + b.height / 2)) / k : 0;
    const left = scrollsX && (r.left < b.left || r.right > b.right) ? (r.left + r.width / 2 - (b.left + b.width / 2)) / k : 0;
    if (top || left) box.scrollBy({ top, left, behavior: "instant" });
  }
}

/** The next frame, or a moment later in a window that paints no frames (hidden). */
const nextFrame = () => new Promise<void>((resolve) => {
  const done = () => { clearTimeout(timer); resolve(); };
  const timer = setTimeout(done, 100);
  requestAnimationFrame(done);
});

/**
 * The element a tour step points at (`lookupTarget`), scrolled into
 * view. Waits for it while its page loads (a lazy page's code, its first
 * rows), up to `timeoutMs`; resolves null once the page has settled without
 * it (nothing loading, nothing changing for a moment) or at the cap. The
 * step then shows its card centred, with its picture. `signal` stops the
 * wait: it resolves null at once, and the page is not scrolled for a lookup
 * nobody wants any more.
 */
export function findTarget(key: string, timeoutMs = 2000, signal?: AbortSignal): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(null); return; }
    let done = false;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const finish = (el: HTMLElement | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(cap);
      clearTimeout(quiet);
      signal?.removeEventListener("abort", cancel);
      if (!el || signal?.aborted) { resolve(null); return; }
      reveal(el);
      // One frame for the scroll to land before the cut-out is measured.
      void nextFrame().then(() => resolve(el.isConnected ? el : null));
    };
    const check = () => {
      const el = lookupTarget(key);
      if (el) { finish(el); return; }
      clearTimeout(quiet);
      if (!loading()) quiet = setTimeout(() => finish(lookupTarget(key)), QUIET_MS);
    };
    const cancel = () => finish(null);
    signal?.addEventListener("abort", cancel, { once: true });
    const observer = new MutationObserver(check);
    const cap = setTimeout(() => finish(lookupTarget(key)), timeoutMs);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // `inert` and `aria-hidden` too: a dialog that is closing frees the page (#root), a fold opens.
      attributeFilter: ["data-tour", "data-page-loading", "data-loading", "aria-busy", "hidden", "class", "style", "inert", "aria-hidden"],
    });
    check();
  });
}
