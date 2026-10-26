import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** How long the launcher may stay hidden at most, ms, whatever it shows. */
const SHOW_AT_LATEST_MS = 2_500;

/// The launcher window opens hidden (tauri.conf.json `visible: false`) and
/// shows once it has painted a screen: the page's header over its rows or
/// their loading look, or the engine screen (each holds a `main h1`), never
/// the bare ground before it (speed lane 2026-10-02). The startup frame
/// (FirstRunGate's `data-gate-frame`, the shell's panels while the engine
/// check runs on the real backend) counts too: it is drawn to be replaced
/// without a jump, and waiting past it held the window for the full 2.5 s. A safety timer shows it
/// anyway after 2.5 s, and index.html's own after 4 s should this code never
/// run. A browser or mock build has no window to show: nothing happens there.
export function showWindowWhenPainted() {
  if (!isTauri()) return;
  const root = document.getElementById("root");
  let shown = false;
  const show = () => {
    if (shown) return;
    shown = true;
    observer.disconnect();
    clearTimeout(latest);
    void getCurrentWindow().show().catch(() => {});
  };
  // In the frame the screen first paints in: the task after its animation
  // frame runs once that frame is painted.
  const painted = () => requestAnimationFrame(() => setTimeout(show, 0));
  const check = () => {
    if (!root?.querySelector("main h1, [data-gate-frame]")) return false;
    observer.disconnect();
    painted();
    return true;
  };
  const observer = new MutationObserver(() => { check(); });
  const latest = setTimeout(show, SHOW_AT_LATEST_MS);
  if (root && !check()) observer.observe(root, { childList: true, subtree: true });
}
