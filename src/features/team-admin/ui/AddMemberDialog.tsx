import { useState } from "react";
import { Button, DialogModal, Input } from "@proxyshard/shardx-ui-kit";
import { AddIcon, LockedIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { teamError, useTeamAdmin, type TeamMember } from "../../../entities/team";
import { InviteField } from "./InviteField";

/// Adds a member by name, then shows their invite once: the server's address
/// and a token, which they paste in Join a team. Their rights start empty,
/// so the invite step leads on to them.
export function AddMemberDialog({ open, onClose, onRights }: { open: boolean; onClose: () => void; onRights: (member: TeamMember) => void }) {
  const t = useT();
  const members = useTeamAdmin((s) => s.overview?.members ?? []);
  const createMember = useTeamAdmin((s) => s.createMember);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ member: TeamMember; invite: string } | null>(null);
  const trimmed = name.trim();
  // Two members of one name could not be told apart in the list.
  const taken = !made && members.some((m) => m.name.toLowerCase() === trimmed.toLowerCase());

  const submit = async () => {
    if (made) { onClose(); return; }
    if (!trimmed || taken || busy) return;
    setBusy(true);
    setErr(null);
    try {
      setMade(await createMember(trimmed));
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
      dirty={!made && trimmed !== ""}
      icon={<AddIcon className="size-3.5" />}
      title={made ? t("team.inviteTitle", { name: made.member.name }) : t("team.addTitle")}
      confirmLabel={made ? t("team.done") : t("team.addConfirm")}
      onConfirm={() => void submit()}
      hideCancel={!!made}
      isLoading={busy}
      isDisabled={!made && (!trimmed || taken)}
      footerNote={err ? <span role="alert" className="text-error-text">{err}</span> : !made && !trimmed ? t("team.addNeedName") : undefined}
    >
      <div className="flex flex-col gap-3 py-4">
        {made ? (
          <>
            <InviteField invite={made.invite} />
            <p className="m-0 text-help text-text-sub-600">{t("team.inviteHelp")}</p>
            <div data-next-rights className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-bg-weak-50 py-2 ps-3 pe-2">
              <span className="min-w-0 text-help text-text-sub-600">{t("team.inviteNoRights")}</span>
              <Button variant="neutral" mode="stroke" size="xsmall" leftIcon={<LockedIcon className="size-3.5" />} onClick={() => onRights(made.member)}>
                {t("team.setRights")}
              </Button>
            </div>
          </>
        ) : (
          <Input
            autoFocus
            inputSize="xsmall"
            label={t("team.memberName")}
            placeholder={t("team.memberNamePlaceholder")}
            value={name}
            maxLength={200}
            error={taken ? t("team.memberTaken", { name: trimmed }) : undefined}
            onChange={(e) => { setName(e.target.value); setErr(null); }}
          />
        )}
      </div>
    </DialogModal>
  );
}
