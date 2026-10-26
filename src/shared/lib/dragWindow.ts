import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";
import { HOST_OS } from "./utils";
import { pressMovesWindow } from "./windowPress";

/** The macOS traffic lights sit over the window's top-left corner. Only in the
 *  real window: Tauri sets `window.isTauri`, a browser preview has none. */
export const hasTrafficLights = (): boolean => HOST_OS === "macOS" && isTauri();

/** The shell's padding on the window's gray ground: 8 px all round, and on
 *  macOS a 38 px title strip on top instead (the system title bar's height),
 *  which holds the traffic lights centered on it at x 8, the panels' left
 *  edge (tauri.conf.json, trafficLightPosition). So no panel's top row makes
 *  room for them (owner, 2026-10-02: "add a strip on top, place the traffic
 *  lights in it"). The strip is the ground: a press drags the window and a
 *  double press zooms it, as on the ground between the panels. */
export const shellPadClass = (): string => (hasTrafficLights() ? "px-(--gap-panel) pb-(--gap-panel) pt-[38px]" : "p-(--gap-panel)");

/** Drags the window unless the press landed on a control. Explicit, because
 *  `data-tauri-drag-region` is tested on the exact element hit, not ancestors. */
export function dragWindowOnMouseDown(e: React.MouseEvent): void {
  if (!pressMovesWindow(e)) return;
  // Otherwise the press starts a selection that smears as the window moves.
  e.preventDefault();
  void getCurrentWindow().startDragging();
}

/** A title bar: drags like `dragWindowOnMouseDown`, and a double press
 *  maximizes or restores the window. Not for the small floating panels. */
export function titleBarOnMouseDown(e: React.MouseEvent): void {
  if (!pressMovesWindow(e)) return;
  e.preventDefault();
  if (e.detail !== 2) {
    void getCurrentWindow().startDragging();
    return;
  }
  // macOS zooms on the second release, as Tauri's own drag regions do.
  if (HOST_OS === "macOS") {
    window.addEventListener("mouseup", () => void getCurrentWindow().toggleMaximize(), { once: true });
  } else {
    void getCurrentWindow().toggleMaximize();
  }
}
