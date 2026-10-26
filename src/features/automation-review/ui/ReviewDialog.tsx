import { DialogModal } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import type { ReviewLine } from "../lib/review";

/// The steps of a project that reach beyond the page, with their literal
/// values: before it is imported, and before its first Run (SEC-02). The
/// keyboard starts on Cancel.
export function ReviewDialog({ mode, name, lines, onCancel, onConfirm }: {
  mode: "import" | "run";
  name: string;
  lines: ReviewLine[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <DialogModal
      open
      onClose={onCancel}
      title={mode === "import" ? t("automationReview.importTitle", { name }) : t("automationReview.runTitle", { name })}
      closeLabel={t("common.close")}
      cancelLabel={t("automationReview.cancel")}
      onCancel={onCancel}
      confirmLabel={mode === "import" ? t("automationReview.import") : t("automationReview.run")}
      onConfirm={onConfirm}
    >
      <div className="flex flex-col gap-3 py-4">
        <p className="m-0 text-body text-text-sub-600">
          {mode === "import" ? t("automationReview.importIntro") : t("automationReview.runIntro")}
        </p>
        <ul data-review-lines className="list-tile m-0 flex max-h-[320px] list-none flex-col overflow-auto pt-1">
          {lines.map((l, i) => (
            <li key={i} className="row-line relative flex flex-col gap-0.5 px-cell py-2">
              <span className="text-secondary font-medium text-text-strong-950">{l.step}</span>
              <span className="break-all text-mono text-text-sub-600">{l.what}</span>
            </li>
          ))}
        </ul>
      </div>
    </DialogModal>
  );
}
