import { useCallback, useEffect } from "react";
import { useProfileUi } from "../../entities/profile";
import { dispatchListKey } from "../../features/commands";
import { isContextMenuKey, keyboardIsTaken, openContextMenuFromKeys, overlayHasKeyboard } from "../../shared/lib/keyboard";
import { focusProfileRow as focusRow } from "../../shared/lib/focusRow";

/// The Profiles list keyboard (spec: keyboard map). The list keys belong to
/// the grid: they act only while the keyboard is in it, so a key pressed on a
/// sidebar button or a header control never reaches a row (A11Y-02, WCAG
/// 2.1.4 "active only on focus"). Page-wide stay Esc (Peek, then the
/// selection) and the arrows from the page itself, which step into the list;
/// C (new profile) is an app key now (`useAppKeys`). The list's actions come
/// from the registry (`dispatchListKey`): the selection, else the active row.
/// Nothing reacts while a field, dialog, menu or list box has the keyboard.
export function useProfileListKeys({ scrollToId }: { scrollToId: (id: string) => void }): {
  onGridKeyDown: (e: React.KeyboardEvent) => void;
} {
  const move = useCallback((to: number | "first" | "last") => {
    const ui = useProfileUi.getState();
    ui.moveActive(to);
    const id = useProfileUi.getState().activeId;
    if (id) scrollToId(id);
    // An open Peek follows the active row (it saves the one it leaves).
    if (id && ui.peekId && ui.peekId !== id) ui.openPeek(id);
    focusRow(id);
  }, [scrollToId]);

  // Shift+Arrow: the active row moves and the selection follows it (IFACE-05).
  const extend = useCallback((step: 1 | -1) => {
    const ui = useProfileUi.getState();
    ui.extendSelection(step);
    const id = useProfileUi.getState().activeId;
    if (id) scrollToId(id);
    if (id && ui.peekId && ui.peekId !== id) ui.openPeek(id);
    focusRow(id);
  }, [scrollToId]);

  // Page-wide keys.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.isComposing || e.keyCode === 229) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const ui = useProfileUi.getState();

      // Esc closes the innermost thing: an overlay handles its own, then
      // Peek, then the selection. From inside Peek or from the list; an Esc in
      // some other field (the filter) is that field's.
      if (e.key === "Escape") {
        if (overlayHasKeyboard()) return;
        const fromPeekOrList = !!target?.closest("[data-peek]") || !keyboardIsTaken(target);
        if (ui.peekId && fromPeekOrList) {
          e.preventDefault();
          const id = ui.peekId;
          ui.closePeek();
          focusRow(id);
          return;
        }
        if (keyboardIsTaken(target)) return;
        if (ui.selected.size > 0) { e.preventDefault(); ui.clearSelected(); }
        return;
      }

      if (keyboardIsTaken(target) || target?.closest("[data-peek]")) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;

      // Nothing has the keyboard (after a load, or a click on empty space):
      // the arrows step into the list. After a move between pages the
      // keyboard sits on the page's h1 (A11Y-04), not on the body, so that
      // counts as nothing holding it too.
      if (!target || target === document.body || target.matches("[data-page-title]")) {
        const to = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "Home" ? "first" : e.key === "End" ? "last" : null;
        if (to !== null) { e.preventDefault(); move(to); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [move]);

  // The list's own keys, on the grid (its rows and row controls). Moving is
  // the grid's; every action comes from the registry (IFACE gap 1), so a
  // menu, the sheet and this key agree.
  const onGridKeyDown = useCallback((ev: React.KeyboardEvent) => {
    const e = ev.nativeEvent;
    if (e.defaultPrevented || e.altKey || e.isComposing || e.keyCode === 229) return;
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    // The header's own controls (a resize edge, the columns button) keep
    // their keys: none of them acts on a row (owner feature 2026-09-26). The
    // select-all box is not one of these: it keeps the list's keys, like a
    // row checkbox (C6).
    if (target?.closest("[data-list-header] :is([data-col], .list-pin-end)")) return;
    if (keyboardIsTaken(target) || target?.closest("[data-peek]")) return;

    // Shift+F10 or the Menu key on a row (or a control in it): that row's
    // menu, under the row. A held key opens it once.
    if (isContextMenuKey(e)) {
      const rowEl = target?.closest<HTMLElement>("[role='row'][data-profile-id]");
      if (!rowEl) return;
      ev.preventDefault();
      if (!e.repeat) openContextMenuFromKeys(rowEl);
      return;
    }

    if (!e.metaKey && !e.ctrlKey) {
      switch (e.key) {
        case "ArrowDown":
        case "ArrowUp": {
          ev.preventDefault();
          const step = e.key === "ArrowDown" ? 1 : -1;
          if (e.shiftKey) extend(step);
          else move(step);
          return;
        }
        case "Home": ev.preventDefault(); move("first"); return;
        case "End": ev.preventDefault(); move("last"); return;
      }
    }
    // A focused button or link keeps its own Enter and Space.
    if ((e.key === "Enter" || e.key === " ") && target?.closest("button, a, [role='button'], label")) return;
    if (dispatchListKey(e, "profiles")) ev.preventDefault();
  }, [move, extend]);

  return { onGridKeyDown };
}
