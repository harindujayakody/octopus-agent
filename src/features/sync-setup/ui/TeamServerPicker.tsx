import { useEffect, useState } from "react";
import { Button } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { SelectField } from "../../../shared/ui/SelectField";
import { useSpace } from "../../../entities/space";
import { syncError, useSync } from "../../../entities/sync";
import { useJoinTeam } from "../../join-team";
import { sayConnected } from "../model/actions";
import { OwnerWarning } from "./OwnerWarning";

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/// Sync through a team server this launcher has joined. Its owner holds the
/// server's data, so a server the person does not run says so first.
export function TeamServerPicker() {
  const t = useT();
  const joined = useSpace((s) => s.state?.teams);
  // Only a team whose token still works can carry sync.
  const teams = (joined ?? []).filter((x) => !x.revoked && !x.needs_invite);
  const connect = useSync((s) => s.connect);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const team = teams.find((x) => x.id === picked);
  // A team joined from here (Join a team…) comes back picked.
  const justJoined = useJoinTeam((s) => s.joinedForSync);
  useEffect(() => {
    if (!justJoined) return;
    setPicked(justJoined);
    useJoinTeam.setState({ joinedForSync: null });
  }, [justJoined]);

  if (teams.length === 0) {
    return (
      <div data-sync-connect="team" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-4">
        <span className="text-help text-text-sub-600">{t("sync.noTeams")}</span>
        <Button variant="neutral" mode="stroke" size="xsmall" onClick={() => useJoinTeam.getState().setOpen(true, true)}>{t("sync.joinTeam")}</Button>
      </div>
    );
  }

  const submit = async () => {
    if (!team || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await connect({ teamId: team.id });
      sayConnected();
    } catch (e) {
      setErr(syncError(e, team.admin));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-sync-connect="team" className="flex flex-col gap-3 py-4">
      <SelectField
        label={t("sync.teamLabel")}
        placeholder={t("sync.teamPlaceholder")}
        value={picked}
        options={teams.map((x) => ({ value: x.id, label: x.name, hint: hostOf(x.server) }))}
        onChange={(v) => { setPicked(v); setErr(null); }}
      />
      {team && (team.admin
        ? <p data-sync-owner="you" className="m-0 text-help text-text-sub-600">{t("sync.teamYours")}</p>
        : <OwnerWarning text={t("sync.teamOwnerWarning")} />)}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button variant="primary" size="xsmall" isLoading={busy} disabled={!team} onClick={() => void submit()}>{t("sync.useTeam")}</Button>
        {err
          ? <span role="alert" data-sync-error className="text-help text-error-text">{err}</span>
          : !team && <span className="text-help text-text-sub-600">{t("sync.pickTeamFirst")}</span>}
      </div>
    </div>
  );
}
