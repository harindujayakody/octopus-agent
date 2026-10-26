import { AddIcon, DownloadIcon, FolderIcon } from "../../shared/icons";
import { useFingerprint } from "../../entities/fingerprint";
import { useT } from "../../shared/i18n";
import { HeaderMenu } from "../PageHeader/HeaderMenu";

/// Fingerprints has nothing to create: its imports sit in the `…` menu, and
/// Peek's "New profile from this" is the page's main path (plan ruling 5, CRAFT-29).
export function FingerprintToolbar() {
  const t = useT();
  const importJsonFile = useFingerprint((s) => s.importJsonFile);
  const setImporterOpen = useFingerprint((s) => s.setImporterOpen);
  const openLibraryFolder = useFingerprint((s) => s.openLibraryFolder);
  return (
    <HeaderMenu
      items={[
        { label: t("fingerprintsMenu.importFile"), icon: <DownloadIcon className="size-3.5" />, onSelect: () => void importJsonFile() },
        { label: t("fingerprintsMenu.pasteJson"), icon: <AddIcon className="size-3.5" />, onSelect: () => setImporterOpen(true) },
        { label: t("fingerprintsMenu.showFolder"), icon: <FolderIcon className="size-3.5" />, onSelect: () => void openLibraryFolder() },
      ]}
    />
  );
}
