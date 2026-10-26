import { AddIcon, DownloadIcon, FolderIcon, GlobeIcon } from "../../../shared/icons";
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
      ]}
    />
  );
}
