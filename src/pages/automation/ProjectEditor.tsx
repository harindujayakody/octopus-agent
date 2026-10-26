import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button, Card, SegmentControl, Tooltip, cn } from "@proxyshard/shardx-ui-kit";
import { teamRefusal, useRightsChange } from "../../entities/space";
import { AddIcon } from "../../shared/icons";
import {
  specFor,
  freeSpot,
  isUnplaced,
  automationDisplay,
  automationFleetWindow,
  automationRunStatus,
  automationRunStop,
  leaveEditor,
  useAutomation,
  type Block,
  type BlockSpec,
  type Branch,
  type DisplayInfo,
  type RunState,
} from "../../entities/automation";
import type { MenuAction } from "../../widgets/LiveView/liveActions";
import { BlockCanvas } from "../../widgets/BlockCanvas";
import { StepDetails } from "./StepDetails";
import { toast } from "../../shared/model/toast";
import { confirmModal } from "../../shared/model/confirm";
import { useUnsaved } from "../../shared/model/unsaved";
import { isMod, keyboardIsTaken, overlayHasKeyboard } from "../../shared/lib/keyboard";
import { commitFocusedField } from "../../shared/lib/commitField";
import { useDialogLife } from "../../shared/lib/useDialogLife";
import { BlockPicker } from "../../features/automation-blocks";
import { ModulesDialog } from "../../features/automation-modules";
import { profileList } from "../../entities/profile/model/api";
import type { ProfileMeta } from "../../entities/profile/model/types";
import type { Picked } from "../../entities/automation";
import { LiveView, useLiveBrowser } from "../../widgets/LiveView";
import { TrafficPanel, TrafficRequests, useTrafficObserver } from "../../widgets/TrafficPanel";
import type { TrafficRule } from "../../entities/automation";
import { useT } from "../../shared/i18n";
import { PageBody } from "../../widgets/PageHeader";
import { EditorHeader } from "./EditorHeader";
import { BrowserColumn, type BrowserTab } from "./BrowserColumn";
import {
  BROWSER_DEFAULT, BROWSER_MIN, BROWSER_RESERVED, BrowserResizeHandle, loadBrowserWidth, saveBrowserWidth,
} from "./BrowserResizeHandle";
import { useScrollingFlag } from "../../shared/lib/useScrollingFlag";
import { ReviewDialog, markReviewed, type ReviewLine } from "../../features/automation-review";
import { exportProject, reviewBeforeRun, startProjectRun } from "../../features/automation-run";

export function ProjectEditor() {
  const t = useT();
  // A team's project without Edit opens to read: nothing in it changes (useAutomation `viewOnly`).
  useRightsChange();
  const noEdit = teamRefusal("edit");
  const project = useAutomation((s) => s.current());
  const open = useAutomation((s) => s.open);
  const patch = useAutomation((s) => s.patch);
  const addBlock = useAutomation((s) => s.addBlock);
  const placeBlock = useAutomation((s) => s.placeBlock);
  const commitMove = useAutomation((s) => s.commitMove);
  const tidy = useAutomation((s) => s.tidy);
  const connect = useAutomation((s) => s.connect);
  const undo = useAutomation((s) => s.undo);
  const redo = useAutomation((s) => s.redo);
  const save = useAutomation((s) => s.save);
  const discard = useAutomation((s) => s.discard);
  const focusName = useAutomation((s) => s.focusName);
  const nameFocused = useAutomation((s) => s.nameFocused);
  // Manual save (owner 2026-10-07): every change is a draft until Save.
  const dirty = useAutomation((s) => !!s.openId && s.openId in s.drafts);
  const saving = useAutomation((s) => !!s.openId && s.saving === s.openId);
  const saveError = useAutomation((s) => (s.saveError && s.saveError.id === s.openId ? s.saveError.message : null));
  // Leaving the project with changes asks first: Back, another project, another page.
  useUnsaved(project && dirty ? {
    id: `project:${project.id}`,
    label: project.name || t("projectEditor.untitled"),
    save: () => save(project.id),
    discard: () => discard(project.id),
  } : null);

  const [profiles, setProfiles] = useState<ProfileMeta[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // The block library stays mounted through its exit (FEEL-01).
  const pickerLife = useDialogLife(picking);
  // Modules are managed from the library (Add step, Manage modules): the
  // dialog opens over it, and the library reads the list again when it closes.
  const [managing, setManaging] = useState(false);
  const modulesLife = useDialogLife(managing);
  const [modulesSeen, setModulesSeen] = useState(0);
  const [pickAt, setPickAt] = useState<{ x: number; y: number } | null>(null);
  // The browser is a third column only while it is open (owner, 2026-10-01).
  const [showBrowser, setShowBrowser] = useState(false);
  const [recording, setRecording] = useState(false);
  // The browser column's own width: dragged, kept, and given up first when
  // the window shrinks (owner, 2026-10-01).
  const [browserPref, setBrowserPref] = useState(loadBrowserWidth);
  const [gridW, setGridW] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const sideScroll = useScrollingFlag();
  useEffect(() => {
    const el = gridRef.current;
    if (!el || !showBrowser) return;
    const ro = new ResizeObserver(() => setGridW(Math.round(el.getBoundingClientRect().width)));
    ro.observe(el);
    setGridW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [showBrowser]);
  const browserMax = gridW > 0 ? Math.max(BROWSER_MIN, gridW - BROWSER_RESERVED) : BROWSER_DEFAULT;
  const browserShown = Math.max(BROWSER_MIN, Math.min(browserPref, browserMax));
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<"step" | "traffic">("step");
  const [browserTab, setBrowserTab] = useState<BrowserTab>("page");
  // The step whose Pick is waiting for a click on the page.
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [runReview, setRunReview] = useState<ReviewLine[] | null>(null);
  const [display, setDisplay] = useState<DisplayInfo | null>(null);
  // What is on the running browser: the project rules applied, or a test
  // rule from a request (an empty set); null when nothing is.
  const [applied, setApplied] = useState<ReadonlySet<TrafficRule> | null>(null);
  // A rule just added from a request, whose form the Traffic tab opens.
  const [newRule, setNewRule] = useState<TrafficRule | null>(null);
  const observer = useTrafficObserver(target);
  const browser = useLiveBrowser(target);
  useEffect(() => { automationDisplay().then(setDisplay).catch(() => {}); }, []);

  // A stopped browser holds no rules, records nothing and picks nothing.
  useEffect(() => {
    if (browser.live) return;
    setApplied(null);
    setRecording(false);
    setPickFor(null);
  }, [browser.live]);

  // Esc gives up a Pick, before the live view could send it to the page.
  useEffect(() => {
    if (!pickFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setPickFor(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pickFor]);

  // Closing the column only hides it: the browser stays open and a run goes
  // on (the header shows its state and brings the log back). A hidden column
  // records and picks nothing, so those end with it.
  const closeBrowser = () => {
    setShowBrowser(false);
    setRecording(false);
    setPickFor(null);
  };

  // A control that unmounts takes the keyboard with it, and a key pressed
  // next would land on the page. So the keyboard goes on: the close button
  // hands it to the header's browser switch, and the run's state button
  // (which the open column replaces with plain words) to the column's Run
  // log tab.
  const focusNext = useRef<"switch" | "log" | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    if (next === null) return;
    focusNext.current = null;
    if (next === "switch" && !showBrowser) document.querySelector<HTMLElement>("[data-browser-toggle]")?.focus();
    if (next === "log" && showBrowser) document.querySelector<HTMLElement>('[data-browser-column] [role="tab"][aria-selected="true"]')?.focus();
  }, [showBrowser]);

  // Esc goes back to the projects list, as Back does (with changes not yet
  // saved it asks first). Only when nothing else wants the key:
  // `keyboardIsTaken` says so for a field, the live browser view and an open
  // dialog, menu or popover (keep that check: an overlay need not mark its
  // Esc handled), and a tooltip's Esc arrives already `defaultPrevented`, so
  // one press never does two things.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (keyboardIsTaken(e.target)) return;
      e.preventDefault();
      void leaveEditor();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // A run that starts opens its log, in the browser column.
  const wasRunning = useRef(false);
  useEffect(() => {
    const going = !!run?.running;
    if (going && !wasRunning.current) {
      setShowBrowser(true);
      setBrowserTab("log");
    }
    wasRunning.current = going;
  }, [run?.running]);

  // Undo covers every change to the project, deleting a step included. Skipped
  // while a text field has focus, where the browser's own undo is what the
  // operator means. Cmd/Ctrl+S saves, from a field too (an app command
  // cannot run in one, so the editor listens itself); with nothing unsaved,
  // nothing happens. In the live browser view the key is that browser's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "s" && isMod(e) && !e.altKey && !e.shiftKey) {
        if ((e.target as HTMLElement | null)?.closest?.("[data-own-keys]")) return;
        // Never the browser's own Save page.
        e.preventDefault();
        // The field that has the keyboard commits first: the save reads what the screen shows.
        commitFocusedField();
        const st = useAutomation.getState();
        const id = st.openId;
        if (e.repeat || overlayHasKeyboard() || !id || !st.isDirty(id) || st.saving === id) return;
        void st.save(id);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || (key !== "z" && key !== "y")) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      if (key === "y" || e.shiftKey) void redo();
      else void undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // Poll only while something is going; a finished run keeps its last state on
  // screen so the log can still be read.
  useEffect(() => {
    if (!project) return;
    const tick = () => { automationRunStatus(project.id).then(setRun).catch(() => {}); };
    tick();
    const t = setInterval(tick, 800);
    return () => clearInterval(t);
  }, [project?.id]);
  useEffect(() => { profileList().then(setProfiles).catch(() => {}); }, []);

  // A project with no positions yet (new, or imported) gets one layout pass,
  // quietly: it is not a change the user made, so it has no Undo step. Every
  // other project keeps its steps exactly where they are.
  const unplaced = !!project && isUnplaced(project.blocks);
  useEffect(() => {
    if (project && unplaced) void tidy(project.id, { silent: true });
  }, [project?.id, unplaced]);

  // The "type" step typed keys go into while recording (SEC-06).
  const typing = useRef<string | null>(null);
  useEffect(() => { if (!recording) typing.current = null; }, [recording]);

  if (!project) {
    open(null);
    return null;
  }

  const savedProject = () => useAutomation.getState().projects.find((p) => p.id === project.id) ?? null;

  // Every step gets its block's defaults, however it was made. Recorded steps
  // used to be built by hand and so carried none — a recorded click had no
  // wait at all, while the same block added from the library had five seconds.
  const newBlock = (
    kind: string,
    params: Record<string, unknown>,
    label: string,
    at?: { x: number; y: number },
  ): Block => {
    const defaults: Record<string, unknown> = {};
    for (const prm of specFor(kind)?.params ?? []) {
      if (prm.default !== undefined) defaults[prm.name] = prm.default;
    }
    return {
      id: crypto.randomUUID(),
      kind,
      label,
      params: { ...defaults, ...params },
      enabled: true,
      secrets: [],
      ...(at ?? freeSpot(project.blocks)),
      on_done: "next",
      on_fail: "stop",
    };
  };

  // The run uses the saved project (the backend runs what is stored), so
  // changes not yet saved ask first: Save and run, or Cancel. An imported
  // project that reaches beyond the page shows what it does once more
  // before its first Run (SEC-02).
  const tryRun = async () => {
    commitFocusedField();
    if (useAutomation.getState().isDirty(project.id)) {
      const choice = await confirmModal({
        title: t("projectEditor.runAskTitle"),
        message: t("projectEditor.runAskBody"),
        buttons: [
          { label: t("projectEditor.saveAndRun"), value: "save", primary: true },
          { label: t("unsaved.cancel"), value: null },
        ],
      });
      if (choice !== "save" || !(await save(project.id))) return;
    }
    const saved = savedProject();
    if (!saved) return;
    const lines = reviewBeforeRun(saved);
    if (lines) { setRunReview(lines); return; }
    void startProjectRun(saved);
  };

  // Export writes the stored project too (the backend reads it by id), so
  // changes not yet saved ask the same way: Save and export, or Cancel. The
  // file's name and content then both come from the saved project
  // (Controller Ruling 9).
  const tryExport = async () => {
    commitFocusedField();
    if (useAutomation.getState().isDirty(project.id)) {
      const choice = await confirmModal({
        title: t("projectEditor.exportAskTitle"),
        message: t("projectEditor.exportAskBody"),
        buttons: [
          { label: t("projectEditor.saveAndExport"), value: "save", primary: true },
          { label: t("unsaved.cancel"), value: null },
        ],
      });
      if (choice !== "save" || !(await save(project.id))) return;
    }
    const saved = savedProject();
    if (saved) await exportProject(saved);
  };

  // A right-click on the live view: the operator chose what to do with the
  // element the browser resolved under the point.
  const onAction = async (a: MenuAction, target: Picked | null) => {
    const params: Record<string, unknown> = target?.selector
      ? { selector: target.selector }
      : {
          x: Math.round(target?.x ?? 0),
          y: Math.round(target?.y ?? 0),
          // Kept on the step so the panel can say WHY it fell back.
          _tried: target?.tried ?? [],
        };
    const what = target?.label
      ? `"${target.label}"`
      : target?.tag
        ? `<${target.tag}>`
        : t("projectEditor.point");
    await addBlock(project.id, newBlock(a.kind, params, `${a.label} ${what}`));
  };

  // Recording: the operator did something on the page and it becomes a step.
  const onRecorded = async (
    kind: string,
    target: Picked | null,
    extra?: Record<string, unknown>,
  ) => {
    // Typed characters go into one "type" step, marked secret, labelled only
    // "Type text": a recorded login must not keep its password in step
    // labels or exports (SEC-06). Named keys (Enter, Tab) stay press steps.
    // AltGr reports as Control+Alt, and a lone Option/Alt key can also
    // produce a printable character, so only Meta, or Control without Alt,
    // keeps a character out of the typed text.
    const key = typeof extra?.key === "string" ? extra.key : "";
    const modifiers = typeof extra?.modifiers === "string" ? extra.modifiers.split(", ").filter(Boolean) : [];
    const blocksTyping = modifiers.includes("Meta") || (modifiers.includes("Control") && !modifiers.includes("Alt"));
    if (kind === "press" && key.length === 1 && !blocksTyping) {
      const current = useAutomation.getState().edited(project.id);
      const into = typing.current ? current?.blocks.find((b) => b.id === typing.current) : undefined;
      if (current && into) {
        await patch(project.id, {
          blocks: current.blocks.map((b) =>
            b.id === into.id ? { ...b, params: { ...b.params, text: `${String(b.params.text ?? "")}${key}` } } : b,
          ),
        });
        return;
      }
      const block = { ...newBlock("type", { text: key }, t("palette.type.label")), secrets: ["text"] };
      typing.current = block.id;
      await addBlock(project.id, block);
      return;
    }
    typing.current = null;
    const params: Record<string, unknown> = { ...(extra ?? {}) };
    if (target?.selector) params.selector = target.selector;
    else if (target) {
      params.x = Math.round(target.x);
      params.y = Math.round(target.y);
      params._tried = target.tried ?? [];
    }
    const what = target?.label
      ? `"${target.label}"`
      : target?.tag
        ? `<${target.tag}>`
        : String(extra?.key ?? "");
    const name =
      kind === "press"
        ? t("projectEditor.stepPress", { what })
        : kind === "scroll"
          ? Number(extra?.deltaY ?? 0) >= 0
            ? t("projectEditor.stepScrollDown")
            : t("projectEditor.stepScrollUp")
          : kind === "goto"
            ? t("projectEditor.stepOpen", { url: pageLabel(String(extra?.url ?? "")).slice(0, 48) })
            : what
              ? t("projectEditor.stepClick", { what })
              : t("projectEditor.stepClickPoint");
    await addBlock(project.id, newBlock(kind, params, name));
  };

  const addFromLibrary = (spec: BlockSpec) => {
    const b = newBlock(spec.kind, {}, "", pickAt ?? undefined);
    setPickAt(null);
    addBlock(project.id, b);
    setOpenStep(b.id);
  };

  // The run follows the visual stack (see BlockCanvas / the runner sort,
  // runner.rs: by column, then by y), so a drop only needs to place the card
  // and make room: its position decides where it sits in the flow. Dropped
  // onto a card it takes that card's place, and everything at or below it in
  // the column slides down one card — two cards at one spot would run in an
  // order the canvas cannot show. Its "done" link becomes "next" so it flows
  // into the card now beneath it; a stale goto from an earlier layout would
  // otherwise send the run somewhere else.
  const onDrop = (dragged: string, at: { under?: string; before?: string }) => {
    const CH = 60; // BlockCanvas CARD_H
    const blocks = project.blocks;
    const d = blocks.find((b) => b.id === dragged);
    if (!d) return;
    const anchorId = at.before ?? at.under ?? null;
    const anchor = anchorId ? blocks.find((b) => b.id === anchorId) : null;
    const x = anchor ? anchor.x : d.x;
    const y = anchor ? (at.before ? anchor.y : anchor.y + CH) : d.y;
    patch(project.id, {
      blocks: blocks.map((b) => {
        if (b.id === dragged) return { ...b, x, y, on_done: "next" as Branch };
        // Same column, at or below the new slot: slide down to make room.
        if (Math.abs(b.x - x) < 6 && b.y >= y) return { ...b, y: b.y + CH };
        return b;
      }),
    });
  };

  const tidyUp = () => {
    void tidy(project.id).then(() => {
      toast.undo(t("projectEditor.tidiedUp"), () => { void undo(); });
    });
  };

  const toggleSecret = (blockId: string, name: string) =>
    patch(project.id, {
      blocks: project.blocks.map((x) =>
        x.id === blockId
          ? {
              ...x,
              secrets: x.secrets.includes(name)
                ? x.secrets.filter((n) => n !== name)
                : [...x.secrets, name],
            }
          : x,
      ),
    });

  const setBranch = (blockId: string, which: "on_done" | "on_fail", b: Branch) =>
    patch(project.id, {
      blocks: project.blocks.map((x) => (x.id === blockId ? { ...x, [which]: b } : x)),
    });

  const setParam = (blockId: string, name: string, value: unknown) =>
    patch(project.id, {
      blocks: project.blocks.map((b) =>
        b.id === blockId ? { ...b, params: { ...b.params, [name]: value } } : b,
      ),
    });

  const setRunOpts = (next: Partial<typeof project.run>) =>
    patch(project.id, { run: { ...project.run, ...next } });

  const setRules = (rules: TrafficRule[]) => patch(project.id, { rules });

  // A step's Pick: the next click on the page names its target.
  const onPicked = (target: Picked | null) => {
    const id = pickFor;
    setPickFor(null);
    if (!id || !target) return;
    if (!target.selector) { toast.err(t("projectEditor.pickNothing")); return; }
    setParam(id, "selector", target.selector);
  };

  const removeBlock = (id: string) =>
    patch(project.id, { blocks: project.blocks.filter((b) => b.id !== id) });

  const toggleBlock = (id: string) =>
    patch(project.id, {
      blocks: project.blocks.map((b) => (b.id === id ? { ...b, enabled: !b.enabled } : b)),
    });

  return (
    <>
      <EditorHeader
        project={project}
        run={run}
        browserOpen={showBrowser}
        selectName={focusName}
        onNameSelected={nameFocused}
        dirty={dirty}
        saving={saving}
        saveError={saveError}
        onBack={() => { void leaveEditor(); }}
        onRename={(name) => patch(project.id, { name })}
        onDescribe={(notes) => patch(project.id, { notes })}
        onSave={() => { commitFocusedField(); if (!saving) void save(project.id); }}
        onRunOpts={setRunOpts}
        onToggleBrowser={() => { if (showBrowser) closeBrowser(); else setShowBrowser(true); }}
        onShowLog={() => { focusNext.current = "log"; setBrowserTab("log"); setShowBrowser(true); }}
        onRun={() => { void tryRun(); }}
        onStop={() => automationRunStop(project.id)}
        onFleet={() => automationFleetWindow()}
        onExport={() => { void tryExport(); }}
        onTidy={tidyUp}
      />
      <PageBody scroll={false}>
        {/* The canvas and a 320 px side panel; the browser is a third column
            only while it is open. The browser gives way first (380 down to
            320 px) so the canvas keeps 360. Beside an open sidebar a 1280 px
            window has 998 px here, 26 short of the three minimums: the canvas
            gives those up, down to 240 px. Only past that does the body
            scroll sideways (a 1024 px window with the sidebar open). */}
        <div
          ref={gridRef}
          className={cn(
            "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-3.5",
            showBrowser
              ? "grid-cols-[minmax(clamp(240px,calc(100%_-_664px),360px),1fr)_320px_var(--browser-w)] overflow-x-auto"
              : "grid-cols-[minmax(0,1fr)_320px]",
          )}
          style={showBrowser ? ({ "--browser-w": `max(${BROWSER_MIN}px, min(${browserPref}px, calc(100% - ${BROWSER_RESERVED}px)))` } as CSSProperties) : undefined}
        >
          <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center gap-1.5 py-1.5 pl-3 pr-1.5">
              <span className="text-secondary text-text-soft-400 tabular-nums">
                {project.blocks.length === 1
                  ? t("projectEditor.stepCountOne")
                  : t("projectEditor.stepCountMany", { n: project.blocks.length })}
              </span>
              <Tooltip content={noEdit ?? undefined}>
                <Button
                  variant="neutral" mode="ghost" size="2xsmall"
                  className="ml-auto"
                  leftIcon={<AddIcon className="size-3.5" />}
                  disabled={!!noEdit}
                  aria-description={noEdit ?? undefined}
                  onClick={() => { if (noEdit) return; setPickAt(null); setPicking(true); }}
                >
                  {t("projectEditor.addStep")}
                </Button>
              </Tooltip>
            </div>
            <div className="min-h-0 flex-1">
              {/* Held back for the one layout pass of a project with no positions, so the first fit sees the laid-out steps. */}
              {!unplaced && <BlockCanvas
                blocks={project.blocks}
                startId={project.run.start}
                resetKey={project.id}
                selected={openStep}
                active={
                  run?.workers.find((w) => w.status === "running" && w.step > 0)
                    ? project.blocks
                        .filter((b) => b.enabled)
                        .sort((a, b) => Math.round(a.x / 40) - Math.round(b.x / 40) || a.y - b.y)[
                        (run.workers.find((w) => w.status === "running")?.step ?? 1) - 1
                      ]?.id ?? null
                    : null
                }
                onSelect={(id) => { setOpenStep(id); if (id) setRightTab("step"); }}
                onMove={(id, x, y) => placeBlock(project.id, id, x, y)}
                onConnect={(from, port, to) => connect(project.id, from, port, to)}
                onDrop={onDrop}
                onMoveEnd={() => { void commitMove(project.id); }}
                onSetStart={(id) => setRunOpts({ start: id })}
                onDelete={removeBlock}
                onAddAt={(x, y) => { if (noEdit) return; setPickAt({ x, y }); setPicking(true); }}
              />}
            </div>
          </Card>

          <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="shrink-0 p-2">
              <SegmentControl
                size="xsmall"
                aria-label={t("projectEditor.panels")}
                value={rightTab}
                onChange={(v) => setRightTab(v as "step" | "traffic")}
                items={[
                  { value: "step", label: t("projectEditor.tabStep") },
                  { value: "traffic", label: t("projectEditor.tabTraffic"), count: project.rules?.length || undefined },
                ]}
              />
            </div>
            {/* Never sideways: every field fits 320 px. The side padding is
                the room focus rings need inside the scroller. */}
            <div data-editor-panel className="scrollbar-on-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3.5 pb-3.5 pt-1" {...sideScroll}>
            <fieldset disabled={!!noEdit} className="m-0 flex min-h-full min-w-0 flex-col border-0 p-0">
            {/* Both stay mounted; only the inactive one hides, so a rule's
                open form or a step's draft survives a switch. */}
            <div hidden={rightTab !== "traffic"} className="flex min-h-full flex-col">
              <TrafficPanel
                rules={project.rules ?? []}
                onRulesChange={setRules}
                profileId={target}
                live={browser.live}
                applied={applied}
                onApplied={setApplied}
                openRule={newRule}
              />
            </div>
            <div hidden={rightTab !== "step"} className="flex min-h-full flex-col">
              {/* Keyed by step: a card selects on mousedown, before the field
                  it leaves blurs, and a blur commits. One instance per step
                  means that commit lands on the step it was typed in. */}
              <StepDetails
                key={openStep ?? ""}
                block={project.blocks.find((b) => b.id === openStep) ?? null}
                steps={project.blocks}
                onParam={setParam}
                onSecret={toggleSecret}
                onBranch={setBranch}
                onToggle={toggleBlock}
                pick={{
                  available: browser.live,
                  active: !!openStep && pickFor === openStep,
                  onToggle: () => {
                    if (!openStep) return;
                    if (pickFor === openStep) { setPickFor(null); return; }
                    setPickFor(openStep);
                    setShowBrowser(true);
                    setBrowserTab("page");
                  },
                }}
              />
            </div>
            </fieldset>
            </div>
          </Card>

          {showBrowser && (
            <div className="relative grid min-h-0 min-w-0">
            <BrowserResizeHandle
              width={browserShown}
              min={BROWSER_MIN}
              max={browserMax}
              onChange={setBrowserPref}
              onCommit={(w) => { setBrowserPref(w); saveBrowserWidth(w); }}
              onReset={() => { setBrowserPref(BROWSER_DEFAULT); saveBrowserWidth(BROWSER_DEFAULT); }}
            />
            <BrowserColumn
              profiles={profiles}
              target={target}
              onTarget={setTarget}
              browser={browser}
              recording={recording}
              onRecording={setRecording}
              tab={browserTab}
              onTab={setBrowserTab}
              run={run}
              onClose={() => { focusNext.current = "switch"; closeBrowser(); }}
              page={
                <LiveView
                  profileId={target}
                  live={browser.live}
                  onAction={onAction}
                  onRecorded={onRecorded}
                  recording={recording}
                  picking={!!pickFor}
                  onPicked={onPicked}
                />
              }
              pageNote={
                !browser.live ? (display?.limited ? display.note : null)
                : pickFor ? t("liveView.pickHint")
                : recording ? t("liveView.recordingNote")
                : display?.limited ? display.note
                : t("liveView.menuHint")
              }
              requests={
                <TrafficRequests
                  observer={observer}
                  profileId={target}
                  live={browser.live}
                  onAddStep={(kind, params, label) => {
                    const b = newBlock(kind, params, label);
                    addBlock(project.id, b);
                    setRightTab("step");
                    setOpenStep(b.id);
                  }}
                  onAddRule={(rule) => {
                    setRules([...(project.rules ?? []), rule]);
                    setNewRule(rule);
                    setRightTab("traffic");
                  }}
                  onMounted={() => setApplied((a) => a ?? new Set())}
                />
              }
            />
            </div>
          )}
        </div>

        {pickerLife.mounted && (
          <BlockPicker
            key={pickerLife.session}
            open={picking}
            modulesSeen={modulesSeen}
            onPick={addFromLibrary}
            onManageModules={() => setManaging(true)}
            onClose={() => setPicking(false)}
          />
        )}
        {modulesLife.mounted && (
          <ModulesDialog key={modulesLife.session} open={managing} onClose={() => { setManaging(false); setModulesSeen((n) => n + 1); }} />
        )}
      </PageBody>

      {runReview && (
        <ReviewDialog
          mode="run"
          name={project.name}
          lines={runReview}
          onCancel={() => setRunReview(null)}
          onConfirm={() => { setRunReview(null); markReviewed(project.id); void startProjectRun(savedProject() ?? project); }}
        />
      )}
    </>
  );
}

/** A recorded page for a step label: origin and path. A query or fragment
 *  can hold a token or a session id, and labels travel in exports (SEC-06). */
function pageLabel(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}
