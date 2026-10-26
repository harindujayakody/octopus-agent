import type { ReactNode } from "react";
import { SyncIcon } from "../icons";
import { dragWindowOnMouseDown } from "../lib/dragWindow";

/// Shell of the small always-on-top windows (sync panel, helper panel): the
/// whole surface drags the window, with a title row and its actions on top.
/// Controls inside stop mousedown propagation so they stay clickable.
export function FloatingPanel({ title, actions, children }: {
  title: ReactNode;
  /** Buttons at the right end of the title row. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    // Explicit startDragging, not data-tauri-drag-region — Tauri tests that on
    // the exact element hit.
    <div
      data-floating-panel
      onMouseDown={dragWindowOnMouseDown}
      className="flex h-screen w-screen flex-col rounded-none bg-bg-white-0 ring-1 ring-inset ring-stroke-soft-200"
    >
      <div className="flex shrink-0 select-none items-center gap-2 px-3 pt-2.5 pb-1.5">
        <SyncIcon className="size-3.5 shrink-0 text-primary-text" />
        <div className="flex-1 truncate text-secondary font-medium text-text-strong-950">{title}</div>
        {actions}
      </div>
      {children}
    </div>
  );
}
