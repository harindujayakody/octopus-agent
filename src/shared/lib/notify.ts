import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/// A notification from the operating system, for news that should reach the
/// person while the window is in the background (an update ready). Asks for
/// permission the first time; a refusal, or a system without notifications,
/// leaves only the in-app toast that every caller raises too.
export async function notifySystem(title: string, body?: string): Promise<void> {
  try {
    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === "granted";
    if (ok) sendNotification({ title, body });
  } catch {
    // Not in the desktop app (the browser mock), or notifications are off.
  }
}
