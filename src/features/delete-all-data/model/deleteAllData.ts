import { appReset, appResetFinish, appResetKeepStorage, appResetSetAside, appResetUndo, appRestart } from "../../../entities/settings";
import { rawError } from "../../../shared/lib/errors";

/** Every key the app keeps in this window's storage starts with it: the
 *  app's own ("shardx." and "shardx-": onboarding, Views, list layouts, the
 *  language, size and motion) and the kit's theme ("shardx-ui-kit-theme"). */
const PREFIX = "shardx";

/** reset.rs's words, exactly, when the disk no longer matches the plan shown. */
const CHANGED = "Your data changed. Check again.";
/** reset.rs's start for the one failure it could not undo. */
const STUCK = "Some data is still in";
/** reset.rs's start for a refusal, or a failure it undid. */
const NOTHING = /^Nothing was moved:\s*/;

/** The app's keys and their values. Blocked storage holds none. */
function appStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) out[key] = localStorage.getItem(key) ?? "";
    }
  } catch { /* blocked storage: nothing kept there */ }
  return out;
}

/** Whether the keys may go: they were written into the backup (or there were
 *  none). Views live only here, so a copy that could not be written keeps
 *  them where they are rather than delete them. */
let storageKept = true;

/** Takes the app's keys out of storage. Blocked storage holds none to take. */
function takeAppStorage(): void {
  if (!storageKept) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch { /* blocked storage: nothing kept there */ }
}

/** Delete all data for the plan shown: the backend moves the data into
 *  backup folders and names them. This window's own keys go only once that
 *  worked: a refusal, or a reset stopped half way, leaves them as they were. */
export async function moveAllData(planId: string): Promise<string[]> {
  const { backups } = await appReset(planId);
  const items = appStorage();
  storageKept = Object.keys(items).length === 0;
  if (!storageKept && backups[0]) {
    try {
      await appResetKeepStorage(backups[0], items);
      storageKept = true;
    } catch (e) {
      console.error("reset: window storage not written to the backup; kept in place", e);
    }
  }
  takeAppStorage();
  return backups;
}

/** Starts over: the keys once more (the page may have written some since),
 *  then the restart. The browser preview's mock answers, and the page reloads. */
export async function restartFresh(): Promise<void> {
  takeAppStorage();
  await appRestart();
  window.location.reload();
}

/** How a reset failed: the plan no longer matches ("changed"), it could not
 *  put everything back ("stuck"), or it refused or undid itself ("nothing"),
 *  with the reason to show. */
export function failureOf(e: unknown): { kind: "changed" | "stuck" | "nothing"; reason: string } {
  const raw = rawError(e) ?? "";
  if (raw === CHANGED) return { kind: "changed", reason: raw };
  if (raw.startsWith(STUCK)) return { kind: "stuck", reason: raw };
  const reason = raw.replace(NOTHING, "");
  return { kind: "nothing", reason: reason.charAt(0).toUpperCase() + reason.slice(1) };
}

/** "Undo the reset" on the start screen: everything back, then a restart
 *  onto the app as it was (its keys were never taken). */
export async function undoUnfinished(): Promise<void> {
  await appResetUndo();
  await appRestart();
  window.location.reload();
}

/** "Finish the reset": the moves that were left, then a first start. */
export async function finishUnfinished(): Promise<void> {
  await appResetFinish();
  await restartFresh();
}

/** "Set these notes aside": the journal renamed, never deleted, then a
 *  restart onto the app (its keys were never taken). */
export async function setNotesAside(): Promise<void> {
  await appResetSetAside();
  await appRestart();
  window.location.reload();
}
