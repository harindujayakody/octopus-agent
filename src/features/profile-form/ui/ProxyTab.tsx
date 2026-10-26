import { PropertySheet } from "../../../shared/ui/peek";
import { useT } from "../../../shared/i18n";
import { patchDraft, patchForm, type ProfileFormDraft } from "../model/useProfileForm";
import { ProxyRow } from "./fields";

/// Proxy: the picker ("No proxy", every proxy, a search), and a new proxy
/// from a pasted line, added only when the form is saved. The walk through
/// the form points at the picker and its help line.
export function ProxyTab({ draft }: { draft: ProfileFormDraft }) {
  const t = useT();
  return (
    <div data-tour="form-proxy" className="flex flex-col gap-2">
      <PropertySheet>
        <ProxyRow
          value={draft.form.proxy_id}
          // A pick of a proxy that exists drops the line not added yet.
          onChange={(proxy_id) => { patchDraft({ newProxyLine: "" }); patchForm({ proxy_id }); }}
          newLine={draft.newProxyLine}
          onNewLine={(newProxyLine) => patchDraft({ newProxyLine })}
        />
      </PropertySheet>
      <p className="m-0 text-secondary text-text-soft-400">{t("profileForm.proxyHelp")}</p>
    </div>
  );
}
