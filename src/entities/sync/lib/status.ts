import type { ProfileSync, SyncStatus } from "../model/types";

type T = (key: string, vars?: Record<string, string | number>) => string;

/** How the status line draws: a dot tone and its word, never the tone alone. */
export type SyncLine = { tone: "ok" | "busy" | "offline" | "error"; title: string; detail?: string };

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

/** The Sync tab's status line. `now` and `last_sync_at` are unix seconds; `t` translates. */
export function syncLine(status: SyncStatus, now: number, t: T, fmtDate: (secs: number) => string): SyncLine {
  const waiting = status.pending === 1 ? t("sync.waitingOne") : status.pending > 1 ? t("sync.waitingMany", { n: status.pending }) : undefined;
  if (status.state === "syncing") return { tone: "busy", title: t("sync.statusSyncing"), detail: waiting };
  if (status.state === "offline") {
    if (status.pending === 0) return { tone: "offline", title: t("sync.statusOffline"), detail: t("sync.offlineNothing") };
    const title = status.pending === 1 ? t("sync.offlineOne") : t("sync.offlineMany", { n: status.pending });
    return { tone: "offline", title, detail: t("sync.offlineLater") };
  }
  if (status.state === "error") return { tone: "error", title: t("sync.statusError") };
  const at = status.last_sync_at;
  if (at === undefined) return { tone: "ok", title: t("sync.statusNever"), detail: waiting };
  const ago = Math.max(0, now - at);
  const title = ago < MINUTE ? t("sync.syncedJustNow")
    : ago < HOUR ? t("sync.syncedMinutes", { n: Math.floor(ago / MINUTE) })
    : ago < DAY ? t("sync.syncedHours", { n: Math.floor(ago / HOUR) })
    : t("sync.syncedOn", { date: fmtDate(at) });
  return { tone: "ok", title, detail: waiting };
}

/** What a profile row and its menu read: synced or not, and leased elsewhere. */
export function profileSyncOf(sync: ProfileSync | undefined): { on: boolean; openOn: string | null; conflict: boolean } {
  return { on: !!sync?.on, openOn: sync?.on && sync.open_on ? sync.open_on : null, conflict: !!sync?.on && !!sync.conflict };
}
