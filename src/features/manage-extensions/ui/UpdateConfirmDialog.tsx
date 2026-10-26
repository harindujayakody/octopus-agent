import { DialogModal, useLatched } from "@proxyshard/shardx-ui-kit";
import { extensionName, hoursSince, useExtensionUpdates, type ExtensionUpdate } from "../../../entities/extension";
import { useT, type T } from "../../../shared/i18n";
import { fmtBytes } from "../../../shared/lib/format";
import { grantWords } from "../lib/grantWords";
import { sentences } from "../lib/sentences";

/** "Download size: 28.1 MB. Appeared 3 hours ago." Each part only when known. */
function facts(t: T, u: ExtensionUpdate): string[] {
  const out: string[] = [];
  if (u.size) out.push(t("extensions.updateSize", { size: fmtBytes(u.size) }));
  if (u.first_seen) {
    const n = hoursSince(u.first_seen, Date.now());
    out.push(n === 0 ? t("extensions.seenRecently") : n === 1 ? t("extensions.seenHoursOne", { n }) : t("extensions.seenHoursMany", { n }));
  }
  return out;
}

/// An update that asks first (§3.7): the access it gains, its size and age,
/// and for a weak link both names and how many files match. Update lets in
/// exactly the version shown.
export function UpdateConfirmDialog() {
  const t = useT();
  const ask = useExtensionUpdates((s) => s.ask);
  const setAsk = useExtensionUpdates((s) => s.setAsk);
  const update = useExtensionUpdates((s) => s.update);
  // The question stays on screen while the dialog leaves.
  const shown = useLatched(ask);
  if (!shown) return null;
  const { entry, update: u } = shown;
  const c = u.confirm;
  const grown = c?.grown ?? [];
  const close = () => setAsk(null);
  return (
    <DialogModal
      open={ask !== null}
      onClose={close}
      title={t("extensions.confirmTitle", { name: extensionName(entry), version: u.latest ?? "" })}
      confirmLabel={t("extensions.updateItem")}
      // Few files alike: it may be another extension, so Update is the risky choice.
      confirmVariant={c?.reason === "identity" ? "error" : "primary"}
      onConfirm={() => { close(); void update(entry, true); }}
      cancelLabel={t("extensions.cancel")}
      onCancel={close}
    >
      <div data-update-confirm={c?.reason} className="flex w-full flex-col gap-3 py-4 text-secondary text-text-sub-600">
        {c?.reason === "identity" && c.names && (
          <p className="m-0 text-text-strong-950">
            {sentences([
              t("extensions.identityNames", { old: c.names.old, new: c.names.new }),
              t("extensions.identityCheck", { percent: Math.round((c.overlap ?? 0) * 100) }),
              t("extensions.mayDiffer"),
            ])}
          </p>
        )}
        {grown.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="m-0 text-text-strong-950">{t("extensions.newPermissions")}</p>
            <ul data-grants className="m-0 flex list-disc flex-col gap-1 ps-5 [overflow-wrap:anywhere]">
              {grown.map((g) => <li key={`${g.kind}:${g.value}`}>{grantWords(t, g)}</li>)}
            </ul>
          </div>
        )}
        {facts(t, u).length > 0 && <p className="m-0">{sentences(facts(t, u))}</p>}
      </div>
    </DialogModal>
  );
}
