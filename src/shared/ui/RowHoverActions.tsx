import type { ReactNode } from "react";
import { cn } from "@proxyshard/shardx-ui-kit";
import { rowTint, type RowTone } from "./rowFill";

/// Owner feedback 5k: "delete has color on hover but the other buttons
/// don't have it at all on hovering". Cause (Phase A): the kit ghost-neutral
/// IconButton's hover fill was the exact color this row's own hover/selected
/// overlay painted underneath it, so the button's hover was invisible on a
/// hovered (or selected) row. Audit Phase B: the fills are the hover and
/// active roles now, and both are translucent, so a button's hover lays
/// `--bg-hover` over whatever the row already painted (its hover, active or
/// selected fill) and always reads; pressed or keyboard-focused, it takes
/// `--bg-active`. No values of its own: the same two roles every list, menu
/// and button uses. The icon goes from the muted icon color to the strong
/// text color with it.
///
/// Fix round 1, finding 5: an app-side override and the kit's own hover are
/// the same selector shape (one class plus `:hover`), so on a single
/// stylesheet with the kit's bare `cn` (no tailwind-merge) whichever rule
/// Tailwind happens to emit later would win. `not-aria-disabled:` adds a
/// second condition, so `.foo:not([aria-disabled=true]):hover` is (0,3,0)
/// against the kit's (0,2,0) `:hover`-only rule and always wins, source order
/// or not. It also means a disabled button (the Test button while a test
/// runs) never shows this hover: kit Buttons are `aria-disabled`, never
/// `:disabled`, since audit Phase C (C9), so `enabled:` no longer tells.
///
/// Pressed is different: since C9 the kit's ghost neutral has its own
/// `not-aria-disabled:active:bg-bg-active`, the same (0,3,0) as the rules
/// here, so a tie would again go to emit order. The neutral pressed fill asks
/// for the kit's own value, so the tie cannot show; the danger button's
/// pressed tint carries `!` (below) and wins outright.
///
/// Audit Phase B: the focus ring is drawn inside (`focus-ring-inset`, which
/// wins over the kit Button's own `focus-ring`): a 24 px button in a 36 px
/// row inside the list's scroll box would have its ring clipped, or cover
/// the next row, under Increase contrast's 3 px.
export const rowButtonHoverClass = cn(
  "not-aria-disabled:hover:bg-bg-hover not-aria-disabled:hover:text-text-strong-950",
  "not-aria-disabled:active:bg-bg-active",
  "focus-visible:bg-bg-hover focus-visible:text-text-strong-950",
  "focus-ring-inset",
);

/// The destructive button (Move to Trash, Proxies Delete) keeps its own
/// difference on the same shape: its icon turns to the error text color and
/// its fill is the error tint (the tint-hover while pressed), never a solid
/// red slab (same `not-aria-disabled:` guard as `rowButtonHoverClass`, for the same
/// reason). Its pressed classes are `!`: the kit's pressed fill ties with
/// them on specificity (see above).
export const rowButtonDangerHoverClass = cn(
  "not-aria-disabled:hover:bg-error-tint not-aria-disabled:hover:text-error-text",
  "not-aria-disabled:active:bg-error-tint-hover! not-aria-disabled:active:text-error-text!",
  "focus-visible:bg-error-tint focus-visible:text-error-text",
  "focus-ring-inset",
);

/// How far the floating strip reaches left of the actions cell, in px, with
/// `buttons` icon buttons and no lead: the 14 px fade (`w-[14px]`), 24 px buttons
/// (`size="3xsmall"`: a 24 px square) 3 px apart (`gap-1`), and the 3 px end pad
/// (`pr-1`). Px, not rem: the spacing scale is px (O1). The Profiles list
/// gives its last column at least this much when the column before it has
/// an edit button, so the strip never covers that button (owner feature
/// 2026-09-26). Change it with those classes.
export const rowActionsCoverPx = (buttons: number) => 14 + buttons * 24 + (buttons - 1) * 3 + 3;

/// A Profiles or Proxies row's whole actions cell: the hover-only icons
/// (Profiles: Pin, Edit, Clone, Move to Trash; Proxies: Edit, Copy address,
/// Delete) float as an overlay over the end of the row (Notes, or the Proxy/
/// Address cell in a narrow layout) — the owner's call: no width reserved
/// for them, at any window size — to the left of the row's fixed actions
/// (Start/Stop, or Test, then More), which this component also renders, so
/// both lists share one show rule and the same left edge (the fixed group's
/// own, via `right-full` on this shared wrapper — not a separate one per
/// list, which previously let the two drift out of alignment on Proxies).
///
/// Shown on the row's own CSS `:hover`, on focus anywhere inside the row
/// while the keys drive (`data-input`: a click's focus shows them only while
/// the pointer is on the row), or while the row's menu is open (right-click or the ⋮ button): the kit menu
/// host marks what its open menu is for with `data-menu-open` (the row, or
/// the ⋮ button inside it), read here with CSS, so opening a menu renders
/// neither the list nor the row (PERF-11). Never for the keyboard-active row
/// alone (no live hover or focus), and never while the row has an inline
/// edit open (`editing`): the overlay is not rendered at all then, so it can
/// never sit over the editor.
/// `persistFixed` is the one list-specific exception, applying to the fixed
/// group only: a running or starting Profiles row keeps Stop in view
/// regardless.
/// The row's menu is open: the row itself was right-clicked, or its ⋮
/// button opened it (both marked by the kit menu host).
const MENU_OPEN_VISIBLE = "group-data-[menu-open]:visible group-has-[[data-menu-open]]:visible";
const MENU_OPEN_OPAQUE = "group-data-[menu-open]:opacity-100 group-has-[[data-menu-open]]:opacity-100";

export function RowHoverActions({ editing, tone = "none", persistFixed, floatFixed, hold, fixed, lead, children }: {
  /** An inline editor (Name or Notes) is open on this row. */
  editing?: boolean;
  /** The row's own fill (`rowFill`), laid over the overlay's opaque base,
   *  so the overlay never cuts a band out of the row's drawn background
   *  (fix round 1, finding 1): the target, the Peek row, a selected row, a
   *  selected target. There is no hover fill (E13, O5): the row under a
   *  moving pointer is the target, so the strip follows the row at rest
   *  and on hover alike (fix round 2, finding 1). */
  tone?: RowTone;
  /** Keeps the fixed group shown regardless of hover/focus/menu. */
  persistFixed?: boolean;
  /** The fixed group floats in the strip too, at its end, over the row's
   *  last column: no track holds it (Proxies, controller ruling, merge
   *  point 3). `persistFixed` does not apply. */
  floatFixed?: boolean;
  /** An action in the strip is running (a proxy's Test): the strip stays in
   *  view after the pointer leaves, so the running action shows it is busy
   *  where it was pressed (C11). Only the click's focus kept it before the
   *  owner's hover fix, which no longer counts that focus. */
  hold?: boolean;
  /** Start/Stop (or Test), then More: never covers another cell, so it
   *  paints no background of its own. */
  fixed: ReactNode;
  /** The edit button of the column these actions float over: first in the
   *  strip, while the pointer is in that column (the row's `data-over-last`)
   *  or focus sits inside it (owner feature 2026-09-26). */
  lead?: ReactNode;
  children: ReactNode;
}) {
  const tint = rowTint(tone);
  return (
    <div className="relative flex h-full items-center justify-end gap-1">
      {!editing && (
        <div
          className={cn(
            "absolute inset-y-0 flex items-center",
            floatFixed ? "right-0" : "right-full",
            // A keyboard-focused row's ring (its inset outline, carried over
            // the pinned cells by app.css) stays whole above and below the
            // strip: it never covers it (owner, 2026-09-30).
            "group-focus-visible:inset-y-(--focus-width)",
            // A bare visibility toggle, no animation beyond what the fixed
            // group already used: `visibility`, not `opacity`, actually
            // removes the buttons (and what they'd announce), not only
            // fades them. The container itself never takes pointer-events —
            // only each button opts back in (see ProfileRowActions /
            // ProxyListRow) — so the fade and the gaps between icons always
            // pass a click straight to the cell underneath.
            "pointer-events-none",
            // Focus in the row shows them while the keys drive (`data-input`,
            // the kit's useInputModality), never a click's focus or one that
            // followed the pointer: those show them while the pointer is on
            // the row, and no longer (owner bug, 2026-10-01).
            hold ? "visible" : cn("invisible group-hover:visible [:root:not([data-input=pointer])_[role=row]:focus-within_&]:visible", MENU_OPEN_VISIBLE),
          )}
        >
          {/* The fade: opaque white as its own base layer, then the same
              tint the solid strip uses, so the row's tint is never a
              see-through wash over whatever the fade sits on. */}
          <div className="relative h-full w-[14px] shrink-0">
            <div aria-hidden className={cn("absolute inset-0 bg-gradient-to-r from-transparent", tint.fadeTo)} />
            <div aria-hidden className={cn("absolute inset-0 bg-gradient-to-r from-transparent", tint.fades[0])} />
            <div aria-hidden className={cn("absolute inset-0 bg-gradient-to-r from-transparent", tint.fades[1])} />
          </div>
          <div className={cn("relative flex h-full items-center gap-1", !floatFixed && "pr-1")}>
            <div aria-hidden data-row-backing className={cn("absolute inset-0", tint.base)} />
            <div aria-hidden data-hover-strip className={cn("absolute inset-0", tint.fill)} />
            {lead && (
              // Collapsed, never `hidden`: its button stays a real Tab stop
              // even while it draws nothing, and it opens up the moment
              // focus actually lands inside it — never merely because some
              // other control in the row got focus (controller ruling C7: a
              // floor sized for an always-shown lead would push the default
              // list past the 1024 px card). Fix round 1 (M1): collapsed,
              // it is `absolute` (out of the strip's flex flow), so it does
              // not even add its own `gap-1` — the strip's rest width stays
              // exactly what `rowActionsCoverPx` says. Shown, it rejoins
              // the flow (`static`) at its own place, before `children`.
              <span
                data-row-lead
                className={cn(
                  "pointer-events-none absolute inset-y-0 right-full flex w-0 shrink-0 items-center gap-1 overflow-hidden",
                  "focus-within:static focus-within:w-auto focus-within:overflow-visible focus-within:pointer-events-auto",
                  "group-data-[over-last]:static group-data-[over-last]:w-auto group-data-[over-last]:overflow-visible group-data-[over-last]:pointer-events-auto",
                )}
              >
                {lead}
                <span aria-hidden="true" className="h-[14px] w-px shrink-0 bg-stroke-soft-200" />
              </span>
            )}
            {children}
            {floatFixed && <div data-fixed-actions className="relative flex items-center gap-1">{fixed}</div>}
          </div>
        </div>
      )}
      {!floatFixed && <div
        data-fixed-actions
        className={cn(
          "flex items-center gap-1",
          !persistFixed && cn(
            "opacity-0 group-hover:opacity-100 [:root:not([data-input=pointer])_[role=row]:focus-within_&]:opacity-100",
            MENU_OPEN_OPAQUE,
          ),
        )}
      >
        {fixed}
      </div>}
    </div>
  );
}
