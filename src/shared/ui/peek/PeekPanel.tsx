import type { ReactNode } from "react";
import { cn, type Presence } from "@proxyshard/shardx-ui-kit";
import { PEEK_WIDTH_NARROW, usePeekWidth } from "./peekWidth";

/// The one Peek frame (UI-18): always beside the list, never over it, at every
/// window width. It is 420 px wide, or 360 px under 1280 layout px, and the
/// list's column gives it the room. A third panel next to the sidebar and the
/// page (borderless, owner 2026-10-01): the panels' 12 px corner, a raised
/// fill and no border; it rests on a soft shadow and the dark top highlight.
/// It enters and leaves on the same path (FEEL-02, PC-054): the caller keeps
/// it mounted through the exit with `usePresence` and passes it in;
/// `.peek-panel` (app.css) moves it, only opacity and translate. It clips
/// nothing itself: PeekBody clips its own scroll corners, so the header's
/// focus rings reach the panel's edge (Pair 18 review, M4).
export function PeekPanel({ kind, label, presence, tour, children }: {
  kind: "profile" | "proxy" | "fingerprint";
  label: string;
  presence: Presence<unknown>;
  /** The tour's key for this panel (`data-tour`). */
  tour?: string;
  children: ReactNode;
}) {
  const narrow = usePeekWidth() === PEEK_WIDTH_NARROW;
  return (
    <aside
      data-peek={kind}
      // F6 reaches it after the content it sits in (A11Y-14).
      data-region="peek"
      data-tour={tour}
      aria-label={label}
      {...presence.rootProps}
      className={cn(
        // A white surface (light flip), borderless (owner 2026-10-01): what it
        // holds steps to the weak fill, and its shadow is its edge.
        "peek-panel white-surface relative flex min-h-0 shrink-0 flex-col rounded-panel bg-bg-raised shadow-(--shadow-xs)",
        narrow ? "w-[360px]" : "w-[420px]",
      )}
    >
      {children}
    </aside>
  );
}
