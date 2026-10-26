import { intlLocale, translate, type Lang } from "../../../shared/i18n";
import { fmtDuration } from "../../../shared/lib/format";
import { stampMs } from "../../../shared/lib/utils";
import type { StatusDotTone } from "../../../shared/ui/StatusDot";
import type { ProfileMeta } from "../model/types";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// `Intl.DateTimeFormat` construction is not free, and every row that has run
// before builds one (the date fallback, or the exact-time hover/sr-only
// text). There are only ever a handful of distinct (locale, options) pairs
// across the whole app, so one cache for the module's lifetime is enough.
const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = dtfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    dtfCache.set(key, f);
  }
  return f;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/// "12 min ago" / "3 h ago" / "Yesterday" / "4 days ago" / "Aug 29" (or "Oct
/// 2025" in another year), in the UI language. Explicit i18n templates, not
/// `Intl.RelativeTimeFormat` — the controller's ruling: Intl's own wording
/// ("12 minutes ago") doesn't let the column stay this narrow, and a fixed
/// template is easier to audit for every language than trusting each
/// locale's CLDR data to come out short. `Math.floor` at every bucket edge:
/// 59.9 min reads "59 min ago", never "60 min ago" a bucket early.
///
/// A run under 24 h always shows hours, even one that crossed midnight —
/// 11pm yesterday to noon today is 13 h ago, not "Yesterday". Only past 24 h
/// does "how long ago" give way to "which day": the previous calendar day is
/// "Yesterday", the six days before that are "N days ago", and older drops
/// to a plain date (month + day, or month + year once it's a different
/// year — a run that stale doesn't need its exact day).
export function formatRelativeRun(atMs: number, nowMs: number, lang: Lang): string {
  const t = (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);
  const elapsed = Math.max(0, nowMs - atMs);
  if (elapsed < MINUTE) return t("profileRow.statusJustNow");
  if (elapsed < HOUR) return t("profileRow.statusMinutesAgo", { n: Math.floor(elapsed / MINUTE) });
  if (elapsed < DAY) return t("profileRow.statusHoursAgo", { n: Math.floor(elapsed / HOUR) });
  const dayDiff = Math.floor((startOfDay(nowMs) - startOfDay(atMs)) / DAY);
  if (dayDiff <= 1) return t("profileRow.statusYesterday");
  if (dayDiff < 7) return t("profileRow.statusDaysAgo", { n: dayDiff });
  const locale = intlLocale(lang);
  const sameYear = new Date(atMs).getFullYear() === new Date(nowMs).getFullYear();
  const dtf = dateTimeFormat(locale, sameYear ? { month: "short", day: "numeric" } : { month: "short", year: "numeric" });
  return dtf.format(atMs);
}

/// The exact date and time of a run, for a hover tooltip and an sr-only
/// accessible name — the short relative label alone ("12 min ago") is not
/// enough for either.
export function formatExactRun(atMs: number, lang: Lang): string {
  return dateTimeFormat(intlLocale(lang), { dateStyle: "long", timeStyle: "short" }).format(atMs);
}

export type ProfileStatusTone = "running" | "starting" | "stopping" | "saving" | "failed" | "idle" | "never" | "warning" | "cancelled" | "elsewhere";

/// Owner feedback 5i: the one mapping from a Profile's status to its dot's
/// color, so the Status column, Peek's header, a pinned sidebar item and the
/// command palette never color the same state two different ways. "idle"
/// (a last run, no live session) is a filled neutral dot, not the outline —
/// the profile has a history; "never" (no `last_launched_at` at all) is the
/// outline, reserved for "nothing has happened here yet".
///
/// Task 8 ("Proxy missing") is mapped here too, as `warning`: the caller
/// passes `proxyMissing` (computed from the profile and the proxy list,
/// which `profileStatus` itself never sees) once it knows one. The Live
/// layer adds "stopping" (a Stop the poll has not confirmed yet) and
/// "failed" (a start that failed in this session, from the store's
/// `startFailed`: nothing about it is persisted), and "cancelled" (a start
/// the person cancelled a moment ago; the store forgets it after 3 s).
const DOT_OF_TONE: Record<ProfileStatusTone, StatusDotTone> = {
  running: "success",
  starting: "info",
  stopping: "info",
  saving: "info",
  failed: "error",
  idle: "neutral",
  never: "outline",
  warning: "warning",
  cancelled: "neutral",
  elsewhere: "info",
};

export type ProfileStatus = {
  tone: ProfileStatusTone;
  /** What the cell shows. */
  label: string;
  /** The dot color next to `label`, everywhere the word shows. */
  dot: StatusDotTone;
  /** The exact date and time a run finished (idle), or how long a running
   *  profile has been up — for a hover tooltip and an sr-only accessible
   *  name. Unset for "starting", "stopping", "cancelled", "failed" (the toast
   *  said why) and "never" (nothing more to say), and for "running" when the
   *  session's start time isn't available. */
  detail?: string;
};

/// The Profiles list's Status cell, in one function: a profile's starting,
/// cancelled, stopping or running state — the store's own truth, not on
/// `ProfileMeta` — takes priority, then a start that just failed, then the
/// proxy warning, then its last run. A later state (Task 8, "Proxy missing") is one more
/// branch here, not a new column.
export function profileStatus(
  profile: Pick<ProfileMeta, "last_launched_at" | "sync"> & Partial<Pick<ProfileMeta, "open_on">>,
  opts: {
    starting: boolean;
    /** `running[id]` from the store: the session's start time (ms epoch),
     *  or undefined when the profile isn't running. */
    runningSince: number | undefined;
    now: number;
    lang: Lang;
    /** Task 8: bound to a proxy that no longer exists (deleted here, through
     *  the API or in another window). Running, starting, stopping and a
     *  start that just failed still win — what is actually happening, or
     *  just happened — but everything else gives way to the warning:
     *  the profile cannot start again until this is fixed, which outranks
     *  how long ago it last ran. Required (fix round 1, item 7): every
     *  caller has a proxy list to check it against, and a caller that
     *  forgets it must not silently fall back to "never mapped". */
    proxyMissing: boolean;
    /** A Stop is under way: the store's `pending[id]?.kind === "stop"`. It
     *  outranks running, which the store already dropped for it. Required,
     *  like `proxyMissing` (Task 5): the row, Peek, a pinned sidebar item
     *  and the palette all pass it, so none of them says Running while the
     *  others say Stopping. */
    stopping: boolean;
    /** When a start of this profile last failed in this session (the
     *  store's `startFailed[id]`, ms epoch; undefined when none did). Shown
     *  only while the profile is not running and nothing launched it since:
     *  a later launch, here or anywhere the backend saw one, moves
     *  `last_launched_at` past it, and the poll's first sight of it running
     *  clears it. Required for the same reason as `stopping`. */
    failedAt: number | undefined;
    /** A start the person cancelled has just ended (the store's `cancelled`,
     *  which it forgets after 3 s). Outranks stopping and running: the
     *  profile is on its way down, and the word says why. Starting still
     *  wins, so a new start never reads Cancelled. Required, like `stopping`:
     *  every surface that names a state passes it. */
    cancelled: boolean;
    /** Its browser has closed and its session is still being sent to the team
     *  (`useSaving`): it cannot start again until that ends. */
    saving: boolean;
  },
): ProfileStatus {
  const { starting, runningSince, now, lang, proxyMissing, stopping, failedAt, cancelled, saving } = opts;
  const t = (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars);
  const of = (tone: ProfileStatusTone, label: string, detail?: string): ProfileStatus =>
    ({ tone, label, dot: DOT_OF_TONE[tone], ...(detail !== undefined ? { detail } : {}) });
  if (starting) return of("starting", t("status.starting"));
  if (cancelled) return of("cancelled", t("status.cancelled"));
  if (stopping) return of("stopping", t("status.stopping"));
  if (runningSince !== undefined) {
    const label = t("status.running");
    if (!Number.isFinite(runningSince)) return of("running", label);
    return of("running", label, t("profileRow.runningFor", { t: fmtDuration(now - runningSince, lang) }));
  }
  // A synced one goes to the sync server, not to a team.
  if (saving) return of("saving", t("status.saving"), profile.sync?.on ? t("profileRow.savingSyncDetail") : t("profileRow.savingDetail"));
  // Synced and open on another device: it cannot start here until it closes there.
  const lease = profile.sync?.on ? profile.sync.open_on : undefined;
  if (lease) {
    const seen = profile.sync?.seen_at;
    const detail = seen === undefined ? t("profileRow.openOnDetail", { device: lease })
      : t("profileRow.openOnSeen", { device: lease, when: formatRelativeRun(seen * 1000, now, lang) });
    return of("elsewhere", t("status.openOn", { device: lease }), detail);
  }
  // A team profile another device has open: it starts here once it is closed there.
  const held = profile.open_on && !profile.open_on.this_device ? profile.open_on : undefined;
  if (held) {
    const device = held.device_name || t("rights.anotherDevice");
    const who = held.member_name ? t("rights.openOnBy", { device, member: held.member_name }) : t("rights.openOn", { device });
    const detail = held.since > 0 ? t("profileRow.teamOpenSince", { who, when: formatRelativeRun(held.since * 1000, now, lang) }) : t("profileRow.teamOpenDetail", { who });
    return of("elsewhere", t("status.openOn", { device }), detail);
  }
  const at = stampMs(profile.last_launched_at);
  if (failedAt !== undefined && (at === null || failedAt > at)) return of("failed", t("status.failedToStart"));
  if (proxyMissing) {
    // The exact date here must not read as "when the proxy went missing" —
    // it is the last time this profile ran, same date an idle row's detail
    // would show, so it needs its own "Last run" wording (fix round 1, item
    // 4). With no run at all, the hint itself is the more useful detail:
    // what to do about it, not "nothing has happened yet".
    const detail = at === null ? t("profileRow.proxyMissingHint") : t("profileRow.proxyMissingLastRun", { t: formatExactRun(at, lang) });
    return of("warning", t("profileRow.proxyMissing"), detail);
  }
  if (at === null) return of("never", t("status.neverRun"));
  return of("idle", formatRelativeRun(at, now, lang), formatExactRun(at, lang));
}
