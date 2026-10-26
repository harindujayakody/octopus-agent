import { t } from "../../../shared/i18n";
import { rawError } from "../../../shared/lib/errors";
import { teamError } from "../../team/lib/errors";
import { SYNC_REFUSALS } from "../model/types";
import { refusal } from "./refusals";

// The sync commands' own refusals; the server's words are the team server's,
// which teamError already knows. Each key called literally, for the i18n check.
const KNOWN: ReadonlyArray<readonly [RegExp, (m: RegExpExecArray) => string]> = [
  [refusal(SYNC_REFUSALS.alreadyConnected), () => t("sync.errConnected")],
  [refusal(SYNC_REFUSALS.notConnected), () => t("sync.errNotConnected")],
  [refusal(SYNC_REFUSALS.notMember), () => t("sync.errNoTeam")],
  [refusal(SYNC_REFUSALS.noAnswer), () => t("sync.errOffline")],
  // It answered, but not as a team server (client.rs): the app's own words for it.
  [/\bdid not answer as a team server\b/i, () => t("team.errNotTeamServer")],
  [/\bdid not answer\b/i, () => t("sync.errOffline")],
  [refusal(SYNC_REFUSALS.removed), () => t("sync.errRemoved")],
  [refusal(SYNC_REFUSALS.deviceName), () => t("sync.errDeviceName")],
  [refusal(SYNC_REFUSALS.leasedStop), (m) => t("profileSync.errLeasedStop", { device: m[1] })],
  // Why a sync stopped short (SYNC_STOPS), as the status line says it.
  [/\bnone of the synced profiles is on this computer any more\b/i, () => t("sync.errVanished")],
  [/\bon this computer could not be read\b/i, () => t("sync.errUnreadable")],
];

/// A sync refusal in words a person can act on. `own`: the person runs the
/// server (undefined before connecting), which decides whom a token goes to.
export function syncError(e: unknown, own?: boolean): string {
  const raw = rawError(e);
  if (raw) {
    for (const [re, say] of KNOWN) {
      const m = re.exec(raw);
      if (m) return say(m);
    }
    if (/\bdoes not know this token\b/i.test(raw)) {
      if (own === true) return t("sync.errTokenOwn");
      if (own === undefined) return t("sync.errToken");
    }
  }
  return teamError(e);
}
