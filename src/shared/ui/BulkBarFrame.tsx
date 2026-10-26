import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { usePresence } from "@proxyshard/shardx-ui-kit";

/** The space the list keeps under its rows while a bar shows: the bar
 *  (35 px) + its 12 px gap to the column's bottom + the air above it. */
export const BULK_BAR_SPACE = 64;
/** Below this width of visible column, the bar's longer buttons are icons. */
const NARROW = 780;
const MOVE_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

/// The frame of a list's selection bar (F2): it sits at the bottom center of
/// the list's column, left of Peek (IFACE-12), fades and
/// rises in and out (UI-24), moves along its buttons with the arrow keys
/// (A11Y-08, PC-036), and when it closes with focus inside hands focus back.
/// It must sit inside a `ListColumn`, which it is positioned in.
export function BulkBarFrame({ open, label, onClosedWithFocus, children }: {
  open: boolean;
  label: string;
  onClosedWithFocus?: () => void;
  /** The buttons; `narrow` asks for icon-only ones. */
  children: (narrow: boolean) => ReactNode;
}) {
  // Enter 150 ms, exit 100 (ruling 6); the cap only guards a lost transitionend.
  const presence = usePresence(open ? label : null, { maxExitMs: 200 });
  const lane = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  const hadFocus = useRef(false);

  useLayoutEffect(() => {
    const el = lane.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW));
    ro.observe(el);
    setNarrow(el.clientWidth < NARROW);
    return () => ro.disconnect();
  }, [presence.mounted]);

  // Focus inside the bar when it starts to close goes back to the list: the
  // leaving bar is inert, so the browser would drop it on the page (PC-036).
  useLayoutEffect(() => {
    if (open) return;
    if (hadFocus.current) { hadFocus.current = false; onClosedWithFocus?.(); }
  }, [open, onClosedWithFocus]);

  if (!presence.mounted) return null;
  const { ref: presenceRef, ...rootProps } = presence.rootProps;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || !MOVE_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const buttons = [...(bar.current?.querySelectorAll<HTMLElement>("button:not([aria-disabled='true']):not([disabled])") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const to = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1
      : (at + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[to].focus();
  };
  return (
    <div
      ref={lane}
      data-bar-lane
      className="pointer-events-none absolute right-0 bottom-0 left-0 z-(--layer-sticky) flex justify-center"
    >
      <div
        ref={(el) => { bar.current = el; presenceRef(el); }}
        role="toolbar"
        aria-label={presence.value}
        data-bulk-bar
        {...rootProps}
        onFocus={() => { hadFocus.current = true; }}
        // Focus that moves on to something else is gone; focus the page takes
        // (the bar went inert under it) still counts as the bar's.
        onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) hadFocus.current = false; }}
        onKeyDown={onKeyDown}
        // 35 px tall, the old bar's height (owner: nothing grows). Rises over
        // --motion-base, drops a smaller nudge over --motion-fast; reduced
        // motion keeps the fade only (the tokens go to 0 px). A floating
        // layer: the float shadow and the dark top highlight, no ring
        // (borderless, owner 2026-10-01); forced colors keep a system edge.
        className={
          "pointer-events-auto mb-[12px] flex h-[35px] max-w-[calc(100%-24px)] items-center gap-1 whitespace-nowrap rounded-surface bg-bg-raised pr-1.5 pl-3 shadow-(--shadow-float) forced-edge white-surface " +
          "transition-[opacity,translate] duration-(--motion-base) ease-out " +
          "data-starting-style:translate-y-(--motion-shift) data-starting-style:opacity-0 " +
          "data-ending-style:translate-y-(--motion-nudge) data-ending-style:opacity-0 data-ending-style:duration-(--motion-fast)"
        }
      >
        {children(narrow)}
      </div>
    </div>
  );
}
