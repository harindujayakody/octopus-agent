import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { t } from "../i18n";
import { toast } from "../model/toast";
import { TEAM_WARNINGS, UNNAMED_TEAM, warningRe } from "../api/backendWarnings";

type Say = (m: RegExpExecArray) => void;
const warn = (title: string, detail?: unknown) => toast.warn({ title, detail });
/** The team's name, or none where live.rs no longer knew it. */
const named = (team: string) => (team === UNNAMED_TEAM ? null : team);

/** "A tag/bookmark/extension was set differently…": each key called literally. */
function setDifferently(kind: string): string {
  switch (kind) {
    case "tag": return t("launcherWarning.differentTag");
    case "bookmark": return t("launcherWarning.differentBookmark");
    case "extension": return t("launcherWarning.differentExtension");
    default: return t("launcherWarning.differentItem");
  }
}

/// The backend's warnings, in the user's language with what to do next; anything
/// else keeps the backend's words under a translated title (plan ruling 7). Like
/// every toast they close on their own (a warning after 8 s, longer once the
/// pointer or the keyboard is on it). `null`: said elsewhere, so not again here.
const KNOWN: ReadonlyArray<readonly [RegExp, Say | null]> = [
  [/would not let the launcher send UDP/i, () => warn(t("launcherWarning.udpTitle"), t("launcherWarning.udpDetail"))],
  [/could not read the proxy'?s location/i, () => warn(t("launcherWarning.geoTitle"), t("launcherWarning.geoDetail"))],
  // A team profile's session as it closed (open.rs); the reason it gives is explained.
  [warningRe(TEAM_WARNINGS.stale), (m) => warn(t("launcherWarning.staleTitle", { name: m[1] }), t("launcherWarning.staleDetail"))],
  // Kept here for the next start: before notSaved, whose words it shares.
  [warningRe(TEAM_WARNINGS.unsent), (m) => warn(t("launcherWarning.unsentTitle", { name: m[1] }), t("launcherWarning.unsentDetail"))],
  [warningRe(TEAM_WARNINGS.notSaved), (m) => warn(t("launcherWarning.notSavedTitle", { name: m[1] }), m[2])],
  [warningRe(TEAM_WARNINGS.resending), (m) => warn(t("launcherWarning.resendingTitle", { name: m[1] }), t("launcherWarning.resendingDetail"))],
  [warningRe(TEAM_WARNINGS.clockAhead), (m) => warn(t("launcherWarning.clockAheadTitle", { n: m[1] }), t("launcherWarning.clockAheadDetail", { name: m[2] }))],
  [warningRe(TEAM_WARNINGS.extensionsMissing), (m) => warn(t("launcherWarning.extensionsMissingTitle", { name: m[1], n: m[2] }), t("launcherWarning.extensionsMissingDetail"))],
  [warningRe(TEAM_WARNINGS.lostLease), (m) => warn(t("launcherWarning.lostLeaseTitle", { name: m[1] }), t("launcherWarning.lostLeaseDetail"))],
  [warningRe(TEAM_WARNINGS.closesSoon), (m) => warn(t("launcherWarning.closesSoonTitle"), t("launcherWarning.closesSoonDetail", { name: m[1], n: m[2] }))],
  [warningRe(TEAM_WARNINGS.tooBig), (m) => warn(t("launcherWarning.tooBigTitle", { name: m[1] }), t("launcherWarning.tooBigDetail", { n: m[2] }))],
  [warningRe(TEAM_WARNINGS.quitting), () => toast.info(t("launcherWarning.quitting"))],
  // The team itself (live.rs, admin.rs).
  [warningRe(TEAM_WARNINGS.withdrew), (m) => warn(
    named(m[1]) ? t("launcherWarning.withdrewTitle", { team: m[1] }) : t("launcherWarning.withdrewTitleUnnamed"),
    t("launcherWarning.withdrewDetail"),
  )],
  [warningRe(TEAM_WARNINGS.replaced), (m) => warn(
    named(m[1]) ? t("launcherWarning.replacedTitle", { team: m[1] }) : t("launcherWarning.replacedTitleUnnamed"),
    t("launcherWarning.replacedDetail"),
  )],
  [warningRe(TEAM_WARNINGS.permission), (m) => warn(t("launcherWarning.permissionTitle"), m[1])],
  [warningRe(TEAM_WARNINGS.anotherTeam), (m) => warn(t("launcherWarning.anotherTeamTitle", { team: m[1] }), t("launcherWarning.anotherTeamDetail", { server: m[2] }))],
  [warningRe(TEAM_WARNINGS.localInvite), (m) => warn(t("launcherWarning.localInviteTitle"), t("launcherWarning.localInviteDetail", { host: m[1] }))],
  [warningRe(TEAM_WARNINGS.teamLinksKept), (m) => warn(t("launcherWarning.teamLinksKeptTitle"), m[1])],
  // Personal sync (sync/cycle.rs). A profile's conflict copy is said by the list, with a way to it.
  [warningRe(TEAM_WARNINGS.projectConflict), (m) => warn(t("launcherWarning.changedTooTitle", { name: m[1] }), t("launcherWarning.bothKeptDetail", { name: m[1] }))],
  [warningRe(TEAM_WARNINGS.profileConflict), null],
  [warningRe(TEAM_WARNINGS.proxyChanged), (m) => warn(t("launcherWarning.proxyChangedTitle", { name: m[1] }), t("launcherWarning.theirsKept"))],
  [warningRe(TEAM_WARNINGS.proxySetDifferently), () => warn(t("launcherWarning.proxyDifferentTitle"), t("launcherWarning.theirsKept"))],
  [warningRe(TEAM_WARNINGS.itemSetDifferently), (m) => warn(setDifferently(m[1]), t("launcherWarning.theirsKept"))],
  [warningRe(TEAM_WARNINGS.itemChanged), (m) => warn(t("launcherWarning.changedTooTitle", { name: m[1] }), t("launcherWarning.theirsKept"))],
  // A synced extension's package left out here (sync/cycle/extension.rs).
  [warningRe(TEAM_WARNINGS.extensionIdKept), (m) => warn(t("launcherWarning.extensionIdKept", { name: m[1] }))],
  [warningRe(TEAM_WARNINGS.extensionOlderKept), (m) => warn(t("launcherWarning.extensionOlderKept", { name: m[1] }))],
  [warningRe(TEAM_WARNINGS.extensionNewerKept), (m) => warn(t("launcherWarning.extensionNewerKept", { name: m[1], mine: m[2], there: m[3] }))],
];

function showLauncherWarning(text: string) {
  for (const [re, say] of KNOWN) {
    const m = re.exec(text);
    if (m) { say?.(m); return; }
  }
  warn(t("launcherWarning.title"), text);
}

// Warnings the backend raises during a launch (a geo probe that failed and
// left the profile on UTC, say) and about team and synced profiles. stderr is
// not a place a user looks, so they arrive as a toast.
export function useLauncherWarning() {
  useEffect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    listen<string>("launcher-warning", (e) => showLauncherWarning(e.payload)).then((fn) => {
      if (disposed) fn();
      else un = fn;
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, []);
}
