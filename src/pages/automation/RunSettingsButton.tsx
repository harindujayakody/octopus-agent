import { useRef, useState } from "react";
import { Button, Popover } from "@proxyshard/shardx-ui-kit";
import type { RunSettings } from "../../entities/automation";
import { ChevronDownIcon } from "../../shared/icons";
import { useT } from "../../shared/i18n";
import { NumField } from "../../shared/ui/NumField";

type T = ReturnType<typeof useT>;

/** A run's length in the app's duration words: "6 h", "45 min", "1 h 30 min". */
function hoursText(t: T, hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (m === 0) return t("format.durationHours", { h });
  return h === 0 ? t("format.durationMinutes", { m }) : t("format.durationHoursMinutes", { h, m });
}

/** How long the run goes, in the editor's words without its threads: "runs for 6 h", "3 loops", "runs until stopped". */
export function runPhrase(t: T, run: RunSettings): string {
  if (run.loops > 0) return run.loops === 1 ? t("projectEditor.loopsOne") : t("projectEditor.loopsMany", { n: run.loops });
  if (run.hours > 0) return t("automation.runsFor", { hours: hoursText(t, run.hours) });
  return t("automation.runsUntilStopped");
}

/** What the run does, in one line: "Threads 1, runs for 6 h" or "Threads 2, 3 loops". */
export function runSummary(t: T, run: RunSettings): string {
  if (run.loops > 0) {
    const loops = run.loops === 1 ? t("projectEditor.loopsOne") : t("projectEditor.loopsMany", { n: run.loops });
    return t("projectEditor.runSummaryLoops", { threads: run.threads, loops });
  }
  // Loops 0 and no hours: the runner keeps going until it is stopped.
  if (run.hours > 0) return t("projectEditor.runSummaryHours", { threads: run.threads, hours: hoursText(t, run.hours) });
  return t("projectEditor.runSummaryForever", { threads: run.threads });
}

/// Threads, Loops and Hours behind one button in the editor's header: the
/// button says what the run does, the popover holds the three fields.
export function RunSettingsButton({ run, onChange, readOnly = false }: { run: RunSettings; onChange: (next: Partial<RunSettings>) => void; readOnly?: boolean }) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        ref={anchor}
        variant="neutral" mode="stroke" size="xsmall"
        className="tabular-nums"
        rightIcon={<ChevronDownIcon className="size-3.5" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {runSummary(t, run)}
      </Button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchor}
        align="end"
        aria-label={t("projectEditor.runSettings")}
        className="w-[240px] p-3"
      >
        {/* `readOnly`: shown, not changed (a team's project without Edit). */}
        <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
          <div className="grid grid-cols-2 gap-2">
            <NumField label={t("projectEditor.threads")} value={run.threads} min={1} max={64} onChange={(v) => onChange({ threads: v })} />
            <NumField label={t("projectEditor.loops")} value={run.loops} min={0} onChange={(v) => onChange({ loops: v })} />
          </div>
          {run.loops === 0 && (
            <NumField label={t("projectEditor.hours")} value={run.hours} min={0} decimals={2} onChange={(v) => onChange({ hours: v })} />
          )}
          <p className="m-0 text-help text-text-soft-400">{t("projectEditor.loopsHelp")}</p>
        </fieldset>
      </Popover>
    </>
  );
}
