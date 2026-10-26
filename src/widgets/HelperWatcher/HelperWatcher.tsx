import { useEffect, useRef } from "react";
import { helperProfiles, helperShow, helperClose } from "../../entities/profile/model/api";

/**
 * Opens and closes the Shard Helper panel as pages come and go. Renders nothing;
 * lives in the main window because the panel cannot watch for its own reason to
 * exist. Polls — the event is second-scale and the call reads a map in memory.
 */
export function HelperWatcher() {
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const profiles = await helperProfiles();
        if (!alive) return;
        // One panel, so one profile: two would fight for the same corner.
        const next = profiles[0] ?? null;
        if (next === shownFor.current) return;
        shownFor.current = next;
        if (next) await helperShow(next);
        else await helperClose();
      } catch { /* the bus may not be up yet */ }
    };
    void tick();
    const id = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return null;
}
