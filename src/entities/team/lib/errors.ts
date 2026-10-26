import { t } from "../../../shared/i18n";
import { explainError, rawError } from "../../../shared/lib/errors";
import { TEAM_REFUSALS } from "../../../shared/api/teamRefusals";

// A team command rejects with the team server's own words (TeamError's text,
// or join's): the ones known here become one translated sentence.
// Each key called literally, so the i18n check sees it.
const KNOWN: ReadonlyArray<readonly [RegExp, () => string]> = [
  [/\bthe folder is not empty\b/i, () => t("team.errFolderNotEmpty")],
  [/\bdeleted profiles wait in the trash\b/i, () => t("team.errFolderTrash")],
  [/\ba folder of that name is already there\b/i, () => t("team.errFolderTaken")],
  [/\bnot a server address\b/i, () => t("team.errBadServer")],
  [/\bdoes not know this token\b|\bthis route needs a token\b/i, () => t("team.errUnknownToken")],
  [/\bswitched off\b/i, () => t("team.errSwitchedOff")],
  // It answered, but not as a team server (client.rs): never "didn't answer".
  [/\bdid not answer as a team server\b/i, () => t("team.errNotTeamServer")],
  // The encrypted link to it (client.rs WireFault, and the vouch).
  [/\bdoes not answer as an encrypted team server\b/i, () => t("team.errNotEncrypted")],
  [/\bis a newer team server than this launcher\b/i, () => t("team.errServerNewer")],
  [/\bis not this team.s server: it shows another key\b/i, () => t("team.errOtherKey")],
  [/\bcould not prove it is the server this token is from\b|\bchecks permissions with another key\b/i, () => t("team.errUnproven")],
  [/\bdid not answer\b/i, () => t("team.errOffline")],
  [/\bnot an? (?:ShardBrowser|Octopus Agent) team server\b|\bgave no key to check permissions\b/i, () => t("team.errNotTeamServer")],
  [/\ba team name is 1 to 64 characters\b/i, () => t("team.errTeamName")],
  [/\ba name or label is too long\b/i, () => t("team.errTooLong")],
  [/^not allowed$|\bonly the team.s admin\b/i, () => t("team.errNotAdmin")],
  [/^no such thing$/i, () => t("team.errGone")],
];

const TAG_TAKEN = new RegExp(`^${TEAM_REFUSALS.trashTagTaken("(.+)")}$`);

/** A trash refusal: "not allowed" there is a member's missing Delete, not the admin's door. */
export function trashError(e: unknown): string {
  const raw = rawError(e)?.trim() ?? "";
  if (raw === TEAM_REFUSALS.trashNotAllowed) return t("team.trashNotAllowed", { right: t("team.actDelete") });
  const tag = TAG_TAKEN.exec(raw);
  if (tag) return t("team.trashTagNameTaken", { name: tag[1] });
  return teamError(e);
}

/** A team refusal in words a person can act on; anything else as the app says other errors. */
export function teamError(e: unknown): string {
  const raw = rawError(e);
  if (raw) for (const [re, key] of KNOWN) if (re.test(raw)) return key();
  return explainError(e) ?? t("team.errUnknown");
}
