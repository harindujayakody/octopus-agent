import { useRef } from "react";
import { Button, Modal, useLatched } from "@proxyshard/shardx-ui-kit";
import { unsavedStore, type UnsavedChoice } from "../../shared/model/unsaved";
import { useT } from "../../shared/i18n";

/// The question before an exit drops unsaved changes (manual save): Save,
/// with the keyboard on it, Don't save and Cancel (Esc). `confirmLeave()`
/// asks through the store; this host, next to ConfirmHost, draws it.
export function UnsavedGuard() {
  const t = useT();
  const asking = unsavedStore((s) => s.asking);
  // The question stays on screen while the dialog leaves.
  const shown = useLatched(asking);
  const saveRef = useRef<HTMLButtonElement>(null);
  if (!shown) return null;
  // A running save is waited out: no second answer.
  const answer = (choice: UnsavedChoice) => { if (asking && !asking.saving) asking.answer(choice); };
  return (
    <Modal
      open={asking != null}
      onOpenChange={(o) => { if (!o) answer("cancel"); }}
      role="alertdialog"
      size="sm"
      showClose={false}
      title={t("unsaved.title", { label: shown.label })}
      description={t("unsaved.body")}
      initialFocusRef={saveRef}
      footer={
        <>
          <Button size="xsmall" variant="error" mode="stroke" disabled={shown.saving} onClick={() => answer("discard")}>{t("unsaved.dontSave")}</Button>
          <Button size="xsmall" variant="neutral" mode="stroke" disabled={shown.saving} onClick={() => answer("cancel")}>{t("unsaved.cancel")}</Button>
          <Button ref={saveRef} size="xsmall" isLoading={shown.saving} onClick={() => answer("save")}>{t("unsaved.save")}</Button>
        </>
      }
    />
  );
}
