import { useState } from "react";
import { DialogModal } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { teamError } from "../../../entities/team";

/// A confirm whose action runs in it: a refusal (the server's reason) stays
/// in the dialog's footer, and the dialog closes only once it worked.
export function RunConfirmDialog({ open, onClose, title, message, confirmLabel, run }: {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  run: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await run();
      onClose();
    } catch (e) {
      setErr(teamError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogModal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      // Read with the question on open, as every destructive confirm is (A11Y-07).
      subtitle={message}
      confirmLabel={confirmLabel}
      confirmVariant="error"
      onConfirm={() => void submit()}
      cancelLabel={t("confirm.cancel")}
      isLoading={busy}
      footerNote={err ? <span role="alert" data-run-error className="text-error-text">{err}</span> : undefined}
    />
  );
}
