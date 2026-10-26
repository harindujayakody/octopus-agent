import { cn, IconButton } from "@proxyshard/shardx-ui-kit";
import { rowActionIcons } from "./rowActionIcons";
import { rowButtonHoverClass } from "./RowHoverActions";
import { rowTint, type RowTone } from "./rowFill";

/// An editable list cell's edit button (owner feature 2026-09-26: "when I
/// hover over editable columns in rows there need to appear button edit").
/// Right after the cell's content (inside a `relative` wrapper round it, the
/// cell an `@container`), never past the cell's end; shown while the pointer is on the cell or the button
/// itself has keyboard focus; on the active row it is a Tab stop. `lead` is
/// the one the row actions carry for the column they float over: it shows
/// with them, so it has no rule of its own. The click stays with the button
/// (no Peek, no selection), as with the row's hover actions.
///
/// Fix round 1 (I1, I2): a hidden own button takes no layout width — the
/// whole thing (fade, backdrop, button) sits in one `position: absolute`
/// wrapper over the cell's own end, out of flow entirely, so the text
/// beside it never reflows or truncates further at rest. The wrapper is
/// collapsed (`w-0 overflow-hidden`), the same technique the row actions'
/// own `lead` uses: the button inside keeps its natural size and stays a
/// real Tab stop even while its wrapper draws nothing (unlike
/// `visibility: hidden`, which a self-referential `:focus-within` can never
/// escape — the button could never be the thing that first reveals itself).
/// It opens on the pointer over this specific cell (`group-hover/cell`) or
/// on focus inside this one wrapper (`focus-within`, scoped to the single
/// button it holds — never the row-wide `:focus-within` the hover actions
/// use, which would show every cell's button after any focus anywhere in
/// the row, and never a `group-has-[:focus-visible]`/`:has()` pair, which
/// Chromium does not reliably make keyboard-focusable). Shown, it overlays
/// a short fade in the row's current fill (the same `rowFill` tone as the
/// row's own hover actions), so nothing shows through a seam.
export function CellEditButton({ label, onEdit, tabIndex, lead = false, tone = "none", decorated = true }: {
  /** "Edit tags for Etsy craft shop", or "Add …" for an empty cell. */
  label: string;
  onEdit: () => void;
  /** 0 on the active row only (the rows' roving tab order). */
  tabIndex: number;
  lead?: boolean;
  /** The row's own fill (`rowFill`), so the fade behind an own button never
   *  shows a seam against the row: the target, the Peek row, a selected row
   *  or a selected target (E13). Unused for `lead`: the row actions strip it
   *  rides in already paints this tone for the whole strip. */
  tone?: RowTone;
  /** False leaves out the fade and the fill behind the button until its row
   *  is engaged (ProfileRow): they show only on hover or focus, and the
   *  button itself stays, named and reachable, as before. */
  decorated?: boolean;
}) {
  const Icon = rowActionIcons.editField;
  const tint = rowTint(tone);
  const onClick = (e: React.MouseEvent) => { e.stopPropagation(); if (e.detail > 1) return; onEdit(); };
  const onDoubleClick = (e: React.MouseEvent) => e.stopPropagation();
  if (lead) {
    return (
      <IconButton
        variant="neutral"
        mode="ghost"
        size="3xsmall"
        tabIndex={tabIndex}
        className={cn("shrink-0 pointer-events-auto", rowButtonHoverClass)}
        icon={<Icon className="size-3.5" />}
        label={label}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      />
    );
  }
  return (
    <span
      className={cn(
        // Where the content ends, or 38 px before the cell's end when it fills the cell.
        "pointer-events-none absolute inset-y-0 left-[min(100%,calc(100cqw_-_38px))] flex w-0 shrink-0 items-center overflow-hidden",
        // Shown, it is the 14 px fade and the 24 px button: 38 px (`w-[38px]`).
        "group-hover/cell:w-[38px] group-hover/cell:overflow-visible group-hover/cell:pointer-events-auto",
        "focus-within:w-[38px] focus-within:overflow-visible focus-within:pointer-events-auto",
      )}
    >
      {/* The fade: opaque white as its own base layer, then the row's own
          tint, so a selected or keyboard-active row's fill is never a
          see-through wash over whatever the fade sits on. */}
      {decorated && (
        <span aria-hidden className="relative h-full w-[14px] shrink-0">
          <span className={cn("absolute inset-0 bg-gradient-to-r from-transparent", tint.fadeTo)} />
          <span className={cn("absolute inset-0 bg-gradient-to-r from-transparent", tint.fades[0])} />
          <span className={cn("absolute inset-0 bg-gradient-to-r from-transparent", tint.fades[1])} />
        </span>
      )}
      <span className="relative flex h-full items-center">
        {decorated && <span aria-hidden className={cn("absolute inset-0", tint.base)} />}
        {decorated && <span aria-hidden className={cn("absolute inset-0", tint.fill)} />}
        <IconButton
          variant="neutral"
          mode="ghost"
          size="3xsmall"
          tabIndex={tabIndex}
          className={cn("relative shrink-0", rowButtonHoverClass)}
          icon={<Icon className="size-3.5" />}
          label={label}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
        />
      </span>
    </span>
  );
}
