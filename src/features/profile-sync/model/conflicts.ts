import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { useProfile, useProfileUi } from "../../../entities/profile";

/// Says so when a sync makes a conflict copy, with a way to it. Copies the
/// list had when it first loaded are old news; each copy is said once.
export function watchConflictCopies(): () => void {
  let known: Set<string> | null = null;
  const look = (ready: boolean) => {
    const copies = useProfile.getState().profiles.filter((p) => p.sync?.conflict);
    if (!known) {
      if (ready) known = new Set(copies.map((p) => p.id));
      return;
    }
    for (const p of copies) {
      if (known.has(p.id)) continue;
      known.add(p.id);
      toast.info(t("profileSync.conflictMade", { name: p.name }), {
        detail: t("profileSync.conflictDetail"),
        action: { label: t("toast.showInList"), run: () => void useProfileUi.getState().showInList(p.id) },
      });
    }
  };
  look(useProfile.getState().status === "ready");
  return useProfile.subscribe((s, prev) => {
    if (s.profiles !== prev.profiles || s.status !== prev.status) look(s.status === "ready");
  });
}
