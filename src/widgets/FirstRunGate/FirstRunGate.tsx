import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, CopyButton, ProgressBar, cn } from "@proxyshard/shardx-ui-kit";
import { clip } from "../../shared/lib/clipboard";
import { useT } from "../../shared/i18n";
import { shellPadClass, titleBarOnMouseDown } from "../../shared/lib/dragWindow";
import { storeBus } from "../../shared/lib/storeBus";
import { LoadingRows } from "../../shared/ui/ListStates";
import { ShellWindowControls } from "../WindowControls";
import { sidebarWidthClass, useRail } from "../Sidebar/Sidebar";
import type { RtFailed, RtInstallError, RtProgress } from "../../shared/types";
import { fmtBytes, fmtBytesProgress } from "../../shared/lib/format";
import { explainError } from "../../shared/lib/errors";
import { engineAnswer } from "./engineEarly";
import { installEngine, noteFailed, noteSeen, noteStatus, reason, retryEngineUpdate, useEngineUpdate, waitsForHand } from "./engineUpdate";

const MB = 1024 * 1024;

/// Holds the app until the browser engine and its fingerprint library are
/// installed and current. A failed download says why and offers Try again
/// (IFACE-09); an update says it is one. An update that stops with the engine
/// kept opens the app on it, with a banner (#122). While the status is
/// checked, the window's frame and controls show (FEEL-40, LAYOUT-08).
export function FirstRunGate({ children }: { children: ReactNode }) {
  const t = useT();
  // null = querying backend; true = reveal; false = show overlay.
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [updating, setUpdating] = useState(false);
  const [prog, setProg] = useState<RtProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Where a first install stopped, when it said (runtime:failed).
  const [stopped, setStopped] = useState<RtInstallError | null>(null);
  // Single in-flight install at a time.
  const installing = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const install = useCallback(async () => {
    if (installing.current) return;
    installing.current = true;
    setErr(null);
    setStopped(null);
    setProg(null);
    try {
      // A stop with the previous engine kept still opens the app: the banner says why.
      await installEngine();
      if (alive.current) setInstalled(true);
      // The library arrived with the engine: the profile store reads it again.
      storeBus.emit("fingerprints");
    } catch (e) {
      if (alive.current) setErr(typeof e === "string" ? e : ((e as Error)?.message ?? String(e)));
    } finally {
      installing.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unProg: (() => void) | undefined;
    let unDone: (() => void) | undefined;
    let unFailed: (() => void) | undefined;

    // Plain-browser dev (vite without Tauri): no IPC — skip the gate so the
    // UI can be previewed; launch attempts will surface their own errors.
    if (!("__TAURI_INTERNALS__" in window)) {
      setInstalled(true);
      return;
    }

    (async () => {
      // The subscriptions and the status question go out together (the
      // question already out since the bundle loaded, on a first run); the
      // subscriptions are in place before any install can start (PERF-18).
      const asked = engineAnswer();
      const [onProgress, onDone, onFailed, answer] = await Promise.all([
        listen<RtProgress>("runtime:progress", (e) => {
          if (cancelled) return;
          // Try again from the banner shows its progress there.
          if (useEngineUpdate.getState().retrying) useEngineUpdate.setState({ progress: e.payload });
          else setProg(e.payload);
        }),
        listen("runtime:done", () => {
          if (cancelled) return;
          setProg(null);
          setInstalled(true);
          storeBus.emit("fingerprints");
        }),
        listen<RtFailed>("runtime:failed", (e) => {
          if (cancelled) return;
          noteFailed(e.payload);
          if (!e.payload.engine_kept) setStopped(e.payload);
        }),
        asked,
      ]);
      unProg = onProgress;
      unDone = onDone;
      unFailed = onFailed;
      if (cancelled) { unProg(); unDone(); unFailed(); return; }
      if ("error" in answer) { setInstalled(false); setErr(answer.error); return; }
      const status = answer.status;
      // The engine there is now: a later try that changes it is an update that went in.
      noteSeen(status);

      // Unsupported platform: let the user in; launch will error if attempted.
      if (!status.spec) {
        setInstalled(true);
        return;
      }
      // Reveal only when the engine + fingerprints are installed AND up to
      // date. An available engine update falls through to the install path,
      // which re-downloads the changed archives.
      if (status.installed && status.fingerprints_installed && !status.update_available) {
        setInstalled(true);
        return;
      }
      // An update that stopped before, with the engine kept: in on that engine.
      // Tried again in the background, its progress in the banner, unless it
      // would meet the same stop, or this session has it already (a language
      // change rebuilds the gate).
      const session = useEngineUpdate.getState();
      if (status.installed && status.fingerprints_installed && (status.install_error?.engine_kept || session.error || session.retrying)) {
        if (!session.error && !session.retrying) {
          noteStatus(status);
          if (!waitsForHand(status)) void retryEngineUpdate(true);
        }
        setInstalled(true);
        return;
      }
      setUpdating(status.installed && status.update_available);
      setInstalled(false);
      void install();
    })();

    return () => {
      cancelled = true;
      unProg?.();
      unDone?.();
      unFailed?.();
    };
  }, [install]);

  if (installed === null) return <GateFrame />;
  if (installed) return <>{children}</>;

  const size = prog?.total ? fmtBytes(prog.total) : fmtBytes(150 * MB);
  // Pressing text or a button must not start a window drag (PC-013).
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div
      className="fixed inset-0 z-(--layer-chrome) flex items-center justify-center bg-bg-canvas text-text-strong-950"
      onMouseDown={titleBarOnMouseDown}
    >
      <ShellWindowControls />
      {/* The screen's one landmark and its h1 (A11Y-19); the caption buttons stay outside. */}
      <main className="w-[460px] px-9 py-8 text-center" onMouseDown={stop}>
        {err ? (
          <>
            {/* The title by where it stopped; the backend's words (about an update) only when no stage says why. */}
            <h1 className="m-0 mb-2 text-page-title text-text-strong-950">
              {stopped?.stage === "space" ? t("firstRunGate.failedSpaceTitle")
                : stopped?.stage === "extract" || stopped?.stage === "verify" ? t("firstRunGate.failedUnpackTitle")
                  : stopped && stopped.stage !== "download" ? t("firstRunGate.failedInstallTitle")
                    : t("firstRunGate.failedTitle")}
            </h1>
            <p className={cn("m-0 text-body text-text-sub-600", stopped ? "mb-5" : "mb-1")}>
              {stopped && stopped.stage !== "download" ? reason(t, stopped) : t("firstRunGate.failedHint")}
            </p>
            {!stopped && <p data-selectable className="m-0 mb-5 break-words text-secondary text-text-soft-400">{explainError(err)}</p>}
            <div className="flex justify-center gap-2">
              {/* The backend's own words, with the paths, for a report. */}
              {stopped && <CopyButton size="xsmall" label={t("kit.copyDetails")} onCopy={async () => { await clip.write(err); }} />}
              <Button variant="neutral" mode="stroke" size="xsmall" onClick={() => void getCurrentWindow().close()}>
                {t("firstRunGate.close")}
              </Button>
              <Button variant="primary" mode="filled" size="xsmall" onClick={() => void install()}>
                {t("firstRunGate.retry")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 className="m-0 mb-2 text-page-title text-text-strong-950">{updating ? t("firstRunGate.updateTitle") : t("firstRunGate.title")}</h1>
            <p className="m-0 mb-6 text-secondary text-text-soft-400">
              {updating ? t("firstRunGate.updateNote", { size }) : t("firstRunGate.downloadNote", { size })}
            </p>
            {prog ? (
              <>
                <div className="mb-1.5 text-left text-secondary tabular-nums text-text-soft-400">
                  {prog.phase === "download"
                    ? t("firstRunGate.progress", { progress: fmtBytesProgress(prog.received, prog.total) })
                    : t("firstRunGate.extracting")}
                </div>
                <ProgressBar aria-label={t("firstRunGate.downloadBar")} value={prog.percent} color="primary" />
              </>
            ) : (
              <div className="text-secondary text-text-soft-400">{t("firstRunGate.contactingCdn")}</div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/// The window's frame while the engine status is checked: the sidebar's
/// place, a header, the list's placeholder rows and the caption buttons in
/// the corner, so the first frame is not blank and Windows users can move or
/// close the window (FEEL-40, LAYOUT-08, PERF-18).
function GateFrame() {
  // The sidebar's own width (its saved rail choice; Peek is never open yet)
  // and its own layer, so nothing moves or changes color when it arrives.
  const rail = useRail();
  return (
    // The shell's two panels on the gray ground (App.tsx, borderless).
    <div data-gate-frame className={cn("relative grid h-full grid-cols-[auto_minmax(0,1fr)] gap-panel bg-bg-canvas", shellPadClass())} onMouseDown={titleBarOnMouseDown}>
      <div className={cn("rounded-panel bg-bg-white-0", sidebarWidthClass(rail))} />
      <main className="flex min-w-0 flex-col overflow-hidden rounded-panel bg-bg-page">
        {/* The page header's place: it draws no rule at rest. */}
        <div className="h-[52px]" />
        {/* The list's place: placeholder rows if the check takes a while
            (PERF-18), in the Profiles table's own geometry (PageBody's
            padding, the table's tile and its 32 px
            header row), so the rows the list shows land where the
            placeholders were. The first block starts right under the
            header, on the sidebar's line, as the page's content does
            (PageBody). */}
        <div className="flex min-h-0 flex-1 flex-col px-gutter pb-5">
          <div className="list-tile min-h-0 flex-1 overflow-hidden">
            <div className="h-[32px]" />
            <LoadingRows />
          </div>
        </div>
      </main>
      <ShellWindowControls />
    </div>
  );
}
