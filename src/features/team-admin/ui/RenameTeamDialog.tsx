import { useState } from "react";
import { DialogModal, Input } from "@proxyshard/shardx-ui-kit";
import { RenameIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { teamError, useTeamAdmin } from "../../../entities/team";
import { useSpace } from "../../../entities/space";

/** A team's name as the server takes it: 1 to 64 characters. */
const TEAM_NAME_MAX = 64;

/// Renames the team for everyone in it; the space menu follows.
export function RenameTeamDialog({ current, open, onClose }: { current: string; open: boolean; onClose: () => void }) {
  const t = useT();
  const rename = useTeamAdmin((s) => s.rename);
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const trimmed = name.trim();

  const submit = async () => {
    if (!trimmed || busy) return;
    if (trimmed === current) { onClose(); return; }
    setBusy(true);
    setErr(null);
    try {
      await rename(trimmed);
      void useSpace.getState().load().catch(() => {});
      onClose();
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
      size="sm"
      dirty={trimmed !== current}
      icon={<RenameIcon className="size-3.5" />}
      title={t("team.renameTitle")}
      confirmLabel={t("team.renameConfirm")}
      onConfirm={() => void submit()}
      isLoading={busy}
      isDisabled={!trimmed}
      footerNote={err ? <span role="alert" className="text-error-text">{err}</span> : !trimmed ? t("team.renameNeedName") : undefined}
    >
      <div className="py-4">
        <Input
          autoFocus
          inputSize="xsmall"
          label={t("team.teamName")}
          value={name}
          maxLength={TEAM_NAME_MAX}
          onChange={(e) => { setName(e.target.value); setErr(null); }}
        />
      </div>
    </DialogModal>
  );
}
