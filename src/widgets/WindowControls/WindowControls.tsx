import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconButton, Portal, cn } from "@proxyshard/shardx-ui-kit";
import { HOST_OS } from "../../shared/lib/utils";
import { useT } from "../../shared/i18n";

/** Width the three caption buttons take at the right end of the header. */
export const CAPTION_ROOM = 3 * 46;
/** Windows and Linux draw these; macOS has its traffic lights. */
export const HAS_CAPTIONS = HOST_OS !== "macOS";

const Glyph = ({ d }: { d: "min" | "max" | "close" }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    {d === "min" && <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />}
    {d === "max" && <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />}
    {d === "close" && (
      <>
        <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1" />
        <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1" />
      </>
    )}
  </svg>
);

/// Minimize, maximize and close in the window's top-right corner, as Windows
/// 11 draws them: 46 px wide, the header's full height, flush with the edge,
/// so Close is a corner target (LAYOUT-08). One group for the whole window,
/// the engine screen included; macOS draws nothing (its traffic lights). In
/// a portal, outside #root, fixed to the window's corner: a dialog makes the
/// page inert, and the window can still be minimized, maximized or closed.
export function ShellWindowControls({ className }: { className?: string }) {
  const t = useT();
  if (!HAS_CAPTIONS) return null;
  // The kit merges no classes (PC-009): `!` makes the caption size win over
  // the Button's own size classes instead of leaving it to CSS order. Square
  // corners and an inside focus ring: a ring drawn outside would fall off
  // the window's edge. `static`: caption buttons never scale on press.
  const button = "h-full! w-[46px]! rounded-none! focus-ring-inset";
  return (
    <Portal>
    <div data-captions className={cn("fixed right-0 top-0 z-(--layer-chrome) flex h-[52px]", className)}>
      <IconButton label={t("windowControls.minimize")} tooltipSide="bottom" size="xsmall" static className={button} icon={<Glyph d="min" />} onClick={() => void getCurrentWindow().minimize()} />
      <IconButton label={t("windowControls.maximize")} tooltipSide="bottom" size="xsmall" static className={button} icon={<Glyph d="max" />} onClick={() => void getCurrentWindow().toggleMaximize()} />
      <IconButton label={t("windowControls.close")} tooltipSide="bottom" size="xsmall" static className={cn(button, "hover:bg-error-fill! hover:text-static-white")} icon={<Glyph d="close" />} onClick={() => void getCurrentWindow().close()} />
    </div>
    </Portal>
  );
}
