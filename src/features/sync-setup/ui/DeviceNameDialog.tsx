import { useState } from "react";
import { DialogModal, Input } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { syncError, useSync } from "../../../entities/sync";

const MAX = 64;

/// The name this computer goes by on the person's other computers ("Open on
/// …"): a Windows default such as DESKTOP-7GH2K9L tells them nothing.
export function DeviceNameDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const current = useSync((s) => s.state?.connection?.device_name ?? "");
  const own = useSync((s) => s.state?.connection?.own);
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const next = name.trim();
  const ready = next !== "" && next !== current;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await useSync.getState().setDeviceName(next);
      onClose();
      toast.saved(t("sync.deviceRenamed", { name: next }));
    } catch (e) {
      setErr(syncError(e, own));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogModal
      open={open}
      onClose={onClose}
      size="sm"
      dirty={name !== current}
      title={t("sync.deviceRenameTitle")}
      confirmLabel={t("sync.deviceRenameConfirm")}
      onConfirm={() => void submit()}
      isLoading={busy}
      isDisabled={!ready}
      footerNote={err ? <span role="alert" className="text-error-text">{err}</span> : undefined}
    >
      {/* Enter in the field is the dialog's own Rename. */}
      <div className="flex flex-col gap-3 py-4">
        <Input
          inputSize="xsmall"
          label={t("sync.deviceNameLabel")}
          hint={t("sync.deviceNameHint")}
          maxLength={MAX}
          autoFocus
          value={name}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => { setName(e.target.value); setErr(null); }}
        />
      </div>
    </DialogModal>
  );
}
