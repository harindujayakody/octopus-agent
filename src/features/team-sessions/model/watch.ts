import { listen } from "@tauri-apps/api/event";
import { t } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { TEAM_WARNINGS, warningRe } from "../../../shared/api/backendWarnings";
import { TEAM_SESSION, type SessionEnded } from "../../../entities/space";
import { useProfile } from "../../../entities/profile";

/** How long a warning naming a profile, or its failed start, explains how its session ended. */
const EXPLAINED_MS = 15_000;
/** A discarded session waits this long for what may explain it (a start's failure lands later). */
const SETTLE_MS = 1_500;
/** Saves told within this long of each other are said in one toast. */
const BATCH_MS = 800;

// Warnings that already say why a profile's session was not kept, the profile's name first.
const NAMED = [TEAM_WARNINGS.stale, TEAM_WARNINGS.unsent, TEAM_WARNINGS.notSaved, TEAM_WARNINGS.lostLease].map((w) => warningRe(w));
const WITHDREW = warningRe(TEAM_WARNINGS.withdrew);

/// What became of a team profile's session as its browser closed (team step 7). Saved
/// and kept are said here. A stale or unsent one is said by its launcher warning, which
/// gives the reason. A discarded one is said only when nothing else explained it.
export function watchTeamSessions(): () => void {
  const warned = new Map<string, number>();
  let withdrawnAt = 0;
  let saved: string[] = [];
  let flush: ReturnType<typeof setTimeout> | undefined;
  let gone = false;
  const offs: (() => void)[] = [];
  const keep = (p: Promise<() => void>) => void p.then((fn) => { if (gone) fn(); else offs.push(fn); }).catch(() => {});

  const sayDiscarded = (e: SessionEnded) => {
    const now = Date.now();
    const failed = useProfile.getState().startFailed[e.profile_id] ?? 0;
    const explained = [warned.get(e.name) ?? 0, withdrawnAt, failed].some((at) => now - at < EXPLAINED_MS);
    if (!explained) toast.warn({ title: t("teamSession.discardedTitle", { name: e.name }), detail: t("teamSession.discardedDetail") });
  };
  const saySaved = () => {
    flush = undefined;
    const names = saved;
    saved = [];
    if (names.length === 1) toast.saved(t("teamSession.saved", { name: names[0] }));
    else if (names.length > 1) toast.saved(t("teamSession.savedMany", { n: names.length }));
  };

  keep(listen<string>("launcher-warning", (e) => {
    if (typeof e.payload !== "string") return;
    if (WITHDREW.test(e.payload)) { withdrawnAt = Date.now(); return; }
    for (const re of NAMED) {
      const m = re.exec(e.payload);
      if (m) { warned.set(m[1], Date.now()); return; }
    }
  }));
  keep(listen<SessionEnded>(TEAM_SESSION, (e) => {
    const s = e.payload;
    if (!s || gone) return;
    if (s.outcome === "saved") {
      saved.push(s.name);
      flush ??= setTimeout(saySaved, BATCH_MS);
    } else if (s.outcome === "kept") {
      toast.info(t("teamSession.keptTitle", { name: s.name }), { detail: t("teamSession.keptDetail") });
    } else if (s.outcome === "discarded") {
      setTimeout(() => { if (!gone) sayDiscarded(s); }, SETTLE_MS);
    }
  }));
  return () => {
    gone = true;
    clearTimeout(flush);
    for (const fn of offs) fn();
  };
}
