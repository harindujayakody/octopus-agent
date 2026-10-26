import { t } from "../../../shared/i18n";
import { confirmModal } from "../../../shared/model/confirm";
import { teamSessions, useSpace, type OpenSession } from "../../../entities/space";
import { isSaving } from "../../../entities/profile";

/// Quit first saves and closes the team and synced profiles open here (lib.rs `exit_app`),
/// so the question names each one and what becomes of it. True: go on and quit.
export async function confirmOpenSessions(): Promise<boolean> {
  const open = await teamSessions();
  if (open.length === 0) return true;
  const teams = useSpace.getState().state?.teams ?? [];
  const note = (s: OpenSession) => {
    // A synced profile's team is the sync server's, not a team joined here.
    if (s.mine) return isSaving(s.profile_id) ? t("quitSessions.savingSynced") : t("quitSessions.synced");
    const team = teams.find((x) => x.id === s.team_id)?.name;
    // Closed already, its session still on its way: quitting waits for it.
    if (isSaving(s.profile_id)) return team ? t("quitSessions.saving", { team }) : t("quitSessions.savingUnnamed");
    return team ? t("quitSessions.team", { team }) : t("quitSessions.teamUnnamed");
  };
  const ok = await confirmModal({
    title: t("quitSessions.title"),
    message: open.length === 1 ? t("quitSessions.messageOne") : t("quitSessions.messageMany"),
    items: open.map((s) => ({ label: s.name, note: note(s) })),
    confirmLabel: t("quitSessions.confirm"),
  });
  return ok === true;
}
