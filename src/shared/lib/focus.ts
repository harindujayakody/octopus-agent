import { useLayoutEffect, useRef, type RefObject } from "react";
import { lastInput } from "@proxyshard/shardx-ui-kit";
import type { Section } from "../types";
import { focusPageFilter } from "./pageFilter";

/// Where the keyboard goes when what held it leaves (A11Y-04, E5): a page
/// change, a removal, Retry, Clear search. From `<body>` the next Tab went to
/// the sidebar's first item, 26 stops from the first row.

/** The keyboard has nowhere to be: on the page itself, or on a node that left the document. */
export function focusIsLost(): boolean {
  const now = document.activeElement;
  return !now || now === document.body || !now.isConnected;
}

/// After the next paint, puts the keyboard on `target()` when it has nowhere to
/// be: on the page itself, or on a node that left the document (A11Y-04: when
/// the trigger no longer exists, focus moves to the nearest logical place).
export function refocusIfLost(target: () => HTMLElement | null | undefined): void {
  requestAnimationFrame(() => {
    if (!focusIsLost()) return;
    target()?.focus();
  });
}

/// A removal in a list of controls: the keyboard goes to the item now at
/// `index` (the one after the removed), else the one before, else `fallback`.
/// Read after the removal has rendered.
export function focusNextIn(container: HTMLElement | null, selector: string, index: number, fallback?: () => HTMLElement | null | undefined): void {
  requestAnimationFrame(() => {
    const items = container?.isConnected ? [...container.querySelectorAll<HTMLElement>(selector)] : [];
    (items[index] ?? items[index - 1] ?? fallback?.() ?? null)?.focus();
  });
}

/** The page's title, which takes focus from code only. */
export const pageTitle = () => document.querySelector<HTMLElement>("main [data-page-title]");

/** A list's Tab stop on the page: a row or a card that holds it. */
export const listStop = () => document.querySelector<HTMLElement>("main :is([role='row'], [data-row-id])[tabindex='0']");

const PAGE_ROWS: Partial<Record<Section, string>> = {
  profiles: "[role='row'][data-profile-id]",
  proxies: "[role='row'][data-proxy-id]",
};

/// Where a page begins for the keyboard (ruling 18): the list's active row on
/// Profiles and Proxies (else its Tab stop, else its first row), else the
/// page title.
export function pageStart(section: Section): HTMLElement | null {
  const rows = PAGE_ROWS[section];
  const row = rows
    ? document.querySelector<HTMLElement>(`main ${rows}[data-active]`)
      ?? document.querySelector<HTMLElement>(`main ${rows}[tabindex='0']`)
      ?? document.querySelector<HTMLElement>(`main ${rows}`)
    : null;
  return row ?? pageTitle();
}

/** Puts the keyboard where the page begins. False while the page has not rendered yet. */
export function focusPageStart(section: Section): boolean {
  const el = pageStart(section);
  if (!el) return false;
  // A row is in view already or kept drawn by its list: no jump.
  el.focus({ preventScroll: el.matches("[role='row']") });
  markPointerFocus(el);
  return true;
}

/// A browser draws `:focus-visible` on a focus a script makes when nothing was
/// focused before, and a click that opened a page leaves nothing focused (a
/// button does not take focus on a click in WebKit): the title then showed
/// its ring though no key was pressed (owner, 2026-10-07). The title keeps
/// the focus, and after the pointer it is marked, so the stylesheet leaves
/// its ring off until it loses the focus; after a key the ring shows.
function markPointerFocus(el: HTMLElement): void {
  if (!el.matches("[data-page-title]")) return;
  if (lastInput() === "keyboard") { delete el.dataset.pointerFocus; return; }
  el.dataset.pointerFocus = "";
  el.addEventListener("blur", () => { delete el.dataset.pointerFocus; }, { once: true });
}

/// Lands the keyboard on a page once it has rendered: a page that loads its
/// code on first use (Trash, Settings) takes a few frames. `force`: the page
/// was asked for from the keyboard (a key, the palette, the sidebar by
/// keyboard); otherwise only when the keyboard has nowhere to be (the
/// control that changed the page left with the old page). Returns a cancel.
export function landOnPage(section: Section, force: boolean): () => void {
  let frames = 0;
  let id = 0;
  const tick = () => {
    if (!force && !focusIsLost()) return;
    if (focusPageStart(section)) return;
    // About a second, then the page has nothing to take the keyboard.
    if (++frames < 60) id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}

/** Clear search: the empty state leaves, so the filter field takes the keyboard (PC-121). */
export function refocusPageFilter(): void {
  refocusIfLost(() => {
    focusPageFilter();
    return null;
  });
}

/// When this part of the page leaves while it holds the keyboard (a checklist
/// put away, an error replaced by its list), the keyboard goes to `target`,
/// read after the next paint. `target` gets the nearest element around the
/// part that is still in the page, to find its place from (a dialog, Peek,
/// the page). A layout effect: its cleanup runs before the part leaves the
/// document, while it can still tell whether it held the keyboard.
export function useFocusHandOff(ref: RefObject<HTMLElement | null>, target: (from: HTMLElement | null) => HTMLElement | null | undefined): void {
  const to = useRef(target);
  to.current = target;
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (!el || !el.contains(document.activeElement)) return;
      const around: HTMLElement[] = [];
      for (let p = el.parentElement; p; p = p.parentElement) around.push(p);
      refocusIfLost(() => to.current(around.find((p) => p.isConnected) ?? null));
    };
  }, [ref]);
}
