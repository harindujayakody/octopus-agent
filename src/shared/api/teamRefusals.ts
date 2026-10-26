/// A team space's refusals in the backend's own words (space/error.rs, space/mod.rs,
/// space/items.rs): the mock words its refusals with these, and the app reads them back.
/// Kept free of imports, so `npm run test:unit` checks them against the Rust sources.

export const TEAM_REFUSALS = {
  /** A door the team space does not have (NOT_IN_TEAM). */
  notInTeam: "not offered in a team space",
  /** A door a team's profiles do not have yet: cookies, temporary ones (TEAM_NOT_YET). */
  teamNotYet: "not offered for a team's profiles yet",
  /** A write only this machine's own profiles take (PERSONAL_ONLY). */
  personalOnly: "not offered in a team space yet: this writes only your own profiles",
  /** The team's rules do not give it (CmdError::Forbidden): "take_out" reads "take out". */
  forbidden: (right: string, on: string) => `not allowed in this team: needs ${right.replace("_", " ")} on the ${on}`,
  /** Not in the space in use, or hidden from this member (CmdError::Missing). */
  missing: (what: string, id: string) => `no ${what} ${id} in this team`,
  /** Another device holds its lease (CmdError::Leased). */
  leased: (device: string) => `this profile is open on ${device}: close it there first`,
  /** A team keeps extensions up to 64 MB packed (items.rs PACKAGE_MAX). */
  extensionTooBig: (mb: number, max = 64) => `this extension is ${mb} MB packed; a team keeps extensions up to ${max} MB`,
  /** A switch of space refused while a profile starts, or the data moves; a start while it switches (space/mod.rs). */
  switchWhileStarting: "a profile is starting: switch spaces once it has started",
  switchWhileMoving: "Octopus Agent is moving or resetting its data: switch spaces when that finishes",
  launchWhileSwitching: "the launcher is switching spaces: start the profile again in a moment",
  /** Still opening or being saved here, or a dead launcher's guard still closing it (open.rs BUSY). */
  busy: "this profile is still opening or being saved here: start it again in a moment",
  /** Delete all data and moving the data wait for these (open.rs STILL_OPEN). */
  stillOpen: "A team profile is open or being saved here. Close it, wait until it is saved, then try again.",
  /** The process that closes a team or synced profile if the launcher dies did not start (open.rs). */
  guardFailed: (why: string) => `the profile's guard process did not start: ${why}`,
  /** The team server keeps a folder while its deleted profiles wait in the team's trash (team-server api.rs). */
  folderInTrash: "the folder's deleted profiles wait in the trash",
  /** Updates of a team's extensions are not offered yet (space/mod.rs TEAM_UPDATES_NOT_YET). */
  teamExtensionsNotYet: "not offered for a team's extensions yet",
  /** The team server's trash: gone or unseen, and seen without Delete where it was (team-server api.rs). */
  trashGone: "no such thing",
  trashNotAllowed: "not allowed",
  /** A tag restored while a live one has its name, any case (space/admin.rs `tag_name_free`). */
  trashTagTaken: (name: string) => `a tag named ${name} already exists`,
  /** A proxy the writer may not use, bound to a team profile (team-server api.rs `bad_proxy`). */
  badProxy: "no such proxy to bind",
  /** Saved by someone else since it was read (CmdError::Stale). */
  stale: (what: string, now: number, had: number) =>
    `This ${what} changed after you opened it (rev ${now}, you have ${had}) — someone else saved it. Reopen it and apply your changes to the current version.`,
} as const;

/** `forbidden` read back: the right, and what it is held on. */
export const FORBIDDEN_RE = /\bnot allowed in this team: needs ([a-z ]+?) on the (profile|folder|team|proxy)\b/i;
/** `extensionTooBig` read back: the size, and the most a team keeps. */
export const EXTENSION_TOO_BIG_RE = /\bthis extension is (\d+) MB packed; a team keeps extensions up to (\d+) MB\b/i;
