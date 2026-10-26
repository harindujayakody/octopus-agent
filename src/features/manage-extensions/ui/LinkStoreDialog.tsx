import { useState } from "react";
import { DialogModal, Input } from "@proxyshard/shardx-ui-kit";
import {
  extensionName, isStoreLink, normalizeExtensionLink, useExtensionUpdates, type ExtensionEntry, type LinkAsk,
} from "../../../entities/extension";
import { useT } from "../../../shared/i18n";
import { sentences } from "../lib/sentences";

/// Link to Web Store (§3.1.5): a Web Store page or a bare id, read as strictly
/// as the backend reads it (SEC-08). When the files decide, the launcher shows
/// what it found first and links on the second press.
export function LinkStoreDialog({ entry, open, onClose }: { entry: ExtensionEntry; open: boolean; onClose: () => void }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [ask, setAsk] = useState<LinkAsk | null>(null);
  const busy = useExtensionUpdates((s) => !!s.working[entry.id]);
  const linkTo = useExtensionUpdates((s) => s.link);
  const link = normalizeExtensionLink(url);
  const valid = link !== "" && isStoreLink(link);
  const name = extensionName(entry);
  const submit = async () => {
    const r = await linkTo(entry, link, ask !== null);
    if (r?.result === "linked") onClose();
    else if (r?.result === "confirm") setAsk(r);
  };
  const percent = ask ? Math.round(ask.overlap * 100) : 0;
  // Weak files or a harmful mark: linking is the risky choice, and the button says so.
  const risky = !!ask && (ask.kin !== "same" || ask.flags.length > 0);
  return (
    <DialogModal
      open={open}
      onClose={onClose}
      dirty={url !== "" && !busy}
      title={ask ? t("extensions.linkConfirmTitle", { name }) : t("extensions.linkStoreTitle")}
      confirmLabel={busy ? t("extensions.checking") : t("extensions.linkConfirm")}
      confirmVariant={risky ? "error" : "primary"}
      onConfirm={() => void submit()}
      isLoading={busy}
      isDisabled={busy || !valid}
      cancelLabel={t("extensions.cancel")}
      onCancel={onClose}
    >
      {ask ? (
        <div data-link-confirm={ask.kin} className="flex w-full flex-col gap-2 py-4 text-secondary text-text-sub-600 [overflow-wrap:anywhere]">
          <p className="m-0 text-text-strong-950">{t("extensions.linkInstalled", { name: ask.names.old, version: ask.installed })}</p>
          <p className="m-0 text-text-strong-950">{t("extensions.linkInStore", { name: ask.names.new, version: ask.store })}</p>
          <p className="m-0">
            {sentences([
              ask.kin === "same" ? t("extensions.linkLooksSame", { percent }) : t("extensions.identityCheck", { percent }),
              ask.kin === "same" ? "" : t("extensions.mayDiffer"),
              ask.allowlisted === false ? t("extensions.notAllowlisted") : "",
            ])}
          </p>
          {ask.flags.length > 0 && <p data-flagged className="m-0 font-medium text-error-text">{t("extensions.flagged")}</p>}
        </div>
      ) : (
        <div className="flex w-full flex-col gap-3 py-4">
          <Input
            label={t("extensions.linkStoreField")}
            inputSize="xsmall"
            className="mono"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://chromewebstore.google.com/detail/…"
            error={link !== "" && !valid ? t("extensions.linkStoreInvalid") : undefined}
          />
          <p className="m-0 text-secondary text-text-soft-400">{t("extensions.linkStoreHelp", { name })}</p>
        </div>
      )}
    </DialogModal>
  );
}
