import { AdBlockIcon, AddIcon, DownloadIcon, FolderIcon, GlobeIcon } from "../../../shared/icons";

/** uBlock Origin Lite on the Chrome Web Store: the content blocker that runs on
 *  today's Chromium (Manifest V3), where the full uBlock Origin no longer loads. */
export const UBLOCK_LITE_ID = "ddkjiahejlhfcafbddmgiahcphecmpfh";
import { useExtensions } from "../../../entities/extension";
import { useT } from "../../../shared/i18n";
import { HeaderMenu } from "../../../widgets/PageHeader/HeaderMenu";
import { teamRefusal, useRightsChange } from "../../../entities/space";

/// One "Add extension" with the three ways to add one (CRAFT-29): the
/// primary names the goal, the menu names the source. The two imports wait
/// while one runs (the store has no guard of its own).
export function AddExtensionMenu() {
  const t = useT();
  const busy = useExtensions((s) => s.busy);
  const importFiles = useExtensions((s) => s.importFiles);
  const importFolder = useExtensions((s) => s.importFolder);
  const setLinkOpen = useExtensions((s) => s.setLinkOpen);
  const importUrl = useExtensions((s) => s.importUrl);
  const haveAdBlock = useExtensions((s) => s.items.some((e) => e.source?.kind === "webstore" && e.source.id === UBLOCK_LITE_ID));
  // A team's are added with Create in the team: each way says why it is closed.
  useRightsChange();
  const refused = teamRefusal("create");
  const closed = refused ? { disabled: true, hint: refused } : {};
  return (
    <HeaderMenu
      tour="add-extension"
      trigger={{ label: t("extensions.addExtension"), icon: <AddIcon className="size-3.5" /> }}
      items={[
        { label: t("extensions.addFromLink"), icon: <GlobeIcon className="size-3.5" />, onSelect: () => setLinkOpen(true), ...closed },
        { label: t("extensions.addFromFile"), icon: <DownloadIcon className="size-3.5" />, disabled: busy, onSelect: () => void importFiles(), ...closed },
        { label: t("extensions.addUnpacked"), icon: <FolderIcon className="size-3.5" />, disabled: busy, onSelect: () => void importFolder(), ...closed },
        { type: "separator" },
        // One click: the Web Store's uBlock Origin Lite, kept up to date like any linked extension.
        {
          label: t("extensions.addAdBlocker"),
          icon: <AdBlockIcon className="size-3.5" />,
          disabled: busy || haveAdBlock,
          hint: haveAdBlock ? t("extensions.adBlockerAdded") : t("extensions.adBlockerHint"),
          onSelect: () => void importUrl(UBLOCK_LITE_ID),
          ...closed,
        },
      ]}
    />
  );
}
