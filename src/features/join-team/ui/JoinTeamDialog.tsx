import { useState } from "react";
import { DialogModal } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { useDialogLife } from "../../../shared/lib/useDialogLife";
import { PERSONAL, useSpace } from "../../../entities/space";
import { teamError } from "../../../entities/team";
import { withScheme } from "../lib/invite";
import { useJoinTeam } from "../model/store";
import { InviteFields, useInvite } from "./InviteFields";

/** Mounted once, with the sidebar: open while `useJoinTeam` says so. */
export function JoinTeamHost() {
  const open = useJoinTeam((s) => s.open);
  const life = useDialogLife(open);
  return life.mounted ? <JoinTeamDialog key={life.session} open={open} onClose={() => useJoinTeam.getState().setOpen(false)} /> : null;
}

/// Joins a team server with the invite its admin gave (or its address and
/// token apart), then moves the launcher into that team (not when opened for sync).
export function JoinTeamDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const join = useSpace((s) => s.join);
  const forSync = useJoinTeam((s) => s.forSync);
  // Opened for a team's new invite: its address is in, the token is what is asked for.
  const [startServer] = useState(() => useJoinTeam.getState().server);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const invite = useInvite(() => setErr(null), startServer);

  const submit = async () => {
    if (!invite.ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const server = withScheme(invite.server);
      // Cancel at the unsaved-changes question keeps this open, nothing joined.
      if (!(await join(server, invite.token.trim()))) return;
      if (forSync) {
        // Only its server was wanted, for personal sync: back to the personal space, the team picked there.
        const team = useSpace.getState().state?.teams.find((x) => x.server === server);
        useJoinTeam.setState({ joinedForSync: team?.id ?? null });
        await useSpace.getState().choose(PERSONAL);
      }
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
      dirty={invite.dirty}
      title={t("team.joinTitle")}
      confirmLabel={t("team.joinConfirm")}
      onConfirm={() => void submit()}
      isLoading={busy}
      isDisabled={!invite.ready}
      footerNote={err ? <span role="alert" data-join-error className="text-error-text">{err}</span> : !invite.ready ? t("team.joinNeedBoth") : undefined}
    >
      <div className="flex flex-col gap-3 py-4">
        <p className="m-0 text-help text-text-sub-600">{t("team.joinHelp")}</p>
        <InviteFields invite={invite} serverLabel={t("team.joinInviteOrServer")} tokenLabel={t("team.joinToken")} placeholder="http://203.0.113.5:8787" autoFocus={startServer ? "token" : "server"} />
      </div>
    </DialogModal>
  );
}
