import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "../../../shared/api/invoke";
import type { EngineId } from "../../../entities/profile";
import { toast } from "../../../shared/model/toast";
import { notifySystem } from "../../../shared/lib/notify";
import { translate, useLang } from "../../../shared/i18n";

export type StockEngine = Exclude<EngineId, "shardx">;

/** A stock browser and where this computer has it (engines.rs `Found`). */
export type FoundEngine = {
  id: StockEngine;
  name: string;
  path: string | null;
  /** Installed by the launcher (the Browsers page): it can update and remove it. */
  managed: boolean;
  /** The installed version, when the launcher installed it. */
  version: string | null;
};

/** One download under way, or how the last one ended. */
export type EngineDownload = { phase: "download" | "extract"; percent: number } | { error: string };

type State = {
  /** null until asked. */
  found: FoundEngine[] | null;
  downloads: Partial<Record<StockEngine, EngineDownload>>;
  /** The newest version each vendor publishes, from the last update check. */
  latest: Partial<Record<StockEngine, string>>;
  /** Removals under way. */
  removing: Partial<Record<StockEngine, boolean>>;
};

/// Which stock engines this computer has, the downloads under way and the
/// newest versions out. Kept outside the editor and the Browsers page, so
/// closing either leaves a download running and reopening shows where it is.
export const useEngines = create<State>(() => ({ found: null, downloads: {}, latest: {}, removing: {} }));

const t = (key: string, vars?: Record<string, string | number>) => translate(useLang.getState().lang, key, vars);

const setDownload = (id: StockEngine, d: EngineDownload | undefined) =>
  useEngines.setState((s) => {
    const downloads = { ...s.downloads };
    if (d) downloads[id] = d;
    else delete downloads[id];
    return { downloads };
  });

const putFound = (got: FoundEngine) =>
  useEngines.setState((s) => ({ found: [...(s.found ?? []).filter((e) => e.id !== got.id), got] }));

let listening = false;

/** Asks the backend again which engines it can find, and follows download progress. */
export function detectEngines(): Promise<void> {
  if (!listening) {
    listening = true;
    listen<{ id: StockEngine; phase: "download" | "extract"; percent: number }>("engines:progress", (e) => {
      const { id, phase, percent } = e.payload;
      const cur = useEngines.getState().downloads[id];
      if (cur && "error" in cur) return;
      setDownload(id, { phase, percent });
    }).catch(() => { listening = false; });
  }
  return invoke<FoundEngine[]>("engines_detect")
    .then((found) => useEngines.setState({ found }))
    .catch(() => useEngines.setState({ found: [] }));
}

export const isMissing = (found: FoundEngine[] | null, id: EngineId) =>
  id !== "shardx" && found !== null && !found.some((e) => e.id === id && e.path);

/** A newer version is out for the launcher's own copy of `id`. */
export const hasUpdate = (s: Pick<State, "found" | "latest">, id: StockEngine) => {
  const e = s.found?.find((x) => x.id === id);
  const latest = s.latest[id];
  return !!e?.managed && !!latest && !!e.version && latest !== e.version;
};

/** Installs `id` into the launcher's folder, or updates the copy there; a second ask while one runs does nothing. */
export async function downloadEngine(id: StockEngine) {
  const cur = useEngines.getState().downloads[id];
  if (cur && !("error" in cur)) return;
  setDownload(id, { phase: "download", percent: 0 });
  try {
    putFound(await invoke<FoundEngine>("engines_install", { id }));
    setDownload(id, undefined);
  } catch (e) {
    setDownload(id, { error: String(e instanceof Error ? e.message : e) });
  }
}

/** Removes the launcher's own copy of `id`. A copy installed elsewhere stays. */
export async function removeEngine(id: StockEngine): Promise<boolean> {
  useEngines.setState((s) => ({ removing: { ...s.removing, [id]: true } }));
  try {
    putFound(await invoke<FoundEngine>("engines_remove", { id }));
    return true;
  } catch (e) {
    toast.fail({ title: t("browsers.removeFailed"), detail: e });
    return false;
  } finally {
    useEngines.setState((s) => ({ removing: { ...s.removing, [id]: false } }));
  }
}

/** The versions a notification was already shown for, so each update is announced once. */
const SEEN_KEY = "octopus.browserUpdatesSeen";
const seen = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") ?? {}; } catch { return {}; }
};
const markSeen = (id: StockEngine, v: string) => {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ ...seen(), [id]: v })); } catch { /* private mode */ }
};

/// Asks each vendor for its newest version of the browsers the launcher
/// installed. A newer one is announced once, in the app and as a system
/// notification, with Update beside it; the Browsers page shows it until it
/// is installed.
export async function checkEngineUpdates(opts: { notify: boolean; onOpen?: () => void }): Promise<void> {
  await detectEngines();
  const managed = (useEngines.getState().found ?? []).filter((e) => e.managed);
  for (const e of managed) {
    let latest: string;
    try {
      latest = await invoke<string>("engines_latest", { id: e.id });
    } catch {
      continue;
    }
    useEngines.setState((s) => ({ latest: { ...s.latest, [e.id]: latest } }));
    if (!opts.notify || !hasUpdate(useEngines.getState(), e.id) || seen()[e.id] === latest) continue;
    markSeen(e.id, latest);
    const title = t("browsers.updateReady", { name: e.name, v: latest });
    toast.info(title, { action: { label: t("browsers.update"), run: () => { void downloadEngine(e.id); } } });
    void notifySystem(title, t("browsers.updateReadyBody", { name: e.name }));
  }
}

/** How often the launcher asks again while it stays open. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
let checking = false;

/** Checks for browser updates a little after start, then every six hours. */
export function startEngineUpdateChecks(): void {
  if (checking) return;
  checking = true;
  setTimeout(() => void checkEngineUpdates({ notify: true }), 30_000);
  setInterval(() => void checkEngineUpdates({ notify: true }), CHECK_EVERY_MS);
}
