import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AlertModal, Button, DialogModal, Input, useLatched } from "@proxyshard/shardx-ui-kit";
import { appResetPending, appResetPlan, type ResetPlan } from "../../../entities/settings";
import { useT } from "../../../shared/i18n";
import { titleBarOnMouseDown } from "../../../shared/lib/dragWindow";
import { fmtBytes } from "../../../shared/lib/format";
import { useDialogLife } from "../../../shared/lib/useDialogLife";
import { toast } from "../../../shared/model/toast";
import { hasUnsaved } from "../../../shared/model/unsaved";
import { ShellWindowControls } from "../../../widgets/WindowControls";
import { failureOf, moveAllData, restartFresh } from "../model/deleteAllData";

/** Typed exactly, case and all, in every language: a word a person cannot
 *  type by accident on the way to Enter. */
const WORD = "DELETE";

type Step = "warn" | "type";
type Phase = { kind: "idle" } | { kind: "moving" } | { kind: "done"; backups: string[] };

/** Shows a folder in Finder or Explorer; says so when it can't. */
function useReveal() {
  const t = useT();
  return (path: string) => void revealItemInDir(path).catch(() => toast.err(t("dataRootCard.openFailed")));
}

/** "Your old data is kept in …", for one backup folder or two. */
export function KeptIn({ backups }: { backups: string[] }) {
  const t = useT();
  return backups.length > 1
    ? t("deleteAllData.keptInTwo", { path: backups[0], other: backups[1] })
    : t("deleteAllData.keptIn", { path: backups[0] ?? "" });
}

/** Settings > Storage: Delete all data, behind two warnings (owner,
 *  2026-10-08). Nothing is deleted: the data moves into backup folders,
 *  which both the first warning and the end say. The first warning counts
 *  what goes, from the plan the backend will hold the reset to; the second
 *  waits for DELETE. Cancel has the keyboard in both, so Enter or Space
 *  alone never starts it. `onChanged` runs when a backup may have appeared. */
export function DeleteAllData({ describedBy, onChanged }: { describedBy?: string; onChanged?: () => void }) {
  const t = useT();
  const [step, setStep] = useState<Step | null>(null);
  const [plan, setPlan] = useState<ResetPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [changed, setChanged] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [stuck, setStuck] = useState<{ reason: string; backups: string[] } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const life = useDialogLife(step !== null);
  const shown = useLatched(step);
  const ready = typed === WORD;

  /** Reads the plan, then opens the first warning on it. */
  const ask = async (again: boolean) => {
    setPlanning(true);
    try {
      const p = await appResetPlan();
      setPlan(p);
      setChanged(again);
      setUnsaved(hasUnsaved());
      setTyped("");
      setStep("warn");
    } catch (e) {
      toast.fail({ title: t("deleteAllData.nothingMoved"), detail: failureOf(e).reason });
    } finally {
      setPlanning(false);
    }
  };
  const close = () => setStep(null);
  // The second warning is a dialog of its own, opened from the first: on
  // Cancel, or after a refusal, the keyboard comes back to this button, not
  // to the first warning's Continue, which is gone.
  const active = step !== null || phase.kind !== "idle" || stuck !== null;
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active) triggerRef.current?.focus({ preventScroll: true });
    wasActive.current = active;
  }, [active]);

  const confirm = async () => {
    if (step === "warn") { setStep("type"); return; }
    if (!ready || !plan) return;
    setStep(null);
    setPhase({ kind: "moving" });
    try {
      setPhase({ kind: "done", backups: await moveAllData(plan.id) });
    } catch (e) {
      setPhase({ kind: "idle" });
      const failed = failureOf(e);
      // The disk moved on since the counts were shown: count again and ask again.
      if (failed.kind === "changed") void ask(true);
      else if (failed.kind === "stuck") {
        // Not a toast: the person has to act, so it stays until closed.
        const pending = await appResetPending().catch(() => null);
        setStuck({ reason: failed.reason, backups: pending?.backups ?? plan.backups });
        onChanged?.();
      } else toast.fail({ title: t("deleteAllData.nothingMoved"), detail: failed.reason });
    }
  };

  const c = plan?.counts;
  return (
    <>
      <Button
        ref={triggerRef} variant="error" mode="lighter" size="xsmall" aria-describedby={describedBy}
        isLoading={planning} disabled={phase.kind !== "idle"} onClick={() => void ask(false)}
      >
        {t("deleteAllData.button")}
      </Button>
      {life.mounted && shown && plan && c && (
        <DialogModal
          // Each warning its own dialog: read out with its own title, and
          // Cancel takes the keyboard when it opens.
          key={shown}
          open={step === shown}
          onClose={close}
          onCancel={close}
          size="sm"
          showClose={false}
          title={shown === "warn" ? t("deleteAllData.warnTitle") : t("deleteAllData.typeTitle")}
          subtitle={shown === "warn" ? t("deleteAllData.warnSubtitle") : t("deleteAllData.typeSubtitle")}
          cancelLabel={t("deleteAllData.cancel")}
          confirmVariant="error"
          confirmLabel={shown === "warn" ? t("deleteAllData.continue") : t("deleteAllData.confirm")}
          onConfirm={() => void confirm()}
          // Enter in the field does nothing until the word is there.
          isDisabled={shown === "type" && !ready}
        >
          {shown === "warn" ? (
            <div data-delete-all-list className="flex flex-col gap-2 pb-4 text-help text-text-sub-600">
              {changed && <p data-delete-all-changed className="m-0 font-medium text-text-strong-950">{t("deleteAllData.changed")}</p>}
              <p className="m-0">{t("deleteAllData.listLead")}</p>
              <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 tabular-nums">
                <li>{c.profiles === 1 ? t("deleteAllData.itemProfilesOne") : t("deleteAllData.itemProfiles", { n: c.profiles })}</li>
                <li>{c.proxies === 1 ? t("deleteAllData.itemProxiesOne") : t("deleteAllData.itemProxies", { n: c.proxies })}</li>
                <li>{c.fingerprints === 1 ? t("deleteAllData.itemFingerprintsOne") : t("deleteAllData.itemFingerprints", { n: c.fingerprints })}</li>
                <li>{c.extensions === 1 ? t("deleteAllData.itemExtensionsOne") : t("deleteAllData.itemExtensions", { n: c.extensions })}</li>
                <li>{c.bookmarks === 1 ? t("deleteAllData.itemBookmarksOne") : t("deleteAllData.itemBookmarks", { n: c.bookmarks })}</li>
                <li>{c.projects === 1 ? t("deleteAllData.itemAutomationOne") : t("deleteAllData.itemAutomation", { n: c.projects })}</li>
                <li>{t("deleteAllData.itemSettings")}</li>
              </ul>
              <p data-delete-all-size className="m-0 tabular-nums">{t("deleteAllData.size", { size: fmtBytes(plan.total_bytes) })}</p>
              <p data-delete-all-backup className="m-0 break-words"><KeptIn backups={plan.backups} /></p>
              <p className="m-0">{t("deleteAllData.closes")}</p>
              {unsaved && <p data-delete-all-unsaved className="m-0 font-medium text-text-strong-950">{t("deleteAllData.unsaved")}</p>}
            </div>
          ) : (
            <div className="pb-4">
              <Input
                aria-label={t("deleteAllData.typeLabel")}
                inputSize="xsmall"
                technical
                // Cancel, not the field, has the keyboard as it opens.
                data-autofocus-skip=""
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
          )}
        </DialogModal>
      )}
      {stuck && <StuckDialog {...stuck} onClose={() => setStuck(null)} />}
      {phase.kind !== "idle" && <Whole phase={phase} />}
    </>
  );
}

/** The one failure the reset could not undo: where the data is and what to
 *  do, until the person closes it. The app stays locked; its next start
 *  offers to undo or finish the reset. */
function StuckDialog({ reason, backups, onClose }: { reason: string; backups: string[]; onClose: () => void }) {
  const t = useT();
  const reveal = useReveal();
  const code = { code: (s: string) => <code>{s}</code> };
  return (
    <AlertModal
      open
      onClose={onClose}
      status="error"
      title={t("deleteAllData.stuck")}
      description={
        <span data-delete-all-stuck className="flex flex-col gap-2">
          <span className="block break-words text-text-strong-950">
            {backups.length > 1
              ? t.rich("deleteAllData.stuckBodyTwo", code, { path: backups[0], other: backups[1] })
              : t.rich("deleteAllData.stuckBody", code, { path: backups[0] ?? "" })}
          </span>
          <span className="block break-words">{reason}</span>
        </span>
      }
      cancelLabel={t("deleteAllData.close")}
      onCancel={onClose}
      confirmVariant="primary"
      confirmLabel={t("deleteAllData.showFolder")}
      onConfirm={() => backups[0] && reveal(backups[0])}
    />
  );
}

/** The whole window while the data moves, then where it went and the
 *  restart: in words, with the window's own caption buttons. Nothing behind
 *  it takes a click or a key; a refused Quit or close says why here. */
function Whole({ phase }: { phase: Exclude<Phase, { kind: "idle" }> }) {
  const t = useT();
  const reveal = useReveal();
  const ref = useRef<HTMLDivElement>(null);
  const restartRef = useRef<HTMLButtonElement>(null);
  const [restarting, setRestarting] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    ref.current?.focus({ preventScroll: true });
    return () => root?.removeAttribute("inert");
  }, []);
  // The backend's "Wait for Delete all data to finish." lands as a toast,
  // which this screen covers: it is said here too.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let un: (() => void) | undefined;
    let gone = false;
    void listen<string>("launcher-warning", (e) => setRefused(e.payload)).then((fn) => { if (gone) fn(); else un = fn; });
    return () => { gone = true; un?.(); };
  }, []);
  const done = phase.kind === "done" ? phase.backups : null;
  useEffect(() => { if (done) restartRef.current?.focus({ preventScroll: true }); }, [done]);
  return createPortal(
    <div
      ref={ref}
      tabIndex={-1}
      data-deleting-all={phase.kind}
      className="fixed inset-0 z-(--layer-chrome) flex items-center justify-center bg-bg-canvas outline-hidden"
      onMouseDown={titleBarOnMouseDown}
    >
      <ShellWindowControls />
      <div className="flex w-[460px] max-w-full flex-col items-center gap-4 px-4 text-center" onMouseDown={(e) => e.stopPropagation()}>
        <div role="status" className="flex flex-col items-center gap-1">
          {done ? (
            <>
              <h1 className="m-0 text-section-title text-text-strong-950">{t("deleteAllData.doneTitle")}</h1>
              <p data-delete-all-backup className="m-0 break-words text-help text-text-sub-600"><KeptIn backups={done} /></p>
            </>
          ) : (
            <>
              <p className="m-0 text-section-title text-text-strong-950">{t("deleteAllData.moving")}</p>
              <p className="m-0 text-help text-text-sub-600">{t("deleteAllData.movingNote")}</p>
              {refused && <p data-delete-all-refused className="m-0 text-help font-medium text-text-strong-950">{refused}</p>}
            </>
          )}
        </div>
        {done && (
          <div className="flex justify-center gap-2">
            <Button variant="neutral" mode="stroke" size="xsmall" onClick={() => done[0] && reveal(done[0])}>
              {t("deleteAllData.showFolder")}
            </Button>
            <Button
              ref={restartRef} variant="primary" mode="filled" size="xsmall" isLoading={restarting}
              onClick={() => { setRestarting(true); void restartFresh().catch(() => setRestarting(false)); }}
            >
              {t("deleteAllData.restart")}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Settings > Storage, while a backup exists: a quiet way to the old data. */
export function ShowBackupButton({ path, describedBy }: { path: string; describedBy?: string }) {
  const t = useT();
  const reveal = useReveal();
  return (
    <Button variant="neutral" mode="stroke" size="xsmall" aria-describedby={describedBy} onClick={() => reveal(path)}>
      {t("deleteAllData.showBackup")}
    </Button>
  );
}
