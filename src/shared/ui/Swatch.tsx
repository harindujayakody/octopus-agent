import { forwardRef } from "react";
import { Tooltip, cn } from "@proxyshard/shardx-ui-kit";
import { CloseIcon } from "../icons";

/// One color choice (UI-33): the same size, edge and checked ring wherever a
/// color is picked (profile accent, Folders, Tags). A radio in a radio group,
/// named by the color's name, never a hex (A11Y-08); the name is its tooltip
/// too. `color` is the swatch's CSS background: a color, or Automatic's
/// multicolor gradient. `color: null` is the "no color" choice, drawn with an
/// X, not tiny text. The checked ring's gap takes the surface behind it from
/// `--swatch-bg`.
///
/// Owner (WCAG 2.5.8): every swatch draws at 21 px with an invisible 24 px
/// hit area (the ::before, 1.5 px out each side), the dismiss button's size
/// (C10), in a dialog and in a list row alike: one swatch size. The groups'
/// 5 px gap leaves 2 px between neighbouring hit areas, so a click never
/// lands on the neighbour.
export const Swatch = forwardRef<HTMLButtonElement, {
  color: string | null;
  name: string;
  checked: boolean;
  tabbable: boolean;
  onSelect: () => void;
}>(function Swatch({ color, name, checked, tabbable, onSelect }, ref) {
  return (
    <Tooltip content={name}>
      {/* eslint-disable-next-line no-restricted-syntax -- colour swatch: the button is the colour */}
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-label={name}
        tabIndex={tabbable ? 0 : -1}
        onClick={onSelect}
        className={cn(
          "relative grid size-[21px] shrink-0 place-items-center rounded-full focus-ring before:absolute before:-inset-[1.5px] before:content-['']",
          checked
            ? "ring-2 ring-text-strong-950 ring-offset-2 ring-offset-[color:var(--swatch-bg,var(--bg-white-0))]"
            : color
              ? "ring-1 ring-inset ring-stroke-image"
              : "ring-1 ring-inset ring-stroke-soft-200",
          // Windows contrast themes: a color keeps its fill (forced-content),
          // and with it the checked ring in the theme's colors, which may not
          // show on the system's canvas; the checked one also gets a thicker
          // CanvasText outline. The mark is the system's text on an edge.
          color
            ? "forced-content forced-colors:aria-checked:outline-2 forced-colors:aria-checked:outline-offset-2"
            : "text-icon-soft-400 forced-edge aria-checked:forced-selected",
        )}
        style={color ? { background: color } : undefined}
      >
        {color === null && <CloseIcon aria-hidden="true" className="size-3.5" />}
      </button>
    </Tooltip>
  );
});
