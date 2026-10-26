import { useState } from "react";
import { DialogModal } from "@proxyshard/shardx-ui-kit";
import { KeyIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { teamError, useTeamAdmin, type TeamMember } from "../../../entities/team";
import { InviteField } from "./InviteField";

/// A new token for a member who lost theirs: the old invite stops working
/// once the new one is made, so it asks first, then shows it once.
export function NewInviteDialog({ member, open, onClose }: { member: TeamMember; open: boolean; onClose: () => void }) {
  const t = useT();
  const reissue = useTeamAdmin((s) => s.reissue);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);

  const submit = async () => {
    if (invite) { onClose(); return; }
    setBusy(true);
    setErr(null);
    try {
      setInvite(await reissue(member.id));
    } catch (e) {
      setErr(teamError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogModal
      open={open}
      onClose={onClose}
      icon={<KeyIcon className="size-3.5" />}
      title={invite ? t("team.inviteTitle", { name: member.name }) : t("team.reissueTitle", { name: member.name })}
      confirmLabel={invite ? t("team.done") : t("team.reissueConfirm")}
      onConfirm={() => void submit()}
      hideCancel={!!invite}
      isLoading={busy}
      footerNote={err ? <span role="alert" className="text-error-text">{err}</span> : undefined}
    >
      <div className="flex flex-col gap-3 py-4">
        {invite ? (
          <>
            <InviteField invite={invite} />
            <p className="m-0 text-help text-text-sub-600">{t("team.inviteHelp")}</p>
          </>
        ) : (
          <p className="m-0 text-body text-text-sub-600">{t("team.reissueMessage")}</p>
        )}
      </div>
    </DialogModal>
  );
}
