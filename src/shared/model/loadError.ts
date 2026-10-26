import type { Section } from "../types";
import { useNav } from "./navigation";
import { toast } from "./toast";

/// A list's first load failed. Its page shows the failure in place with
/// Retry (Phase 5B's LoadError), so a toast there would say it twice; only
/// when that page is not on screen (a picker loaded the list for Peek, say)
/// does a toast carry it (overview 6.2, "Load errors"; plan ruling 6).
export function reportLoadError(section: Section, title: string, e: unknown): void {
  if (useNav.getState().section === section) return;
  toast.fail({ title, detail: e });
}
