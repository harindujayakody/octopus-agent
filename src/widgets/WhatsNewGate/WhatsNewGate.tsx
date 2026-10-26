import { useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useWhatsNew } from "../../shared/model/whatsNew";

const SEEN_KEY = "shardx-patchlog-seen-version";

/** Opens What's new on the first run after an update, and tells a first
 *  install from an update (`installKind`) for the welcome. Renders nothing. */
export function WhatsNewGate() {
  const setOpen = useWhatsNew((s) => s.setOpen);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let version: string;
      try {
        version = await getVersion();
      } catch {
        // Plain-browser dev: no Tauri IPC, and nothing to announce.
        useWhatsNew.getState().setDecided();
        return;
      }
      if (cancelled) return;
      // Read before the version is recorded below: no seen version is a
      // first install, another one an update. A storage that cannot be read
      // claims neither (nothing extra shows then).
      let seen: string | null;
      try {
        seen = localStorage.getItem(SEEN_KEY);
      } catch {
        useWhatsNew.getState().setDecided();
        return;
      }
      useWhatsNew.getState().setInstallKind(!seen ? "first" : seen !== version ? "update" : null);
      // A fresh install has nothing to catch up on — record the version and
      // leave the operator on the profile list.
      try { localStorage.setItem(SEEN_KEY, version); } catch { /* private mode: asked again next start */ }
      if (seen && seen !== version) {
        setOpen(true);
      }
      useWhatsNew.getState().setDecided();
    })();
    return () => { cancelled = true; };
  }, [setOpen]);

  return null;
}
