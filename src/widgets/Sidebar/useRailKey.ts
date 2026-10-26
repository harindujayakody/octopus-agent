import { useEffect, useRef } from "react";
import { t } from "../../shared/i18n";
import { SidebarIcon } from "../../shared/icons";
import { isMod, overlayHasKeyboard } from "../../shared/lib/keyboard";
import { defineCommands } from "../../shared/commands";

/** The mounted sidebar's own fold action, for the command below. */
let toggleShown: (() => void) | null = null;

/// "Toggle sidebar" in the registry, so Cmd+K and the `?` sheet list it with
/// its key (F8b, R11). It lives with the sidebar, whose store it acts on;
/// the key is `useRailKey`'s (keyOwner: listed, never dispatched twice).
defineCommands([{
  id: "app.toggleSidebar", area: "app", scope: "global", group: "view", icon: SidebarIcon,
  label: () => t("sidebar.toggle"), keys: ["Mod+\\"], keyWhere: "app", inFields: true, keyOwner: "self",
  surfaces: ["palette", "sheet"],
  run: () => toggleShown?.(),
}]);

/// Mod+\ folds the sidebar to its icon rail and back (6.2), from any page,
/// text fields included (it types nothing); not while a dialog or menu is open.
/// `toggle` is the sidebar's own button action, so the key, the button and
/// the command always do the same thing to what is drawn.
export function useRailKey(toggle: () => void) {
  const latest = useRef(toggle);
  useEffect(() => { latest.current = toggle; });
  useEffect(() => {
    const run = () => latest.current();
    toggleShown = run;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isMod(e) || e.shiftKey || e.altKey || e.defaultPrevented) return;
      if (e.code !== "Backslash" && e.key !== "\\") return;
      if (overlayHasKeyboard()) return;
      e.preventDefault();
      run();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (toggleShown === run) toggleShown = null;
    };
  }, []);
}
