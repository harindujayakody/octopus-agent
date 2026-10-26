import type { CSSProperties } from "react";
import { cn, Tooltip } from "@proxyshard/shardx-ui-kit";
import { labelColor } from "../constants";

/** The Folder a row (or a picker) shows, tinted in the Folder's own color
 *  (owner feedback 5j), no dot and no ring (owner feedback 2026-09-28); a
 *  Folder with no color keeps the plain neutral chip, the weak fill alone.
 *  Reused by ProfileRow's Folder cell and, since owner feedback 5t, the
 *  Move-to-folder list — one look for a Folder everywhere.
 *  Pure (fix round 1, M1): the caller reads the Folder's look (e.g.
 *  `useFolderLook`) and passes `color` in, so `shared/` doesn't reach up
 *  into `entities/profile` for it, the way `TagChip` takes a plain `tag`.
 *  `wholeOnHover`: in a list column sized to its content, a cut name shows
 *  whole in a tooltip (autofit review I1). */
export function FolderChip({ name, color, wholeOnHover = false }: { name: string; color: string | null; wholeOnHover?: boolean }) {
  const text = <span className="truncate">{name}</span>;
  return (
    <span
      data-folder-chip
      data-color={color || undefined}
      style={color ? ({ "--label": labelColor(color) } as CSSProperties) : undefined}
      className={cn(
        "inline-flex max-w-full items-center rounded-chip-sm px-1.5 py-0.5 align-middle text-secondary forced-edge",
        color ? "label-chip" : "bg-bg-weak-50 text-text-sub-600",
      )}
    >
      {wholeOnHover ? <Tooltip content={name} whenTruncated warm={false}>{text}</Tooltip> : text}
    </span>
  );
}
