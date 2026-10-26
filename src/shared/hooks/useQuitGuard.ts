import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirmLeave } from "../model/unsaved";
import { commitFocusedField } from "../lib/commitField";

// Quit asks first (manual save: nothing saves itself, so leaving with unsaved
// changes asks). Tray "Quit" and Cmd+Q reach the backend, which emits
// "app://quit-requested", shows the window and waits for this answer:
// app_quit_confirmed (go on and exit) or app_quit_cancelled (stay). The
// question is the same guard as a page change: Save, Don't save, Cancel.
// app_quit_asking goes first: a window that never says it is asking is taken
// for gone, and the app exits after a few seconds (lib.rs `quit`).

async function answerQuit(more?: () => Promise<boolean>) {
  try { await invoke("app_quit_asking"); } catch { /* an older backend */ }
  // A field that still has the keyboard hands its text to its form first, as a Save does.
  commitFocusedField();
  let leave = false;
  try {
    leave = await confirmLeave();
    // Then what else Quit would close (the open team and synced profiles).
    if (leave && more) leave = await more();
  } catch {
    leave = false;
  }
  try {
    await invoke(leave ? "app_quit_confirmed" : "app_quit_cancelled");
  } catch {
    // An older backend: nobody is waiting for the answer.
  }
}

/** Mount once, in the shell. `more`: a further question after the unsaved changes; false stays. */
export function useQuitGuard(more?: () => Promise<boolean>) {
  const latest = useRef(more);
  latest.current = more;
  useEffect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    listen("app://quit-requested", () => { void answerQuit(latest.current); })
      .then((fn) => {
        if (disposed) fn();
        else un = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      un?.();
    };
  }, []);
}
