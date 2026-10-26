import type { ReactNode } from "react";
import { cn } from "@proxyshard/shardx-ui-kit";
import { ChevronRightIcon } from "../icons";

/// A section heading that folds what it heads: the small muted section label
/// in sentence case (`text-section-label`: "Pinned", "Folders"; owner,
/// 2026-10-01: "more like in premium products"), the label first and the
/// chevron after it, turning down while open, as Linear draws its
/// disclosure. The chevron always shows (owner, 2026-10-01: "dont hide
/// chevrones"). The sidebar's groups and the sections on top of the Profiles list use it, so
/// both look the same (owner, 2026-10-01). `after` sits between the label
/// and the chevron (a folded section's count).
///
/// The caller's row sets the height; `self-stretch` makes the whole row
/// height the hit area, not just the text's line box.
export function FoldHeading({ label, labelId, open, controls, onToggle, after, className }: {
  label: string;
  labelId?: string;
  open: boolean;
  /** The id of what it folds. */
  controls: string;
  onToggle: () => void;
  after?: ReactNode;
  className?: string;
}) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- a heading that folds its section; the kit Button's type role would replace the section label
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      data-fold-heading
      className={cn("flex min-w-0 items-center gap-1.5 self-stretch rounded-chip-sm text-section-label text-text-soft-400 hover:text-text-sub-600 focus-ring-inset", className)}
    >
      <span id={labelId}>{label}</span>
      {after}
      <ChevronRightIcon aria-hidden="true" data-fold-chevron className={cn("size-3.5 shrink-0 transition-transform duration-(--motion-base) ease-out reduced:transition-none", open && "rotate-90")} />
    </button>
  );
}
