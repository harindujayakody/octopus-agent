import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { copySecret } from "../../../shared/lib/clipboard";
import { syncCall, syncError, useSync } from "../../../entities/sync";

/** Sync now, from the Sync tab, the Disconnect dialog or the palette; a refusal says why. */
export async function syncNow(): Promise<void> {
  try {
    await useSync.getState().syncNow();
  } catch (e) {
    toast.fail({ title: t("sync.syncFailed"), detail: syncError(e, useSync.getState().state?.connection?.own) });
  }
}

/** Said once connected: with "selected", nothing syncs until profiles are picked. */
export function sayConnected(): void {
  const all = useSync.getState().state?.kinds.profiles === "all";
  toast.ok(t("sync.connectedToast"), all ? undefined : { detail: t("sync.connectedPick") });
}

/// The invite another of the person's computers pastes. It holds a token, so
/// it leaves the clipboard after a minute, as the Team page's invites do.
export async function copyInvite(): Promise<void> {
  try {
    const { invite } = await syncCall("sync_invite", {});
    await copySecret(invite);
    toast.ok(t("clipboard.copiedSecret"));
  } catch (e) {
    toast.fail({ title: t("sync.inviteFailed"), detail: syncError(e, useSync.getState().state?.connection?.own) });
  }
}
