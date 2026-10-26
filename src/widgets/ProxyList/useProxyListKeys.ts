import { useCallback, useEffect } from "react";
import { useProxy } from "../../entities/proxy";
import { dispatchListKey } from "../../features/commands";
import { isContextMenuKey, keyboardIsTaken, openContextMenuFromKeys, overlayHasKeyboard } from "../../shared/lib/keyboard";
import { focusProxyRow } from "../../shared/lib/focusRow";

/// The Proxies list keyboard, as the Profiles list's: the list keys belong to
/// the grid (A11Y-02); Esc and the arrows from the page itself stay
/// page-wide. The actions come from the registry (`dispatchListKey`): the
/// active row, or the selection where one exists.
export function useProxyListKeys({ scrollToId }: { scrollToId: (id: string) => void }): {
  onGridKeyDown: (e: React.KeyboardEvent) => void;
} {
  const move = useCallback((to: number | "first" | "last") => {
    const store = useProxy.getState();
    store.moveActive(to);
    const id = useProxy.getState().activeId;
    if (id) scrollToId(id);
    if (id && store.peekId && store.peekId !== id) store.openPeek(id);
    focusProxyRow(id);
  }, [scrollToId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.isComposing || e.keyCode === 229) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const store = useProxy.getState();

      // Esc closes Peek (from the list or from inside it), then clears the
      // selection; an overlay or another field keeps its own Esc.
      if (e.key === "Escape") {
        if (overlayHasKeyboard()) return;
        const fromPeekOrList = !!target?.closest("[data-peek]") || !keyboardIsTaken(target);
        if (store.peekId && fromPeekOrList) {
          e.preventDefault();
          const id = store.peekId;
          store.closePeek();
          focusProxyRow(id);
          return;
        }
        if (keyboardIsTaken(target)) return;
        if (store.proxySel.size > 0) { e.preventDefault(); store.clearSelected(); }
        return;
      }

      if (keyboardIsTaken(target) || target?.closest("[data-peek]")) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      // From the page itself the arrows step into the list. After a move
      // between pages the keyboard sits on the page's h1 (A11Y-04), not on
      // the body, so that counts as the page too: without it the arrows do
      // nothing on every page but the one the app opens on.
      if (!target || target === document.body || target.matches("[data-page-title]")) {
        const to = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "Home" ? "first" : e.key === "End" ? "last" : null;
        if (to !== null) { e.preventDefault(); move(to); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [move]);

  // The list's own keys: moving is the grid's; every action comes from the
  // registry (IFACE gap 1), as on Profiles.
  const onGridKeyDown = useCallback((ev: React.KeyboardEvent) => {
    const e = ev.nativeEvent;
    if (e.defaultPrevented || e.altKey || e.isComposing || e.keyCode === 229) return;
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    // The header's own controls keep their keys (owner feature 2026-09-26).
    // The select-all box is not one of these: it keeps the list's keys,
    // like a row checkbox (C6).
    if (target?.closest("[data-list-header] :is([data-col], .list-pin-end)")) return;
    if (keyboardIsTaken(target) || target?.closest("[data-peek]")) return;

    // Shift+F10 or the Menu key on a row: its menu, under the row (as Profiles).
    if (isContextMenuKey(e)) {
      const rowEl = target?.closest<HTMLElement>("[role='row'][data-proxy-id]");
      if (!rowEl) return;
      ev.preventDefault();
      if (!e.repeat) openContextMenuFromKeys(rowEl);
      return;
    }

    // Proxies has no range from the keys: Shift+Arrow moves, as an arrow does.
    if (!e.metaKey && !e.ctrlKey) {
      switch (e.key) {
        case "ArrowDown": ev.preventDefault(); move(1); return;
        case "ArrowUp": ev.preventDefault(); move(-1); return;
        case "Home": ev.preventDefault(); move("first"); return;
        case "End": ev.preventDefault(); move("last"); return;
      }
    }
    // A focused button or link keeps its own Enter and Space.
    if ((e.key === "Enter" || e.key === " ") && target?.closest("button, a, [role='button'], label")) return;
    if (dispatchListKey(e, "proxies")) ev.preventDefault();
  }, [move]);

  return { onGridKeyDown };
}
