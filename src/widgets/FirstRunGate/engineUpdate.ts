import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { t, type T } from "../../shared/i18n";
import { fmtBytes } from "../../shared/lib/format";
import { confirmModal } from "../../shared/model/confirm";
import { toast } from "../../shared/model/toast";
import { useProfile } from "../../entities/profile";
import type { RtFailed, RtInstallError, RtProgress, RtStatus } from "../../shared/types";

/** Two sentences: no space after a full-width stop (Chinese "。"). */
export const joined = (a: string, b: string) => (/[。！？]$/.test(a) ? a + b : `${a} ${b}`);

/** Why the update stopped, in words; each key called literally. The space
 *  numbers and leftover browsers are only in the message. */
export function reason(t: T, e: RtInstallError): string {
  if (e.stage === "busy") {
    if (e.starting > 0) return t("engineUpdate.busyStarting");
    const why = e.running_browsers === 1 ? t("engineUpdate.busyOne")
      : e.running_browsers > 1 ? t("engineUpdate.busy", { n: e.running_browsers })
        : t("engineUpdate.busyLeftover");
    return /\bleft from an earlier session\b/i.test(e.message) ? joined(why, t("engineUpdate.busyUntracked")) : why;
  }
  switch (e.stage) {
    case "space": {
      const mb = /needs about (\d+) MB, and (\d+) MB is free/.exec(e.message);
      return mb ? t("engineUpdate.spaceNeeds", { need: fmtBytes(Number(mb[1]) * 2 ** 20), free: fmtBytes(Number(mb[2]) * 2 ** 20) }) : t("engineUpdate.space");
    }
    case "download": return t("engineUpdate.download");
    case "swap": return t("engineUpdate.swap");
    default: return t("engineUpdate.unpack");
  }
}

/// An engine update that stopped with the previous engine kept (#122): the
/// app opens on that engine and a banner over the pages says why.
type EngineUpdate = {
  error: RtInstallError | null;
  staged: boolean;
  /** Try again from the banner is under way. */
  retrying: boolean;
  progress: RtProgress | null;
};
export const useEngineUpdate = create<EngineUpdate>(() => ({ error: null, staged: false, retrying: false, progress: null }));

/** The stop with the engine kept that a status names, else null. */
const stopIn = (s: RtStatus) => (s.installed && s.install_error?.engine_kept ? s.install_error : null);

// The engine last seen installed (its archive etag): a try that moved it put a new one in.
let seen: string | null | undefined;

/** A status read: the engine it names. */
export function noteSeen(s: RtStatus): void {
  seen = s.installed_browser_etag;
}

/** The banner as a status leaves it: shown only while the engine it kept is there. */
export function noteStatus(s: RtStatus): void {
  noteSeen(s);
  const error = stopIn(s);
  useEngineUpdate.setState({ error, staged: !!error && s.update_staged });
}

// What the install call under way was told by event. Its status reads the
// manifest again and, offline, drops the stop (runtime.rs runtime_status).
let told: RtInstallError | null = null;

/** runtime:failed. */
export function noteFailed(e: RtFailed): void {
  told = e;
  if (e.engine_kept) useEngineUpdate.setState({ error: e, staged: e.update_staged });
}

/** runtime_install, and what it came to: the stop (its status's, else the one
 *  told), and whether a new engine went in. runtime:done says neither: it
 *  comes as well when the manifest could not be read and nothing was tried. */
export async function installEngine(): Promise<{ status: RtStatus; stop: RtInstallError | null; moved: boolean }> {
  told = null;
  const before = seen;
  const status = await invoke<RtStatus>("runtime_install", { force: false });
  // Set by the event while the call ran.
  const heard = told as RtInstallError | null;
  const stop = stopIn(status) ?? (heard?.engine_kept ? heard : null);
  if (stop === stopIn(status)) noteStatus(status);
  else noteSeen(status);
  return { status, stop, moved: before !== undefined && status.installed_browser_etag !== before };
}

/** Stops a new try at start would meet again: tried again by hand only. */
const BY_HAND = new Set<RtInstallError["stage"]>(["space", "verify"]);

/** The update stopped on one of those, and it is still the one offered. */
export const waitsForHand = (s: RtStatus): boolean =>
  s.installed && s.update_available && !!s.install_error?.engine_kept
  && BY_HAND.has(s.install_error.stage) && s.install_error.target === s.remote_browser_etag;

/** Stops the running profiles, asked with their names; the banner then tries
 *  the update again by itself once the last one closes. */
export async function stopAndFinish(): Promise<void> {
  const s = useProfile.getState();
  const ids = Object.keys(s.running).filter((id) => s.running[id]);
  const ok = await confirmModal({
    title: t("engineUpdate.stopTitle"),
    message: t("engineUpdate.stopHelp"),
    items: s.profiles.filter((p) => ids.includes(p.id)).map((p) => ({ label: p.name })),
    confirmLabel: t("extensions.stopConfirm"),
  });
  if (ok) await useProfile.getState().stopMany(ids);
}

/** Try again: at once when the update is staged, else downloaded first, its
 *  progress in the banner. `quiet`: a try nobody pressed reports no failure. */
export async function retryEngineUpdate(quiet = false): Promise<void> {
  const was = useEngineUpdate.getState();
  if (was.retrying) return;
  useEngineUpdate.setState({ retrying: true, progress: null });
  try {
    const r = await installEngine();
    if (r.stop) {
      // The same stop again changes nothing on screen: a toast says it was tried.
      if (!quiet && r.stop.stage === was.error?.stage) toast.fail({ title: t("engineUpdate.failed"), detail: reason(t, r.stop) });
    } else if (r.moved) {
      // The gate's runtime:done has the profile store read the library again.
      toast.ok(t("engineUpdate.done"));
    } else if (r.status.update_available || r.status.remote_browser_etag === null) {
      // No new engine and no stop: the update server was out of reach.
      useEngineUpdate.setState({ error: was.error, staged: was.staged });
      if (!quiet) toast.fail({ title: t("engineUpdate.failed"), detail: t("engineUpdate.download") });
    }
    // Else the update is no longer offered: the banner goes, with nothing to say.
  } catch (e) {
    if (!quiet) toast.fail({ title: t("engineUpdate.failed"), detail: e });
  } finally {
    useEngineUpdate.setState({ retrying: false, progress: null });
  }
}
