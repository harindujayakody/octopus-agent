import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Button, Portal, Toast, cn, lastInput, layoutRect, layoutViewport, pageZoom, usePresence, type ToastStatus,
} from "@proxyshard/shardx-ui-kit";
import { toast, frontOf, useToastReach, useToastStore } from "../../shared/model/toast";
import { announce } from "../../shared/model/announce";
import { clip } from "../../shared/lib/clipboard";
import { keyboardIsTaken } from "../../shared/lib/keyboard";
import { matchesChord, parseChord } from "../../shared/commands";
import { useNav } from "../../shared/model/navigation";
import { useProfileUi } from "../../entities/profile";
import { useProxy } from "../../entities/proxy";
import { useT } from "../../shared/i18n";
import type { ToastItem } from "../../shared/types";
import { useGlide } from "./useGlide";

const STATUS: Record<ToastItem["kind"], ToastStatus> = {
  ok: "success",
  err: "error",
  info: "information",
  warn: "warning",
  progress: "progress",
};

/** The Undo toast's key. */
const UNDO = parseChord("Mod+Z");

/** Space between the stack and what it keeps clear of. */
const GAP = 12;
/** The stack's widest (Pair 14: sized by its widest toast, 280 to 420 px). */
const MAX_WIDTH = 420;

/** Where the stack sits and how wide it may grow, in layout px; `below`:
 *  under the overlay layer, while a menu or popover it would cover is open;
 *  `reach`: how far up from the list column's bottom edge its top is, at its
 *  place over the list (0 on a page without a list). */
type Spot = { left: number; bottom: number; width: number; below: boolean; reach: number };

/** The dialog on top, unless it is already leaving. */
function openDialog(): HTMLElement | null {
  const panels = [...document.querySelectorAll<HTMLElement>("[aria-modal='true']")].filter((el) => !el.closest("[data-ending-style]"));
  return panels.at(-1) ?? null;
}

/** Open menus, popovers and listboxes (portaled, not modal), unless leaving. */
function openSurfaces(): HTMLElement[] {
  const root = document.getElementById("root");
  return [...document.querySelectorAll<HTMLElement>("[role='menu'], [role='listbox'], [role='dialog']:not([aria-modal='true'])")]
    .filter((el) => !root?.contains(el) && !el.closest("[data-ending-style]"));
}

/** Where the stack sits, in layout px (the Interface size zooms the page):
 *  bottom-center of the list column (`[data-toast-anchor]`, left of Peek,
 *  which pushes the list), 12 px above its bulk bar when one shows, else
 *  12 px above the column's bottom edge; on a page without a list, bottom-
 *  center of `main` (ruling 11, F2). A
 *  dialog's footer is never covered: over a dialog the stack moves just under
 *  it, else just over it, else to the top of the window, where a tall dialog
 *  has its title, not its buttons. A menu or popover it would cover (the
 *  bar's Tags and More open up into it) goes on top instead: the stack stays
 *  where it is and slips under the overlay layer while that one is open
 *  (Pair 14 review), unless a dialog is open over them (Pair 17 review). */
function place(stack: HTMLElement | null): Spot {
  const view = layoutViewport(pageZoom());
  const anchorEl = document.querySelector<HTMLElement>("[data-toast-anchor]");
  const anchor = anchorEl ? layoutRect(anchorEl) : null;
  let left: number;
  let bottom: number;
  let width = MAX_WIDTH;
  let lift: number | null = null;
  if (anchor && anchor.width > 0) {
    // The list's visible bottom edge; above the bar when one shows. The
    // bar's own height, not its box (it may be mid-rise).
    const bar = document.querySelector<HTMLElement>("[data-bulk-bar]");
    lift = bar ? GAP + bar.offsetHeight + GAP : GAP;
    left = anchor.left + anchor.width / 2;
    bottom = view.height - anchor.bottom + lift;
    width = Math.min(MAX_WIDTH, anchor.width - 16);
  } else {
    const main = document.querySelector("main");
    const column = main ? layoutRect(main) : null;
    left = column ? column.left + column.width / 2 : view.width / 2;
    bottom = GAP + GAP;
  }
  const { width: w, height } = stack ? layoutRect(stack) : { width: 0, height: 0 };
  // Measured at its place over the list: a dialog moves it only for a while.
  const reach = lift === null ? 0 : lift + height;
  const dialog = openDialog();
  if (dialog) {
    const d = layoutRect(dialog);
    const top = view.height - bottom - height;
    const across = left - w / 2 < d.right && left + w / 2 > d.left;
    const over = top < d.bottom + GAP && view.height - bottom > d.top - GAP;
    if (height > 0 && across && over) {
      if (view.height - d.bottom - GAP - height >= GAP) bottom = view.height - d.bottom - GAP - height;
      else if (d.top - GAP - height >= GAP) bottom = view.height - d.top + GAP;
      else bottom = view.height - GAP - height;
    }
  }
  // Within GAP counts: a surface still scaling in is a little smaller. A
  // modal outranks the surfaces under it: with one open the stack stays on
  // the toast layer, above its backdrop, or it would sit dimmed and out of
  // reach under it (Pair 17 review).
  const box = { left: left - w / 2 - GAP, right: left + w / 2 + GAP, top: view.height - bottom - height - GAP, bottom: view.height - bottom + GAP };
  const below = !dialog && height > 0 && openSurfaces().some((el) => {
    const r = layoutRect(el);
    const across = Math.min(r.right, box.right) - Math.max(r.left, box.left);
    const down = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
    return across > 0 && down > 0;
  });
  return { left, bottom, width, below, reach };
}

const sameSpot = (a: Spot, b: Spot) =>
  Math.abs(a.left - b.left) < 0.5 && Math.abs(a.bottom - b.bottom) < 0.5 && Math.abs(a.width - b.width) < 0.5 &&
  a.below === b.below && Math.abs(a.reach - b.reach) < 0.5;

/** Keeps `place` current: a bulk bar showing or going, Peek opening or
 *  closing (the list column's visible part changes), the page, the window or
 *  the stack resizing, a dialog, menu or popover opening, closing, growing or moving. */
function useAnchor(stack: React.RefObject<HTMLElement | null>, key: string) {
  const profileBar = useProfileUi((s) => s.selected.size > 0);
  const proxyBar = useProxy((s) => s.proxySel.size > 0);
  const profilePeek = useProfileUi((s) => s.peekId);
  const proxyPeek = useProxy((s) => s.peekId);
  const section = useNav((s) => s.section);
  const [at, setAt] = useState<Spot>(() => ({ left: window.innerWidth / 2, bottom: GAP + GAP, width: MAX_WIDTH, below: false, reach: 0 }));
  useLayoutEffect(() => {
    // The open dialog, menus and popovers: they can grow (a filtered list).
    let watched: HTMLElement[] = [];
    const measure = () => {
      const next = place(stack.current);
      setAt((was) => (sameSpot(was, next) ? was : next));
      const open = [openDialog(), ...openSurfaces()].filter((el): el is HTMLElement => el !== null);
      const same = open.length === watched.length && open.every((el) => watched.includes(el));
      for (const el of watched) if (!open.includes(el)) sizes.unobserve(el);
      for (const el of open) if (!watched.includes(el)) sizes.observe(el);
      if (!same) {
        moves.disconnect();
        for (const el of open) moves.observe(el, { attributes: true, attributeFilter: ["style"] });
      }
      watched = open;
    };
    const sizes = new ResizeObserver(measure);
    // A popover that shrinks is placed again after its resize is seen (its
    // left and top): without this the stack judged it where it no longer was.
    const moves = new MutationObserver(measure);
    const main = document.querySelector("main");
    if (main) sizes.observe(main);
    if (stack.current) sizes.observe(stack.current);
    // The list column's visible part: Peek opening beside it or over it.
    const anchor = document.querySelector("[data-toast-anchor]");
    if (anchor) sizes.observe(anchor);
    // Dialogs, menus and popovers mount in portals, straight under <body>;
    // the bulk bar mounts and unmounts (after its exit) straight under the
    // list column.
    const mounts = new MutationObserver(measure);
    mounts.observe(document.body, { childList: true });
    const column = document.querySelector("[data-list-column]");
    if (column) mounts.observe(column, { childList: true });
    window.addEventListener("resize", measure);
    measure();
    return () => { window.removeEventListener("resize", measure); sizes.disconnect(); mounts.disconnect(); moves.disconnect(); };
  }, [stack, profileBar, proxyBar, profilePeek, proxyPeek, section, key]);
  return at;
}

/// The global toast stack: the kit `Toast` fed by the toast store (Tasks 23,
/// 24). It sits at the bottom center of the list column; a toast rises in
/// from the bottom edge and drops back out the same way, on the kit's motion
/// tokens, and the others glide to their new place. At most three show, and
/// a line counts the ones waiting. Every toast is announced once through the
/// app's live regions: successes politely, errors assertively (A11Y-05).
/// Timers wait while the pointer or the keyboard is on the stack and while
/// the window is hidden or in the background (EMIL-17). Cmd/Ctrl+Z runs the
/// newest Undo unless a text field wants it for its own undo.
export function ToastHost() {
  const t = useT();
  const items = useToastStore((s) => s.items);
  const pause = useToastStore((s) => s.pause);
  const resume = useToastStore((s) => s.resume);
  const stackRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const cameFrom = useRef<HTMLElement | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);

  const live = items.filter((i) => !i.leaving);
  // The same three the store runs timers for.
  const front = new Set(frontOf(live).map((i) => i.id));
  const waiting = live.length - front.size;
  const key = items.map((i) => (i.leaving ? `${i.id}-` : front.has(i.id) ? `${i.id}` : `${i.id}w`)).join(",");
  const at = useAnchor(stackRef, key);
  useGlide(listRef, key);

  // While an error or a warning (8 s, the longest) shows over the list, the
  // list keeps room at its end for the stack and GAP of air, so its last rows
  // can scroll clear of it (Pair 14 review). The shorter toasts take none:
  // nothing moves.
  const lasting = live.some((i) => (i.kind === "err" || i.kind === "warn") && front.has(i.id));
  const reach = lasting && at.reach > 0 ? Math.ceil(at.reach + GAP) : 0;
  useLayoutEffect(() => { useToastReach.setState({ px: reach }); }, [reach]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // By the Z key's place too: Cmd+"я" on a Russian layout undoes (A11Y-02).
      if (!matchesChord(e, UNDO)) return;
      if (keyboardIsTaken(e.target)) return;
      if (useToastStore.getState().undoLatest()) e.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Timers wait while the window is hidden or in the background (EMIL-17).
  useEffect(() => {
    const onVisibility = () => (document.hidden ? pause("hidden") : resume("hidden"));
    const onBlur = () => pause("blur");
    const onFocus = () => resume("blur");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [pause, resume]);

  // A toast removed from under the pointer sends no leave: the first move
  // outside the stack ends the pointer hold.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      if (!listRef.current?.contains(e.target as Node | null)) resume("pointer");
    };
    document.addEventListener("pointermove", onMove, { capture: true, passive: true });
    return () => document.removeEventListener("pointermove", onMove, { capture: true });
  }, [resume]);

  // After every change, a hold whose pointer or focus is no longer on the
  // stack ends, or no timer would run again. Hover settles a frame after a
  // removal, so the pointer is checked then, at its last known place.
  useEffect(() => {
    if (!listRef.current?.contains(document.activeElement)) resume("focus");
    const frame = requestAnimationFrame(() => {
      const p = pointer.current;
      const under = p ? document.elementFromPoint(p.x, p.y) : null;
      if (!under || !listRef.current?.contains(under)) resume("pointer");
    });
    return () => cancelAnimationFrame(frame);
  }, [items, resume]);

  // Each toast is said once; a progress toast when it starts and when it
  // ends, a repeat again.
  const said = useRef(new Map<number, string>());
  useEffect(() => {
    const next = new Map<number, string>();
    for (const i of items) {
      if (i.leaving) continue;
      const key = i.kind === "progress" ? "progress" : `${i.kind}:${i.raised}`;
      next.set(i.id, key);
      if (said.current.get(i.id) === key) continue;
      const words = i.detail ? `${i.title}${/[.!?。！？]$/.test(i.title) ? " " : ". "}${i.detail}` : i.title;
      // A warning differs from the others only by its icon and color, and
      // the icon is hidden from screen readers: the announcement says the
      // word first. The visible title stays the message (G7a review, I1).
      const text = i.kind === "warn" ? t("toast.warningAnnounce", { text: words }) : words;
      announce(text, i.kind === "err" ? "assertive" : "polite");
    }
    said.current = next;
  }, [items, t]);

  // A toast dismissed from the keyboard hands focus to the next one, or back
  // to where it was before the stack took it (PC-066, A11Y-04).
  const focusAfter = (id: number) => {
    const list = listRef.current;
    if (!list || !list.contains(document.activeElement)) return;
    const rows = [...list.querySelectorAll<HTMLElement>("[data-toast]:not([data-ending-style])")];
    const index = rows.findIndex((r) => r.dataset.toast === String(id));
    const next = rows[index - 1] ?? rows[index + 1];
    const target = next?.querySelector<HTMLElement>("button[aria-label]") ?? cameFrom.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
  };

  // In a portal, outside #root: a dialog makes the page inert, and the
  // stack (an Undo, an error's Copy) stays live over it (C20b). Where it sits
  // still follows the list column's anchor (`place`).
  return (
    <Portal>
    <section
      ref={stackRef}
      aria-label={t("toast.region")}
      // A press on a toast (its X, its Undo) never closes the menu or
      // popover the person has open (kit useDismiss, OVERLAY_BRANCH); its
      // action does (OVERLAY_OUTSIDE, below).
      data-overlay-branch
      // Sized by its widest toast, from the old toast's 280 px up to 420 px,
      // and never wider than the list column's visible part. Under a menu or
      // popover it would cover, it takes the overlay layer: the stack's
      // portal mounts with the shell, before any menu's, so at the same
      // layer they paint over it.
      className={cn(
        "pointer-events-none fixed flex w-max -translate-x-1/2 flex-col items-stretch",
        at.below ? "z-(--layer-overlay)" : "z-(--layer-toast)",
      )}
      style={{ left: at.left, bottom: at.bottom, minWidth: Math.min(280, at.width), maxWidth: `min(${at.width}px, calc(100vw - 32px))` }}
    >
      {waiting > 0 && (
        <p className="m-0 mb-2 self-center rounded-full bg-bg-raised px-2 py-0.5 text-secondary text-text-sub-600 ring-1 ring-inset ring-stroke-soft-200">
          {t("kit.moreToasts", { n: waiting })}
        </p>
      )}
      <ol
        ref={listRef}
        className="m-0 flex list-none flex-col gap-2 p-0"
        onPointerEnter={() => pause("pointer")}
        onPointerLeave={() => resume("pointer")}
        onFocus={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) cameFrom.current = e.relatedTarget as HTMLElement | null;
          // A click that focuses a toast's button is not a reason to stop
          // every timer; the pointer hold covers the mouse.
          if (lastInput() === "keyboard") pause("focus");
        }}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) resume("focus"); }}
      >
        {items.map((item) => <ToastRow key={item.id} item={item} shown={front.has(item.id)} onGone={focusAfter} />)}
      </ol>
    </section>
    </Portal>
  );
}

function ToastRow({ item, shown, onGone }: { item: ToastItem; shown: boolean; onGone: (id: number) => void }) {
  const t = useT();
  const dismiss = useToastStore((s) => s.dismiss);
  const remove = useToastStore((s) => s.remove);
  // Rises from the edge the stack sits on (the bottom) and drops back out the
  // same way (ruling 11); a toast waiting behind "N more" is not mounted.
  const presence = usePresence(shown && !item.leaving, { maxExitMs: 300 });
  // A dismissed toast leaves the store in the frame its exit ends, so the
  // others glide from where they were, not from a jump.
  useLayoutEffect(() => {
    if (!presence.mounted && item.leaving) remove(item.id);
  }, [presence.mounted, item.leaving, item.id, remove]);
  if (!presence.mounted) return null;
  const close = () => { onGone(item.id); dismiss(item.id); };
  return (
    <li>
      <Toast
        data-toast={item.id}
        // Its words are a value to copy (an error, a name): selectable (WIG-04).
        data-selectable
        {...presence.rootProps}
        className={
          "transition-[opacity,translate] duration-(--motion-slow) ease-out " +
          "data-starting-style:translate-y-(--motion-shift) data-starting-style:opacity-0 " +
          "data-ending-style:translate-y-(--motion-shift) data-ending-style:opacity-0 data-ending-style:duration-(--motion-base)"
        }
        status={STATUS[item.kind]}
        title={item.title}
        detail={item.detail}
        progress={item.progress}
        onDismiss={close}
        onCopyDetail={item.detail ? async () => {
          // The button says "Copied"; a failure is said here and rethrown so it does not.
          try { await clip.write(item.detail!); } catch (e) { toast.fail({ title: t("copyField.failed"), detail: e }); throw e; }
        } : undefined}
        action={item.onUndo || item.action ? (
          // A delete's toast can carry both: its next step, then Undo.
          <span className="inline-flex items-center gap-2">
            {item.action && (
              // An action moves the person on (Assign opens a dialog): like a
              // menu item, what it opens replaces the open menu or popover,
              // which would otherwise stay open behind it (Pair 17 review).
              <Button data-overlay-outside variant="neutral" mode="stroke" size="3xsmall" onClick={() => { if (item.action!.run() !== false) close(); }}>
                {item.action.label}
              </Button>
            )}
            {item.onUndo && (
              <Button variant="neutral" mode="stroke" size="3xsmall" onClick={() => { close(); item.onUndo!(); }}>
                {t("toast.undo")}
              </Button>
            )}
          </span>
        ) : undefined}
      />
    </li>
  );
}
