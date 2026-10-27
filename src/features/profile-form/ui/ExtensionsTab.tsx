import { useEffect, useState } from "react";
import { Badge } from "@proxyshard/shardx-ui-kit";
import { extensionName, useExtensions } from "../../../entities/extension";
import { firefoxAddonList, type FirefoxAddon } from "../../firefox-addons/api";
import { useT } from "../../../shared/i18n";
import type { ProfileFormDraft } from "../model/useProfileForm";

/// Extensions: none are picked per profile. Every Chrome extension of the
/// library loads into every Chromium-family profile, every Firefox add-on into
/// every Firefox profile, each pinned on the toolbar; this lists what this
/// profile's browser gets.
export function ExtensionsTab({ draft }: { draft: ProfileFormDraft }) {
  const t = useT();
  const firefox = draft.form.engine === "firefox";
  const init = useExtensions((s) => s.init);
  const chrome = useExtensions((s) => s.items);
  const [addons, setAddons] = useState<FirefoxAddon[]>([]);
  useEffect(() => { init(); }, [init]);
  useEffect(() => {
    if (firefox) firefoxAddonList().then(setAddons, () => setAddons([]));
  }, [firefox]);
  const names = firefox ? addons.map((a) => a.name || a.id) : chrome.map(extensionName);
  return (
    <div data-tour="form-extensions" data-extensions-global className="flex flex-col gap-3">
      <p className="m-0 text-secondary text-text-sub-600">
        {firefox ? t("profileForm.extensionsGlobalFirefox") : t("profileForm.extensionsGlobal")}
      </p>
      {names.length === 0 ? (
        <p className="m-0 text-secondary text-text-soft-400">{t("profileForm.extensionsNone")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {names.map((n, i) => (
            <li key={i}><Badge size="small" color="gray">{n}</Badge></li>
          ))}
        </ul>
      )}
    </div>
  );
}
