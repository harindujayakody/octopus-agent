import { useEffect, useRef, useState } from "react";
import { Button, IconButton, Menu, Tooltip } from "@proxyshard/shardx-ui-kit";
import type { Project, RunSettings, RunState } from "../../entities/automation";
import { BackIcon, ComputerIcon, MoreIcon, PlayIcon, SpinnerIcon, StopIcon } from "../../shared/icons";
import { keyCaps } from "../../shared/commands";
import { useT } from "../../shared/i18n";
import { PageHeader } from "../../widgets/PageHeader";
import { RunSettingsButton } from "./RunSettingsButton";
import { teamRefusal, useRightsChange } from "../../entities/space";

/// The editor's one header row: "Projects" (a Back button to the list), the
/// name, the description, Save, the run's settings, the browser column's
/// switch, the run's state (a button that brings the column back to its log
/// while the column is closed), Run (Stop while a run goes) and More (Fleet,
/// Export). The name shows once on the page, here, and is edited in place.
export function EditorHeader({
  project, run, browserOpen, selectName, dirty, saving, saveError, onNameSelected, onBack, onRename, onDescribe, onSave, onRunOpts, onToggleBrowser, onShowLog, onRun, onStop, onFleet, onExport, onTidy,
}: {
  project: Project;
  run: RunState | null;
  browserOpen: boolean;
  /** The project has changes not yet saved. */
  dirty: boolean;
  saving: boolean;
  /** Why the last Save failed. */
  saveError: string | null;
  /** Select the name on mount, for typing it (a new project, Rename). */
  selectName: boolean;
  onNameSelected: () => void;
  onBack: () => void;
  onRename: (name: string) => void;
  onDescribe: (notes: string) => void;
  onSave: () => void;
  onRunOpts: (next: Partial<RunSettings>) => void;
  onToggleBrowser: () => void;
  /** Opens the browser column on its Run log. */
  onShowLog: () => void;
  onRun: () => void;
  onStop: () => void;
  onFleet: () => void;
  onExport: () => void;
  onTidy: () => void;
}) {
  const t = useT();
  const more = useRef<HTMLButtonElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  // A team's project changes with Edit in the team: Save says why it waits.
  useRightsChange();
  const noEdit = teamRefusal("edit");
  useEffect(() => {
    if (!selectName) return;
    nameField.current?.focus();
    nameField.current?.select();
    onNameSelected();
  }, [selectName, onNameSelected]);
  const [menuOpen, setMenuOpen] = useState(false);
  const going = !!run?.running;
  const running = going ? run!.workers.filter((w) => w.status === "running").length : 0;
  const failed = going ? run!.workers.filter((w) => w.status === "failed").length : 0;
  const untitled = t("projectEditor.untitled");

  const lead = (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      {/* The way back to the list: a button, not a small link in a path.
          Esc does the same when no field or dialog has the keyboard
          (ProjectEditor), and so does the sidebar's Automation item. */}
      <Tooltip content={t("projectEditor.backTip")} shortcut={keyCaps("Escape")[0]}>
        <Button
          variant="neutral" mode="stroke" size="xsmall"
          className="shrink-0"
          leftIcon={<BackIcon aria-hidden="true" className="size-3.5" />}
          onClick={onBack}
        >
          {t("projectEditor.projects")}
        </Button>
      </Tooltip>
      {/* The field is as wide as the name: an invisible copy of the text
          sizes the cell the input fills (WebKit has no field-sizing). The h1
          is where the keyboard lands on this page (A11Y-04, Pair 61's
          `data-page-title`), focusable from code only, as PageHeader's own. */}
      <h1 data-page-title tabIndex={-1} className="m-0 inline-grid min-w-[6ch] max-w-[36ch] shrink focus-ring">
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 overflow-hidden whitespace-pre px-1 text-panel-title">
          {`${project.name || untitled} `}
        </span>
        {/* eslint-disable-next-line no-restricted-syntax -- the page title edited in place */}
        <input
          ref={nameField}
          aria-label={t("projectEditor.nameField")}
          placeholder={untitled}
          className="col-start-1 row-start-1 w-full min-w-0 truncate rounded-control bg-transparent px-1 py-0.5 text-panel-title text-text-strong-950 placeholder:text-text-soft-400 transition-hover hover:bg-bg-hover focus-ring-inset"
          value={project.name}
          readOnly={!!noEdit}
          onChange={(e) => onRename(e.target.value)}
        />
      </h1>
      <Tooltip content={project.notes} whenTruncated>
        {/* eslint-disable-next-line no-restricted-syntax -- the description edited in place, on the title's row */}
        <input
          aria-label={t("projectEditor.descriptionField")}
          placeholder={t("projectEditor.descriptionPlaceholder")}
          className="min-w-0 flex-1 truncate rounded-control bg-transparent px-1 py-0.5 text-body text-text-soft-400 placeholder:text-text-soft-400 transition-hover hover:bg-bg-hover focus-ring-inset"
          value={project.notes}
          readOnly={!!noEdit}
          onChange={(e) => onDescribe(e.target.value)}
        />
      </Tooltip>
    </div>
  );

  return (
    <PageHeader
      title={project.name || untitled}
      lead={lead}
      actions={
        <>
          {/* Save to Run in one box, for the tour to point at. */}
          <div data-tour="editor-save-run" className="flex min-w-0 items-center gap-2">
          {/* Manual save (owner 2026-10-07): the state in words beside Save,
              which is quiet and off while nothing differs from what is
              saved. A failed save says why in the same place. */}
          <div data-editor-save className="flex min-w-0 items-center gap-2">
            {saveError && <span role="alert" className="min-w-0 truncate text-secondary text-error-text">{saveError}</span>}
            {/* Always there, so a screen reader hears the words arrive; hidden while empty. */}
            <span aria-live="polite" className="min-w-0 truncate text-secondary text-text-sub-600 empty:hidden">
              {saveError ? null : noEdit ?? (dirty ? t("projectEditor.unsaved") : null)}
            </span>
            <Button
              variant="neutral" mode="stroke" size="xsmall"
              disabled={!dirty || !!noEdit}
              aria-description={noEdit ?? undefined}
              isLoading={saving}
              // The word stays beside the spinner while it saves.
              leftIcon={saving ? <SpinnerIcon aria-hidden="true" className="size-3.5" /> : undefined}
              onClick={onSave}
            >
              {saving ? t("projectEditor.saving") : t("unsaved.save")}
            </Button>
          </div>
          <RunSettingsButton run={project.run} onChange={onRunOpts} readOnly={!!noEdit} />
          <Button
            variant="neutral" mode="stroke" size="xsmall"
            data-browser-toggle=""
            leftIcon={<ComputerIcon className="size-3.5" />}
            onClick={onToggleBrowser}
          >
            {browserOpen ? t("projectEditor.hideBrowser") : t("projectEditor.showBrowser")}
          </Button>
          {going && (
            browserOpen ? (
              <RunCounts running={running} failed={failed} />
            ) : (
              // The column is closed and the run goes on: its state is here,
              // and one press brings the log back.
              <Tooltip content={t("projectEditor.showLog")}>
                <Button variant="neutral" mode="ghost" size="xsmall" onClick={onShowLog}>
                  <RunCounts running={running} failed={failed} />
                </Button>
              </Tooltip>
            )
          )}
          {going ? (
            <Button variant="error" mode="filled" size="xsmall" leftIcon={<StopIcon className="size-3.5" />} onClick={onStop}>
              {t("projectEditor.stop")}
            </Button>
          ) : (
            <Button variant="primary" mode="filled" size="xsmall" leftIcon={<PlayIcon className="size-3.5" />} onClick={onRun}>
              {t("projectEditor.run")}
            </Button>
          )}
          </div>
          <IconButton
            ref={more}
            label={t("projectEditor.more")}
            icon={<MoreIcon className="size-3.5" />}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          />
          <Menu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            anchor={more}
            align="end"
            aria-label={t("projectEditor.more")}
            items={[
              { label: t("projectEditor.tidyUp"), onSelect: onTidy },
              { label: t("projectEditor.fleet"), onSelect: onFleet },
              { label: t("projectEditor.export"), onSelect: onExport },
            ]}
          />
        </>
      }
    />
  );
}

/** What the run is doing, in words: how many profiles run and how many failed;
 *  "Running" while none has started yet. */
function RunCounts({ running, failed }: { running: number; failed: number }) {
  const t = useT();
  return (
    <span data-run-counts className="flex items-center gap-2 text-secondary tabular-nums">
      {running === 0 && failed === 0 && <span className="text-text-sub-600">{t("automation.running")}</span>}
      {running > 0 && <span className="text-text-sub-600">{t("projectEditor.runningCount", { n: running })}</span>}
      {failed > 0 && <span className="text-error-text">{t("projectEditor.failedCount", { n: failed })}</span>}
    </span>
  );
}
