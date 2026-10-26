/// The four regions F6 moves between (A11Y-14, ruling 18), in page order: the
/// sidebar, the page header, the content, and Peek when it is open. Each is
/// entered at its natural place, the first of its places that is drawn: the
/// sidebar at its one Tab stop; the header at its filter, else its first
/// control; the content at the list's active row or Tab stop, else its first
/// control; Peek at its first control.
const CONTROL = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex='0']";
const ENTRY: Record<string, readonly string[]> = {
  sidebar: ["[tabindex='0']"],
  header: ["[role='searchbox']", CONTROL],
  content: [
    "[role='row'][data-active]",
    ":is([role='row'], [data-row-id])[tabindex='0']",
    CONTROL,
  ],
  peek: [CONTROL],
};

const drawn = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[inert]");

function entryOf(region: HTMLElement): HTMLElement | null {
  for (const selector of ENTRY[region.dataset.region ?? ""] ?? [CONTROL]) {
    const hit = [...region.querySelectorAll<HTMLElement>(selector)].find(drawn);
    if (hit) return hit;
  }
  return null;
}

/** Moves the keyboard to the next region (`1`) or the one before (`-1`), around the end. */
export function cycleRegion(step: 1 | -1): void {
  const regions = [...document.querySelectorAll<HTMLElement>("[data-region]")].filter(drawn);
  if (regions.length === 0) return;
  // The innermost region holding the keyboard: Peek sits inside the content.
  let at = -1;
  regions.forEach((r, i) => { if (r.contains(document.activeElement)) at = i; });
  // From nowhere (the page itself), F6 starts at the first region, Shift+F6 at the last.
  const next = regions[at < 0 ? (step > 0 ? 0 : regions.length - 1) : (at + step + regions.length) % regions.length];
  const entry = entryOf(next);
  if (entry) {
    entry.focus();
    return;
  }
  // Nothing to stop at: the region itself takes the keyboard until it lets go.
  next.tabIndex = -1;
  next.addEventListener("blur", () => next.removeAttribute("tabindex"), { once: true });
  next.focus();
}
