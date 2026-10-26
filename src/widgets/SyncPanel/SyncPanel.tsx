import { useEffect, useRef, useState } from "react";
import {
  syncStatus, syncSetPaused, syncArrange, syncStop, syncSetExcluded,
  syncClosePanel, type SyncStatus, type SyncLayout,
} from "../../entities/profile/model/api";
import { Button, Chip, IconButton, Tooltip } from "@proxyshard/shardx-ui-kit";
import { PlayIcon, PauseIcon, StopIcon } from "../../shared/icons";
import { FloatingPanel } from "../../shared/ui/FloatingPanel";
import { useT } from "../../shared/i18n";

/**
 * One floating control surface for the whole group. Every window is equal —
 * whichever the operator works in is the one driving — so nothing is per-window.
 */
export function SyncPanel({ group }: { group: string }) {
  const t = useT();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  // Must survive the second before the first browser connects, and go once
  // they are all gone.
  const everHadMembers = useRef(false);

  useEffect(() => {
    let alive = true;
    let last = "";
    const tick = async () => {
      try {
        const s = await syncStatus(group);
        if (!alive) return;
        // Unchanged: nothing to draw (PERF-23).
        const json = JSON.stringify(s);
        if (json !== last) { last = json; setStatus(s); }
        if (s.members.length > 0) everHadMembers.current = true;
        else if (everHadMembers.current) void syncClosePanel();
      } catch { /* the group may not exist yet */ }
    };
    void tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [group]);

  const paused = status?.paused ?? false;
  const members = status?.members ?? [];

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch { /* the next poll shows the truth */ }
    setBusy(false);
  };

  return (
    <FloatingPanel
      title={t("syncPanel.inSyncCount", { n: members.length })}
      actions={
        <>
          <IconButton
            size="3xsmall"
            mode="stroke"
            tooltipSide="bottom"
            disabled={busy}
            icon={paused ? <PlayIcon className="size-3.5 translate-x-px" /> : <PauseIcon className="size-3.5" />}
            label={paused ? t("syncPanel.resume") : t("syncPanel.hold")}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => run(() => syncSetPaused(group, !paused))}
          />
          <IconButton
            size="3xsmall"
            mode="stroke"
            variant="error"
            tooltipSide="bottom"
            disabled={busy}
            icon={<StopIcon className="size-3.5" />}
            label={t("syncPanel.stopAll")}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => run(() => syncStop(group))}
          />
        </>
      }
    >
      <div className="flex shrink-0 gap-1 px-3 pb-2">
        {(["row", "grid", "cascade"] as SyncLayout[]).map((l) => (
          <Button key={l} size="3xsmall" variant="neutral" mode="stroke" className="flex-1 capitalize"
                  disabled={busy || members.length === 0}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => run(() => syncArrange(group, l))}>
            {l}
          </Button>
        ))}
      </div>

      {/* Chips, not rows: twelve rows is a scrollbar, and twelve is an
          ordinary fleet. */}
      <div className="min-h-0 flex-1 content-start overflow-auto border-t border-stroke-soft-200 px-2 py-1.5">
        {members.length === 0 ? (
          <div className="text-secondary text-text-soft-400">{t("syncPanel.starting")}</div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {members.map((m) => (
              <Tooltip
                key={m.profile}
                content={m.excluded ? t("syncPanel.chipBringBack") : t("syncPanel.chipHoldOut")}
              >
              <Chip
                size="xsmall"
                tone="neutral"
                selected={!m.excluded}
                disabled={busy}
                className={`max-w-[9rem] ${m.excluded ? "line-through" : ""}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => run(() => syncSetExcluded(group, m.profile, !m.excluded))}
              >
                {/* Where the input is coming from: a word, never the dot
                    alone (Task 5f) — "— driving" is part of the visible
                    label, not only this decorative dot. */}
                <span aria-hidden="true" className={`size-[5px] shrink-0 rounded-full forced-content ${
                  m.driving && !m.excluded ? "bg-success-base" : "bg-idle"}`} />
                <span className="truncate">{m.driving && !m.excluded ? t("syncPanel.memberDriving", { name: m.profile }) : m.profile}</span>
              </Chip>
              </Tooltip>
            ))}
          </div>
        )}
      </div>
    </FloatingPanel>
  );
}
