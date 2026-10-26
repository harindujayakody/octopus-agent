import { CopyButton, Input } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { copySecret } from "../../../shared/lib/clipboard";
import { toast } from "../../../shared/model/toast";

/// An invite as it is shown once: readable, selectable, and copied as a
/// secret (it leaves the clipboard after a minute, which a toast says).
/// It takes the keyboard as it appears, its text selected, so Enter is Done.
export function InviteField({ invite }: { invite: string }) {
  const t = useT();
  const copy = async () => {
    try {
      await copySecret(invite);
      toast.ok(t("clipboard.copiedSecret"));
    } catch (e) {
      toast.fail({ title: t("copyField.failed"), detail: e });
      throw e;
    }
  };
  return (
    <Input
      readOnly
      autoFocus
      data-invite
      label={t("team.inviteLabel")}
      inputSize="xsmall"
      className="mono"
      secret
      value={invite}
      onFocus={(e) => e.currentTarget.select()}
      rightIcon={<CopyButton size="3xsmall" className="pointer-events-auto" label={t("team.inviteCopy")} onCopy={copy} />}
    />
  );
}
