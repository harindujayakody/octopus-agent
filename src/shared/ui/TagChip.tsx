import type { CSSProperties, ReactNode } from "react";
import { Tooltip } from "@proxyshard/shardx-ui-kit";
import { labelColor } from "../constants";

/// A tag as a small chip: the whole chip tinted in its label color (owner
/// feedback 5j), no dot and no ring (owner feedback 2026-09-28). `action` is
/// an optional control at its end (Remove in Peek), which follows the chip's
/// own text color via `.label-chip`. `wholeOnHover`: what a tooltip shows
/// while the name is cut, in a list column sized to its content (autofit
/// review I1: the row's tags, all of them).
export function TagChip({ tag, action, wholeOnHover }: { tag: { id: string; name: string; color: string }; action?: ReactNode; wholeOnHover?: string }) {
  const text = <span className="truncate">{tag.name}</span>;
  return (
    <span
      data-tag={tag.id}
      data-color={tag.color}
      style={{ "--label": labelColor(tag.color) } as CSSProperties}
      className="label-chip inline-flex min-w-0 max-w-full shrink items-center gap-1 rounded-chip-sm px-1.5 py-0.5 align-middle text-secondary forced-edge"
    >
      {wholeOnHover ? <Tooltip content={wholeOnHover} whenTruncated warm={false}>{text}</Tooltip> : text}
      {action}
    </span>
  );
}
