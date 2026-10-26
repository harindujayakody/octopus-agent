import type { ReactNode } from "react";
import { cn } from "@proxyshard/shardx-ui-kit";
import { useToastReach } from "../model/toast";
import { BULK_BAR_SPACE } from "./BulkBarFrame";

/** The room a list keeps at its end, under its last row, and keeps a row
 *  scrolled into view clear of: the bulk bar's while it shows, the toast
 *  stack's while it holds a lasting toast, whichever reaches higher
 *  (LAYOUT-02, A11Y-15, Pair 14 review). 0 when neither shows. */
export function useListEndRoom(barShown: boolean): number {
  const toasts = useToastReach((s) => s.px);
  return Math.max(barShown ? BULK_BAR_SPACE : 0, toasts);
}

/// A list's own column (F2): the box the list, its bulk bar and the toasts
/// belong to, so nothing floating ever sits on Peek beside it (LAYOUT-02).
/// Peek always sits beside the column and takes its room, so the column's
/// whole width is visible: the bar and the toasts center on it.
export function ListColumn({ children, className }: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-list-column className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", className)}>
      {children}
      {/* What the toasts line up with: the list's bottom edge. */}
      <div data-toast-anchor aria-hidden="true" className="pointer-events-none absolute right-0 bottom-0 left-0 h-0" />
    </div>
  );
}
