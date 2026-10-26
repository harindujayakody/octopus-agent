import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTheme } from "@proxyshard/shardx-ui-kit";

/// The native window (its background while resizing, native menus, file
/// dialogs) follows the app's theme, not only the system's (WIG-11). Only in a
/// Tauri window; until the backend grants `core:window:allow-set-theme`
/// (backend B12) the call is refused, and a refusal changes nothing. It lives
/// in the app so the kit stays free of Tauri (plan ruling 7).
export function NativeThemeSync() {
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    getCurrentWindow().setTheme(resolvedTheme).catch(() => {});
  }, [resolvedTheme]);
  return null;
}
