import { SelectField } from "../../../shared/ui/SelectField";
import { useT } from "../../../shared/i18n";

/// Where a bookmark shows: every profile (""), or the profiles of one Folder.
/// The editor and the Chrome import pick it the same way.
export function BookmarkFolderSelect({ label, value, folders, onChange, disabled }: {
  label: string;
  value: string;
  folders: string[];
  onChange: (folder: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      isSearchable={folders.length > 8}
      options={[
        { value: "", label: t("bookmarks.folderAnyOption") },
        ...folders.map((f) => ({ value: f, label: f })),
      ]}
    />
  );
}
