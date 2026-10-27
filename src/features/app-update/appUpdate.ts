import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "../../shared/model/toast";
import { notifySystem } from "../../shared/lib/notify";
import { translate, useLang } from "../../shared/i18n";
import { confirmModal } from "../../shared/model/confirm";
import { useProfile } from "../../entities/profile";

type Phase = "idle" | "checking" | "closing" | "downloading" | "installing" | "error";

type State = {
  /** A newer release on GitHub, found by the last check. */
  available: { version: string; notes: string } | null;
  phase: Phase;
  /** 0 to 100 while it downloads; null when the size is unknown. */
  percent: number | null;
  error: string | null;
  /** When the last check answered, for "Up to date". */
  checkedAt: number | null;
};

/// The launcher's own updates: every release published on GitHub
/// (harindujayakody/octopus-agent) carries a signed `latest.json`, which the
/// updater reads. A newer one is announced once, in the app and as a system
/// notification; Install and restart downloads it, checks its signature,
/// installs it and starts the new version.
export const useAppUpdate = create<State>(() => ({ available: null, phase: "idle", percent: null, error: null, checkedAt: null }));

let pending: Update | null = null;

const t = (key: string, vars?: Record<string, string | number>) => translate(useLang.getState().lang, key, vars);

/** The versions already announced, so each one is announced once. */
const SEEN_KEY = "octopus.appUpdateSeen";

/** Asks GitHub for a newer release. `notify`: say so when there is one. */
export async function checkAppUpdate(opts: { notify: boolean }): Promise<void> {
  const { phase } = useAppUpdate.getState();
  if (phase === "closing" || phase === "downloading" || phase === "installing") return;
  useAppUpdate.setState({ phase: "checking", error: null });
  try {
    const update = await check();
    if (!update) {
      useAppUpdate.setState({ phase: "idle", available: null, checkedAt: Date.now() });
      return;
    }
    if (pending && pending !== update) void pending.close().catch(() => {});
    pending = update;
    useAppUpdate.setState({ phase: "idle", available: { version: update.version, notes: update.body ?? "" }, checkedAt: Date.now() });
    let seen: string | null = null;
    try { seen = localStorage.getItem(SEEN_KEY); } catch { /* private mode */ }
    if (!opts.notify || seen === update.version) return;
    try { localStorage.setItem(SEEN_KEY, update.version); } catch { /* private mode */ }
    const title = t("appUpdate.ready", { v: update.version });
    toast.info(title, { action: { label: t("appUpdate.install"), run: () => { void installAppUpdate(); } } });
    void notifySystem(title, t("appUpdate.readyBody"));
  } catch (e) {
    // Offline, or not the desktop app: nothing to say unless asked.
    useAppUpdate.setState({ phase: opts.notify ? "idle" : "error", error: String(e instanceof Error ? e.message : e) });
    return;
  }
}

/** How long open profiles get to close before the install gives up. */
const CLOSE_WAIT_MS = 60_000;

/// Open profiles are closed first, as their windows' close button would (cookies,
/// tabs and logins saved), after asking with their names. False when the person
/// said no, or one would not close.
async function closeOpenProfiles(): Promise<boolean> {
  const store = useProfile.getState();
  const open = store.profiles.filter((p) => store.running[p.id] !== undefined);
  if (open.length === 0) return true;
  const ok = await confirmModal({
    title: open.length === 1 ? t("appUpdate.closeTitleOne") : t("appUpdate.closeTitleMany", { n: open.length }),
    message: t("appUpdate.closeHelp"),
    items: open.map((p) => ({ label: p.name })),
    confirmLabel: t("appUpdate.closeConfirm"),
  });
  if (!ok) return false;
  useAppUpdate.setState({ phase: "closing", error: null });
  await store.stopMany(open.map((p) => p.id));
  const until = Date.now() + CLOSE_WAIT_MS;
  while (Date.now() < until) {
    const running = useProfile.getState().running;
    if (open.every((p) => running[p.id] === undefined)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  useAppUpdate.setState({ phase: "idle" });
  toast.fail({ title: t("appUpdate.closeFailed") });
  return false;
}

/** Closes open profiles, then downloads, verifies and installs the update found and restarts into it. */
export async function installAppUpdate(): Promise<void> {
  if (!pending) await checkAppUpdate({ notify: false });
  const update = pending;
  if (!update) return;
  if (!(await closeOpenProfiles())) return;
  let total = 0;
  let got = 0;
  useAppUpdate.setState({ phase: "downloading", percent: null, error: null });
  try {
    await update.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        useAppUpdate.setState({ percent: total > 0 ? Math.min(100, Math.round((got / total) * 100)) : null });
      } else useAppUpdate.setState({ phase: "installing" });
    });
    await relaunch();
  } catch (e) {
    useAppUpdate.setState({ phase: "error", error: String(e instanceof Error ? e.message : e) });
    toast.fail({ title: t("appUpdate.failed"), detail: e });
  }
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
let started = false;

/** Checks a little after start, then every six hours while the launcher stays open. */
export function startAppUpdateChecks(): void {
  if (started) return;
  started = true;
  setTimeout(() => void checkAppUpdate({ notify: true }), 15_000);
  setInterval(() => void checkAppUpdate({ notify: true }), CHECK_EVERY_MS);
}
