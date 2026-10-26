import { useEffect, useState, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AlertModal, Button } from "@proxyshard/shardx-ui-kit";
import { appResetPending, type ResetPending } from "../../../entities/settings";
import { useT } from "../../../shared/i18n";
import { titleBarOnMouseDown } from "../../../shared/lib/dragWindow";
import { rawError } from "../../../shared/lib/errors";
import { ShellWindowControls } from "../../../widgets/WindowControls";
import { finishUnfinished, setNotesAside, undoUnfinished } from "../model/deleteAllData";

/// Before anything else loads: a Delete all data that did not finish (a
/// crash, a forced quit) leaves a journal, and the app opens on this screen
/// instead, locked (no starts, no local API, no runs) until the person
/// undoes or finishes the reset, or sets its notes aside. Nothing behind it
/// has read the data yet. A question the backend can't answer shows this
/// screen too, never the app: it fails closed, with a way out.
export function ResetPendingGate({ children }: { children: ReactNode }) {
  // undefined: still asking; null: no reset waiting.
  const [pending, setPending] = useState<ResetPending | null | undefined>(undefined);
  useEffect(() => {
    // Plain-browser dev (no IPC): nothing can be waiting.
    if (!("__TAURI_INTERNALS__" in window)) { setPending(null); return; }
    appResetPending().then(
      (p) => setPending(p ?? null),
      (e: unknown) => setPending({ journal: "", backups: [], moved: 0, total: 0, missing: [], error: rawError(e) ?? String(e) }),
    );
  }, []);
  if (pending === undefined) return null;
  if (pending === null) return <>{children}</>;
  return <Unfinished pending={pending} />;
}

function Unfinished({ pending }: { pending: ResetPending }) {
  const t = useT();
  const [busy, setBusy] = useState<"undo" | "finish" | "aside" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const run = async (which: "undo" | "finish" | "aside") => {
    setBusy(which);
    setFailed(null);
    try {
      await (which === "undo" ? undoUnfinished() : which === "finish" ? finishUnfinished() : setNotesAside());
    } catch (e) {
      setFailed(rawError(e) ?? String(e));
      setBusy(null);
    }
  };
  const [first, other] = pending.backups;
  const code = { code: (s: string) => <code>{s}</code> };
  const reveal = (path: string) => void revealItemInDir(path).catch(() => {});
  // Pressing text or a button must not start a window drag (PC-013).
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const readable = !pending.error;
  // The folder to show: the backup when the notes read, else the notes.
  const shown = readable ? first : pending.journal;
  return (
    <div
      data-reset-pending
      className="fixed inset-0 z-(--layer-chrome) flex items-center justify-center bg-bg-canvas text-text-strong-950"
      onMouseDown={titleBarOnMouseDown}
    >
      <ShellWindowControls />
      <main className="flex w-[480px] max-w-full flex-col gap-2 px-9 py-8 text-center" onMouseDown={stop}>
        <h1 className="m-0 text-page-title text-text-strong-950">{t("resetPending.title")}</h1>
        {readable ? (
          <>
            <p data-reset-pending-where className="m-0 break-words text-body text-text-sub-600">
              {other ? t("resetPending.bodyTwo", { path: first, other }) : t("resetPending.body", { path: first ?? "" })}
            </p>
            <p className="m-0 text-secondary tabular-nums text-text-soft-400">{t("resetPending.progress", { moved: pending.moved, total: pending.total })}</p>
            {pending.missing.length > 0 && (
              <p data-reset-pending-missing className="m-0 break-words text-secondary font-medium text-text-strong-950">
                {t("resetPending.offline", { path: pending.missing[0] })}
              </p>
            )}
            <p className="m-0 text-secondary text-text-sub-600">{t("resetPending.choose")}</p>
          </>
        ) : (
          <>
            <p className="m-0 text-body text-text-sub-600">{t.rich("resetPending.unreadable", code)}</p>
            <p className="m-0 break-words text-secondary text-text-soft-400">{pending.error}</p>
            <p className="m-0 text-secondary text-text-sub-600">{t.rich("resetPending.setAsideHint", code)}</p>
          </>
        )}
        {pending.journal && (
          <p data-reset-pending-notes className="m-0 break-words text-secondary text-text-soft-400">{t("resetPending.notesAt", { path: pending.journal })}</p>
        )}
        {failed && (
          <div role="alert" className="flex flex-col gap-1">
            <p className="m-0 text-secondary font-medium text-text-strong-950">{t.rich("resetPending.failed", code)}</p>
            <p className="m-0 break-words text-secondary text-text-soft-400">{failed}</p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {shown && (
            <Button variant="neutral" mode="ghost" size="xsmall" onClick={() => reveal(shown)}>
              {t("resetPending.showFolder")}
            </Button>
          )}
          {/* The way out that is always there: the notes renamed, never
              deleted, behind a question. */}
          <Button variant="neutral" mode={readable ? "ghost" : "stroke"} size="xsmall" disabled={busy !== null} isLoading={busy === "aside"} onClick={() => setAsking(true)}>
            {t("resetPending.setAside")}
          </Button>
          {readable && (
            <>
              <Button variant="neutral" mode="stroke" size="xsmall" disabled={busy !== null} isLoading={busy === "finish"} onClick={() => void run("finish")}>
                {t("resetPending.finish")}
              </Button>
              <Button variant="primary" mode="filled" size="xsmall" disabled={busy !== null} isLoading={busy === "undo"} onClick={() => void run("undo")}>
                {t("resetPending.undo")}
              </Button>
            </>
          )}
        </div>
      </main>
      <AlertModal
        open={asking}
        onClose={() => setAsking(false)}
        status="warning"
        title={t("resetPending.setAsideTitle")}
        description={t("resetPending.setAsideBody")}
        cancelLabel={t("resetPending.cancel")}
        onCancel={() => setAsking(false)}
        confirmVariant="primary"
        confirmLabel={t("resetPending.setAsideConfirm")}
        onConfirm={() => { setAsking(false); void run("aside"); }}
      />
    </div>
  );
}
