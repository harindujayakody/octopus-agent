import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { confirmModal } from "../../../shared/model/confirm";
import { setUiBridge, useProfile, type ProfileMeta } from "../../../entities/profile";
import { syncCall, syncError } from "../../../entities/sync";

/// A profile held by a computer that is gone or asleep: take it here, after
/// saying what happens there, then start it. True when it started.
export async function openHereInstead(p: ProfileMeta): Promise<boolean> {
  const device = p.sync?.open_on;
  if (!device) return false;
  const ok = await confirmModal({
    title: t("profileSync.takeTitle", { name: p.name }),
    message: t("profileSync.takeMessage", { device }),
    confirmLabel: t("profileSync.takeConfirm"),
  });
  if (!ok) return false;
  try {
    useProfile.getState().applyRows([await syncCall("profile_sync_take", { id: p.id })]);
  } catch (e) {
    toast.fail({ title: t("profileSync.takeFailed", { name: p.name }), detail: syncError(e), subject: p.name });
    return false;
  }
  const now = useProfile.getState().profiles.find((x) => x.id === p.id) ?? p;
  return (await useProfile.getState().startStop(now)) === null;
}

// The Start refusal's toast offers it; the store cannot import a feature.
setUiBridge({ takeLease: (p) => void openHereInstead(p) });
