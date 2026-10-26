type RowFocus = {
  /** Only when focus has nowhere else to be. */
  ifLost?: boolean;
  /** With no row given, the list's Tab stop (its first row when none is active). */
  orTabbable?: boolean;
};

/** Puts the keyboard on a profile row once it is rendered. With `ifLost`, only
 *  when focus has nowhere else to be: on the page itself, or still inside that
 *  row. A press elsewhere (the filter, another row) keeps its focus. */
export function focusProfileRow(id: string | null, opts: RowFocus = {}) {
  focusListRow("data-profile-id", id, opts);
}

/** Fix round 1 (I4): a cell editor (the Folder menu, the tag or proxy
 *  picker, an inline note) returns the keyboard to that cell's own edit
 *  button on close, once it is rendered — never `document.body`, the way a
 *  `visibility: hidden` button (fix round 1, I1) once left it. If the cell
 *  or its button is gone (the row left the current view, say), falls back
 *  to the row itself, else the list, the same as `focusProfileRow`. */
export function focusCellButton(cellRef: { current: HTMLElement | null } | undefined, id: string | null) {
  requestAnimationFrame(() => {
    // Focus that moved on meanwhile keeps its place: Cmd+K pressed right
    // after Esc opened the palette, or a press on the filter closed the
    // editor (post merge point 5: the frame after the tag picker's Esc took
    // the palette's field). Only focus with nowhere else to be comes back:
    // on the page, in the row, or in the editor that is leaving.
    const now = document.activeElement;
    const row = cellRef?.current?.closest("[role='row']");
    if (now && now !== document.body && !row?.contains(now) && !now.closest("[inert], [data-ending-style]")) return;
    const btn = cellRef?.current?.querySelector<HTMLButtonElement>("button");
    if (btn) { btn.focus({ preventScroll: true }); return; }
    focusProfileRow(id, { ifLost: true });
  });
}

/** `focusProfileRow` for a row of the Proxies list. */
export function focusProxyRow(id: string | null, opts: RowFocus = {}) {
  focusListRow("data-proxy-id", id, opts);
}

function focusListRow(attr: string, id: string | null, { ifLost = false, orTabbable = false }: RowFocus) {
  if (!id && !orTabbable) return;
  requestAnimationFrame(() => {
    const row = document.querySelector<HTMLElement>(
      id ? `[role='row'][${attr}="${CSS.escape(id)}"]` : `[role='row'][${attr}][tabindex='0']`,
    );
    if (!row) return;
    const now = document.activeElement;
    // Focus still on a layer that is leaving (inert, ending its exit) is lost
    // already: the browser drops it on the page a frame later, and this frame
    // can come first (the bar's Clear selection from the keyboard).
    if (ifLost && now && now !== document.body && !row.contains(now) && !now.closest("[inert], [data-ending-style]")) return;
    row.focus({ preventScroll: true });
  });
}
