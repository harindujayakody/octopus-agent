import { useEffect, useRef } from "react";
import { intlLocale, useLang, useT } from "../../../shared/i18n";
import { announce } from "../../../shared/model/announce";
import { SpinnerIcon } from "../../../shared/icons";
import { StatusDot, type StatusDotTone } from "../../../shared/ui/StatusDot";
import { useNow } from "../../../shared/lib/useNow";
import { syncLine, type SyncLine } from "../lib/status";
import type { SyncStatus } from "../model/types";

const DOT: Record<Exclude<SyncLine["tone"], "busy">, StatusDotTone> = { ok: "success", offline: "warning", error: "error" };

/** The status line's words for `status`, kept current by the shared clock. */
export function useSyncLine(status: SyncStatus): SyncLine {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const now = useNow();
  const fmt = (secs: number) => new Intl.DateTimeFormat(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" }).format(secs * 1000);
  return syncLine(status, Math.floor(now / 1000), t, fmt);
}

/** The state's word with its dot (or spinner) before it: the word carries it.
 *  A change of state is said aloud, as focus stays where it was (A11Y-22). */
export function SyncStatusWord({ line, state }: { line: SyncLine; state: SyncStatus["state"] }) {
  const was = useRef(state);
  useEffect(() => {
    if (was.current === state) return;
    was.current = state;
    announce(line.title);
  }, [state, line.title]);
  return (
    <span data-sync-status={state} className="inline-flex min-w-0 items-center gap-1.5">
      {line.tone === "busy"
        ? <SpinnerIcon className="size-3.5 shrink-0 animate-spin text-icon-soft-400" />
        : <span className="flex size-3.5 shrink-0 items-center justify-center"><StatusDot tone={DOT[line.tone]} /></span>}
      <span className="min-w-0 truncate">{line.title}</span>
    </span>
  );
}
