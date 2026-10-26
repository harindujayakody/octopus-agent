import { useId, useState } from "react";
import { Button, DialogModal, Radio } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { syncError, useSync } from "../../../entities/sync";
import { syncNow } from "../model/actions";

/// Stops sync on this computer. Its own copies always stay; the copy on the
/// server stays too, unless the person removes it. Changes still waiting say so.
export function DisconnectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const disconnect = useSync((s) => s.disconnect);
  const pending = useSync((s) => s.state?.status.pending ?? 0);
  const own = useSync((s) => s.state?.connection?.own);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const name = useId();
  const keepHelp = useId();
  const removeHelp = useId();

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await disconnect(remove);
      onClose();
      toast.ok(remove ? t("sync.disconnectedRemoved") : t("sync.disconnectedKept"));
    } catch (e) {
      setErr(syncError(e, own));
    } finally {
      setBusy(false);
    }
  };

  const choice = (value: boolean, label: string, help: string, helpId: string) => (
    <div className="flex flex-col gap-1">
      <Radio name={name} checked={remove === value} onChange={() => { setRemove(value); setErr(null); }} label={label} aria-describedby={helpId} />
      <p id={helpId} className="m-0 ps-[24px] text-help text-text-sub-600">{help}</p>
    </div>
  );

  return (
    <DialogModal
      open={open}
      onClose={onClose}
      size="sm"
      title={t("sync.disconnectTitle")}
      subtitle={t("sync.disconnectSubtitle")}
      confirmLabel={t("sync.disconnectConfirm")}
      confirmVariant={remove ? "error" : "primary"}
      onConfirm={() => void submit()}
      isLoading={busy}
      footerNote={err ? <span role="alert" className="text-error-text">{err}</span> : undefined}
    >
      <div className="flex flex-col gap-3 py-4">
        {pending > 0 && (
          // Disconnecting drops them: the server never gets them.
          <div data-sync-unsent className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-control bg-warning-alpha-16 px-2.5 py-2 text-help text-text-strong-950">
            <span className="min-w-0 flex-1">{pending === 1 ? t("sync.unsentOne") : t("sync.unsentMany", { n: pending })}</span>
            <Button variant="neutral" mode="stroke" size="3xsmall" disabled={busy} onClick={() => { onClose(); void syncNow(); }}>{t("sync.syncFirst")}</Button>
          </div>
        )}
        <fieldset data-sync-disconnect className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="sr-only">{t("sync.disconnectLegend")}</legend>
          {choice(false, t("sync.keepOnServer"), t("sync.keepOnServerHelp"), keepHelp)}
          {choice(true, t("sync.removeFromServer"), t("sync.removeFromServerHelp"), removeHelp)}
        </fieldset>
      </div>
    </DialogModal>
  );
}
