import { useState } from "react";
import { Button } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { useSpace } from "../../../entities/space";
import { syncError, useSync } from "../../../entities/sync";
import { InviteFields, useInvite, withScheme } from "../../join-team";
import { sayConnected } from "../model/actions";
import { OwnerWarning } from "./OwnerWarning";

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/// Connects sync to a server by its invite (or address and token apart): the
/// person's own server, or one whose admin gave them an invite, which says so first.
export function ConnectServerForm() {
  const t = useT();
  const connect = useSync((s) => s.connect);
  const teams = useSpace((s) => s.state?.teams);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const invite = useInvite(() => setErr(null));
  const server = withScheme(invite.server);
  // A member's token ("stm_…"), or a team server joined as a member: someone else runs it.
  const foreign = invite.ready && (invite.token.trim().startsWith("stm_")
    || (teams ?? []).some((x) => !x.admin && hostOf(x.server) === hostOf(server)));

  const submit = async () => {
    if (!invite.ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await connect({ server, token: invite.token.trim() });
      sayConnected();
    } catch (e) {
      setErr(syncError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form data-sync-connect="server" className="flex flex-col gap-3 py-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="m-0 text-help text-text-sub-600">{t("sync.pasteHelp")}</p>
      <InviteFields invite={invite} serverLabel={t("team.joinInviteOrServer")} tokenLabel={t("team.joinToken")} placeholder="http://203.0.113.5:8787" />
      {foreign && <OwnerWarning text={t("sync.inviteOwnerWarning")} />}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button type="submit" variant="primary" size="xsmall" isLoading={busy} disabled={!invite.ready}>{t("sync.connect")}</Button>
        {err
          ? <span role="alert" data-sync-error className="text-help text-error-text">{err}</span>
          : !invite.ready && <span className="text-help text-text-sub-600">{t("team.joinNeedBoth")}</span>}
      </div>
    </form>
  );
}
