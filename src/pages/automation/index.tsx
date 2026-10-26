import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Tooltip } from "@proxyshard/shardx-ui-kit";
import { PageBody, PageHeader } from "../../widgets/PageHeader";
import { AddIcon, UploadIcon } from "../../shared/icons";
import { FileTooBig, MB } from "../../shared/lib/pickFile";
import { useStoreChanged } from "../../shared/hooks/useStoreChanged";
import { useHeldLoading } from "../../shared/hooks/useHeldLoading";
import { useNow } from "../../shared/lib/useNow";
import { useDialogLife } from "../../shared/lib/useDialogLife";
import { automationImport, automationRunStop, useAutomation, useRunningOn, type Bundle, type Project } from "../../entities/automation";
import { teamRefusal, useRightsChange } from "../../entities/space";
import { toast } from "../../shared/model/toast";
import { ProjectEditor } from "./ProjectEditor";
import { ProjectsList } from "./ProjectsList";
import { exportProject, reviewBeforeRun, startProjectRun } from "../../features/automation-run";
import { ModulesDialog, useModulesAwaiting } from "../../features/automation-modules";
import { useT } from "../../shared/i18n";
import { ReviewDialog, markReviewed, markUnreviewed, reviewLines, type ReviewLine } from "../../features/automation-review";
import { showMeAround } from "../../features/tour";

const BUNDLE_MAX_BYTES = 20 * MB;

export function AutomationPage() {
  const t = useT();
  const init = useAutomation((s) => s.init);
  const status = useAutomation((s) => s.status);
  const loadError = useAutomation((s) => s.error);
  const available = useAutomation((s) => s.available);
  const projects = useAutomation((s) => s.projects);
  const openId = useAutomation((s) => s.openId);
  const busy = useAutomation((s) => s.busy);
  const open = useAutomation((s) => s.open);
  const openToRename = useAutomation((s) => s.openToRename);
  const create = useAutomation((s) => s.create);
  const remove = useAutomation((s) => s.remove);
  const duplicate = useAutomation((s) => s.duplicate);
  const reload = useAutomation((s) => s.reload);
  const { running, last, refresh: refreshFleet } = useRunningOn();
  const now = useNow();
  // A team's projects: making one needs Create in the team.
  useRightsChange();
  const noCreate = teamRefusal("create");

  const [review, setReview] = useState<{ bundle: Bundle; lines: ReviewLine[] } | null>(null);
  const [runReview, setRunReview] = useState<{ project: Project; lines: ReviewLine[] } | null>(null);
  const importFile = useRef<HTMLInputElement>(null);
  const creating = useRef(false);
  // Modules are managed from Add step in a project; one that waits for an
  // answer is named here, on the list, with a way to the same dialog.
  const awaiting = useModulesAwaiting(available && !openId);
  const [reviewing, setReviewing] = useState(false);
  const reviewLife = useDialogLife(reviewing);

  useEffect(() => { init(); }, [init]);
  // A project created or removed through the HTTP API or MCP writes straight
  // to disk; without this the list only catches up on restart.
  useStoreChanged(reload);
  // Above the early returns: a hook. The placeholder rows wait 150 ms and
  // stay 400 ms (WIG-12). Not while the editor is open: the rows' clock
  // starts when they can mount (Pair 3 review, Minor 1).
  const loading = useHeldLoading(!openId && (status === "idle" || status === "loading"));

  if (status === "ready" && !available) {
    return (
      <>
        <PageHeader title={t("automation.title")} />
        <PageBody>
          <Card className="p-8 text-center">
            <p className="m-0 text-balance text-body text-text-soft-400">
              {t("automation.notBuilt")}
            </p>
          </Card>
        </PageBody>
      </>
    );
  }

  if (openId) return <ProjectEditor />;

  const importBundle = async (bundle: Bundle, reviewed: boolean) => {
    const refused = teamRefusal("create");
    if (refused) { toast.fail({ title: t("automation.importFailed"), detail: refused }); return; }
    try {
      const p = await automationImport(bundle);
      // Its first Run shows the review again.
      if (reviewed) markUnreviewed(p.id);
      await useAutomation.getState().reload();
      open(p.id);
      const n = bundle.needs?.length ?? 0;
      toast.ok(
        n === 0
          ? t("automation.imported")
          : n === 1
            ? t("automation.importedSecret", { n })
            : t("automation.importedSecrets", { n }),
      );
    } catch (err) { toast.fail({ title: t("automation.importFailed"), detail: err }); }
  };

  // The list shows projects as saved, so a Run from it runs what it shows:
  // there is no draft here to ask about.
  const run = (p: Project) => {
    const lines = reviewBeforeRun(p);
    if (lines) { setRunReview({ project: p, lines }); return; }
    void startProjectRun(p).then(refreshFleet);
  };
  const stop = (p: Project) => { void automationRunStop(p.id).then(refreshFleet, refreshFleet); };

  // A double click on New project makes one project: the second press waits
  // for the first to open its editor.
  const newProject = () => {
    if (creating.current || noCreate) return;
    creating.current = true;
    void create(t("automation.emptyAction")).finally(() => { creating.current = false; });
  };

  const actions = (
    <>
      {/* eslint-disable-next-line no-restricted-syntax -- hidden file input behind the Import button */}
      <input
        ref={importFile}
        type="file"
        accept=".json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          // A bundle is read whole: one over 20 MB is refused before it is (SEC-07).
          if (file.size > BUNDLE_MAX_BYTES) { toast.err(new FileTooBig(file.name, BUNDLE_MAX_BYTES).message); return; }
          // Parsing and reviewing a malformed bundle both land here, so
          // either failure shows the same error toast and imports nothing.
          try {
            const bundle = JSON.parse(await file.text()) as Bundle;
            // What it can do beyond the page, shown before it lands (SEC-02).
            const lines = reviewLines(bundle.project?.blocks ?? [], bundle.project?.rules ?? [], (bundle.module_files ?? []).map((m) => m.id));
            if (lines.length > 0) setReview({ bundle, lines });
            else await importBundle(bundle, false);
          } catch (err) { toast.fail({ title: t("automation.importFailed"), detail: err }); }
        }}
      />
      {/* A team's projects are made with Create in the team: each button says why it does nothing.
          Else its words, only while a narrow header shows its icon alone. */}
      <Tooltip content={noCreate ?? t("automation.import")} whenTruncated={!noCreate}>
        <Button variant="neutral" mode="stroke" size="xsmall" leftIcon={<UploadIcon className="size-3.5" />} disabled={!!noCreate} aria-description={noCreate ?? undefined} onClick={() => importFile.current?.click()}>
          {t("automation.import")}
        </Button>
      </Tooltip>
      <Tooltip content={noCreate ?? t("automation.emptyAction")} whenTruncated={!noCreate}>
        <Button variant="primary" mode="filled" size="xsmall" leftIcon={<AddIcon className="size-3.5" />} data-tour="new-project" disabled={!!noCreate} aria-description={noCreate ?? undefined} onClick={newProject}>
          {t("automation.emptyAction")}
        </Button>
      </Tooltip>
    </>
  );

  return (
    <>
      <PageHeader
        title={t("automation.title")}
        count={loading || status !== "ready" ? undefined : projects.length}
        help={{ title: t("pageHelp.automation.title"), body: t("pageHelp.automation.body"), onTour: () => showMeAround("automation") }}
        after={awaiting.count > 0 ? (
          // Gives way before the title does (the header's own rule: the title
          // is the last to truncate): its words cut short at 960 px, not the page's name.
          <div data-modules-awaiting className="flex min-w-0 shrink-[100] items-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
            <Badge color="warning" shape="pill" className="min-w-0">
              <span className="truncate">{awaiting.count === 1 ? t("automation.modulesAwaitingOne") : t("automation.modulesAwaitingMany", { n: awaiting.count })}</span>
            </Badge>
            <Button variant="neutral" mode="stroke" size="2xsmall" className="shrink-0" onClick={() => setReviewing(true)}>
              {t("automation.reviewModules")}
            </Button>
          </div>
        ) : undefined}
        actions={actions}
      />
      <PageBody scroll={false} className="relative">
        <ProjectsList
          projects={projects}
          loading={loading}
          failed={status === "error"}
          loadError={loadError}
          onRetry={() => void init()}
          runningOn={running}
          lastRuns={last}
          busy={busy}
          now={now}
          onOpen={(p) => open(p.id)}
          onNew={newProject}
          onRun={run}
          onStop={stop}
          onDuplicate={(p) => void duplicate(p)}
          onRename={(p) => openToRename(p.id)}
          onExport={(p) => void exportProject(p)}
          onDelete={(p) => void remove(p)}
        />
      </PageBody>

      {reviewLife.mounted && (
        <ModulesDialog key={reviewLife.session} open={reviewing} onClose={() => { setReviewing(false); awaiting.refresh(); }} />
      )}
      {review && (
        <ReviewDialog
          mode="import"
          name={review.bundle.project?.name ?? ""}
          lines={review.lines}
          onCancel={() => setReview(null)}
          onConfirm={() => { const b = review.bundle; setReview(null); void importBundle(b, true); }}
        />
      )}
      {runReview && (
        <ReviewDialog
          mode="run"
          name={runReview.project.name}
          lines={runReview.lines}
          onCancel={() => setRunReview(null)}
          onConfirm={() => { const p = runReview.project; setRunReview(null); markReviewed(p.id); void startProjectRun(p).then(refreshFleet); }}
        />
      )}
    </>
  );
}
