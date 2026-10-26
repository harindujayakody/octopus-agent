import { Fragment, useMemo } from "react";
import { Badge, Button, DataList, EmptyState, Tooltip, cn, type MenuItem } from "@proxyshard/shardx-ui-kit";
import { blockIcon, runOrder, type LastRun, type LastRuns, type Project, type RunningOn } from "../../entities/automation";
import { formatExactRun, formatRelativeRun } from "../../entities/profile";
import { teamRefusal, useRightsChange } from "../../entities/space";
import { AddIcon, ChevronRightIcon, CopyIcon, DeleteIcon, DownloadIcon, NavAutomationIcon, PlayIcon, RenameIcon, StepIcon, StopIcon } from "../../shared/icons";
import { useLang, useT, type Lang, type T } from "../../shared/i18n";
import { ListColumn } from "../../shared/ui/ListColumn";
import { LoadError, LoadingCards } from "../../shared/ui/ListStates";
import { runPhrase } from "./RunSettingsButton";

/** The step chain's most icons before "+N". */
const CHAIN_MAX = 6;
/** The card's least width, px: as wide as an extension's, so a chain of six icons and a status fit a line. */
const CARD_MIN_WIDTH = 280;
/** A card's height, px: the loading placeholders stand where the cards will. */
const CARD_HEIGHT = 154;

/// The project's steps as small icons in run order, a step that is off dimmed,
/// "+N" past six. The words are for a screen reader.
function StepChain({ project }: { project: Project }) {
  const steps = runOrder(project);
  const shown = steps.slice(0, CHAIN_MAX);
  return (
    <div data-step-chain role="img" aria-label={steps.map((b) => b.label).join(", ")} className="flex h-[20px] items-center gap-[3px] text-icon-sub-600">
      {shown.map((b, i) => (
        <Fragment key={b.id}>
          {i > 0 && <ChevronRightIcon aria-hidden="true" className="size-[8px] shrink-0 text-icon-soft-400 opacity-70" />}
          <span data-step-slot data-off={b.enabled ? undefined : ""} className={cn("flex size-3.5 shrink-0", !b.enabled && "opacity-40")}>
            <StepIcon icon={blockIcon(b.kind)} className="size-3.5" />
          </span>
        </Fragment>
      ))}
      {steps.length > CHAIN_MAX && (
        <span data-step-more className="ml-[3px] text-secondary text-text-soft-400 tabular-nums">+{steps.length - CHAIN_MAX}</span>
      )}
    </div>
  );
}

/** When a run ended, for a sentence: "2 h ago", "just now", "yesterday", "Aug 29". */
function whenIn(t: T, lang: Lang, at: number, now: number): string {
  const text = formatRelativeRun(at, now, lang);
  // The two words that are capitalized on their own read in lower case mid-sentence.
  return text === t("profileRow.statusJustNow") || text === t("profileRow.statusYesterday") ? text.toLocaleLowerCase(lang) : text;
}

/// How the project last ran, always in words: "Running on 2 profiles" while it
/// runs, else how its last run this session ended and when, else "Never run".
/// The exact time is on hover.
function RunStatus({ running, last, now }: { running: number | undefined; last: LastRun | undefined; now: number }) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  if (running !== undefined) {
    return (
      <Badge color="success" shape="pill" dot data-run-status className="min-w-0">
        <span className="truncate">{running > 0 ? (running === 1 ? t("automation.runningOnOne") : t("automation.runningOnMany", { n: running })) : t("automation.running")}</span>
      </Badge>
    );
  }
  if (!last) return <span data-run-status className="block truncate text-secondary text-text-soft-400">{t("automation.neverRun")}</span>;
  const when = whenIn(t, lang, last.at, now);
  return (
    <Tooltip content={formatExactRun(last.at, lang)}>
      <span data-run-status data-outcome={last.outcome} className={cn("block truncate text-secondary", last.outcome === "failed" ? "text-error-text" : "text-text-sub-600")}>
        {last.outcome === "failed" ? t("automation.runFailed", { when }) : last.outcome === "stopped" ? t("automation.runStopped", { when }) : t("automation.runFinished", { when })}
      </span>
    </Tooltip>
  );
}

/// One project as a tile (the kit grid's item is the tile, the card is its
/// content): its name, its description up to two lines, its step chain with
/// the run summary under it, and at the bottom how it last ran with Run (Stop
/// while it runs). The card's own click, Enter and menu are the grid's.
function ProjectCard({ p, active, running, last, busy, now, onRun, onStop }: {
  p: Project;
  active: boolean;
  running: number | undefined;
  last: LastRun | undefined;
  busy: boolean;
  now: number;
  onRun: (p: Project) => void;
  onStop: (p: Project) => void;
}) {
  const t = useT();
  // One Tab stop for the grid: Run is in the tab order on the active card only, as its More button is.
  const tabIndex = active ? 0 : -1;
  return (
    // min-w-0: the card is never wider than its cell, whatever its text; the
    // name is cut and the description wraps inside it. It fills its cell, so
    // the cards of a row are as tall and their Run buttons line up.
    <article className="flex h-full w-full min-w-0 flex-col gap-2.5 rounded-tile px-cell py-[10px]">
      <div className="min-w-0">
        {/* pe-5: room for the card's More button (top right, on hover), so it never sits on the name. */}
        <div className="min-w-0 pe-5">
          {/* The whole name on hover, only when it is cut. */}
          <Tooltip content={p.name} whenTruncated><h2 className="m-0 truncate text-ui font-medium text-text-strong-950">{p.name}</h2></Tooltip>
        </div>
        <p data-description className="m-0 mt-0.5 line-clamp-2 min-h-[32px] break-words text-secondary text-text-sub-600">
          {p.notes || <span className="text-text-soft-400">{t("automation.noDescription")}</span>}
        </p>
      </div>
      <div className="flex min-w-0 flex-col">
        <StepChain project={p} />
        <div data-run-summary className="truncate text-secondary text-text-soft-400">
          {t("automation.summary", {
            steps: p.blocks.length === 1 ? t("automation.stepCountOne") : t("automation.stepCount", { n: p.blocks.length }),
            run: runPhrase(t, p.run),
          })}
        </div>
      </div>
      <div className="mt-auto flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0"><RunStatus running={running} last={last} now={now} /></div>
        {running === undefined ? (
          <Button variant="primary" mode="lighter" size="2xsmall" static tabIndex={tabIndex} className="w-[64px] shrink-0 focus-ring-inset" disabled={busy} leftIcon={<PlayIcon className="size-3.5" />} onClick={(e) => { e.stopPropagation(); onRun(p); }}>
            {t("projectEditor.run")}
          </Button>
        ) : (
          <Button variant="error" mode="lighter" size="2xsmall" static tabIndex={tabIndex} className="w-[64px] shrink-0 focus-ring-inset" leftIcon={<StopIcon className="size-3.5" />} onClick={(e) => { e.stopPropagation(); onStop(p); }}>
            {t("projectEditor.stop")}
          </Button>
        )}
      </div>
    </article>
  );
}

/// The projects as cards on the kit DataList grid, as the extensions are: one
/// Tab stop, arrows by what is beside, above and below, a click or Enter on a
/// card opens it, and Rename, Duplicate, Export and Delete are in its menu.
/// Newest change first; the list keeps no layout, a card has no columns.
export function ProjectsList({ projects, loading, failed, loadError, onRetry, runningOn, lastRuns, busy, now, onOpen, onNew, onRun, onStop, onDuplicate, onRename, onExport, onDelete }: {
  projects: Project[];
  loading: boolean;
  failed: boolean;
  loadError: string | null;
  onRetry: () => void;
  runningOn: RunningOn;
  lastRuns: LastRuns;
  busy: string | null;
  now: number;
  onOpen: (p: Project) => void;
  onNew: () => void;
  onRun: (p: Project) => void;
  onStop: (p: Project) => void;
  onDuplicate: (p: Project) => void;
  onRename: (p: Project) => void;
  onExport: (p: Project) => void;
  onDelete: (p: Project) => void;
}) {
  const t = useT();
  const newest = useMemo(() => [...projects].sort((a, b) => b.updated_at - a.updated_at), [projects]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  // A team's projects: each item needs its right in the team, and says so when closed.
  useRightsChange();
  const closed = (why: string | null) => (why ? { disabled: true, hint: why } : {});
  const noCreate = teamRefusal("create");
  const menuItems = (p: Project): MenuItem[] => [
    { label: t("automation.rename"), icon: <RenameIcon className="size-3.5" />, onSelect: () => onRename(p), ...closed(teamRefusal("edit")) },
    { label: t("automation.duplicate"), icon: <CopyIcon className="size-3.5" />, disabled: busy === p.id, onSelect: () => onDuplicate(p), ...closed(noCreate) },
    { label: t("projectEditor.export"), icon: <DownloadIcon className="size-3.5" />, onSelect: () => onExport(p), ...closed(teamRefusal("take_out")) },
    { type: "separator" },
    { label: t("automation.delete"), icon: <DeleteIcon className="size-3.5" />, danger: true, onSelect: () => onDelete(p), ...closed(teamRefusal("delete")) },
  ];

  return (
    <ListColumn>
      <DataList<Project>
        variant="grid"
        minCardWidth={CARD_MIN_WIDTH}
        aria-label={t("automation.tabProjects")}
        items={newest}
        getId={(p) => p.id}
        getName={(p) => p.name}
        labels={{ selectAll: t("dataList.selectAll"), select: (name) => t("dataList.select", { name }), more: t("pageHeader.more"), actions: t("profileTable.colActions") }}
        status={loading ? "loading" : failed ? "error" : "ready"}
        loading={<LoadingCards minWidth={CARD_MIN_WIDTH} height={CARD_HEIGHT} />}
        error={<LoadError what={t("listStates.projects")} error={loadError} onRetry={onRetry} />}
        empty={<EmptyState icon={<NavAutomationIcon />} title={t("automation.emptyTitle")} hint={t("automation.emptyHint")} action={noCreate ? undefined : { label: t("automation.emptyAction"), icon: <AddIcon />, onClick: onNew }} />}
        renderCard={(p, { active }) => (
          <ProjectCard p={p} active={active} running={runningOn.get(p.id)} last={lastRuns.get(p.id)} busy={busy === p.id} now={now} onRun={onRun} onStop={onStop} />
        )}
        onOpen={onOpen}
        onDelete={(ids) => { const p = byId.get(ids[0] ?? ""); if (p) onDelete(p); }}
        menuItems={menuItems}
      />
    </ListColumn>
  );
}
