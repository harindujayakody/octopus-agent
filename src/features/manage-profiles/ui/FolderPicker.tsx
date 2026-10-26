import { useMemo } from "react";
import { Combobox, Popover, type ComboboxOption } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { hasOwn } from "../../../shared/lib/utils";
import { FolderChip } from "../../../shared/ui/FolderChip";
import { useFolderMeta, useFolders, useProfile, useProfileUi } from "../../../entities/profile";
import { adminRefusal, inFolder, teamRefusal, useAccess, useRightsChange } from "../../../entities/space";

/// Moves profiles into a Folder (EMIL-09, CRAFT-09): type to filter the
/// Folders, each as its chip (one look for a Folder everywhere, owner
/// feedback 5t) with its count; Enter moves into the highlighted one. The
/// Folder they all share is checked. "Create folder “x”" is the last row and
/// opens the Folder dialog with that name, so a Folder is made in one place,
/// with its color and icon (ruling 14). The selection stays as it is (owner
/// rule). Anchored like the tag picker: under `anchorRef`, or at
/// `anchorPoint` with `triggerRef` the control that toggles it.
export function FolderPicker({ open, profileIds, anchorRef, anchorPoint, triggerRef, onClose }: {
  open: boolean;
  profileIds: string[];
  anchorRef?: React.RefObject<HTMLElement | null>;
  anchorPoint?: { x: number; y: number };
  triggerRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const t = useT();
  const folders = useFolders();
  const profiles = useProfile((s) => s.profiles);
  const looks = useFolderMeta((s) => s.byName);
  const moving = profiles.filter((p) => profileIds.includes(p.id));
  // The Folder they all share, if any, shows as the current one.
  const shared = moving.length > 0 && moving.every((p) => p.folder === moving[0].folder) ? moving[0].folder : null;
  // In a team a profile goes only where Create is given; only its admin makes a folder.
  useRightsChange();
  const access = useAccess((s) => s.read);

  const options = useMemo<ComboboxOption[]>(() => folders.map((f) => {
    const closed = f !== shared && !!teamRefusal("create", inFolder(f));
    return {
      value: f,
      label: f,
      hint: closed ? t("rights.noCreateHere") : String(profiles.filter((p) => p.folder === f).length),
      disabled: closed,
      // An own key only: a Folder may be named like an inherited property (SEC-14).
      content: <FolderChip name={f} color={hasOwn(looks, f) ? looks[f].color : null} />,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- teamRefusal reads the access
  }), [folders, looks, profiles, shared, access, t]);

  const move = (folder: string) => {
    onClose();
    void useProfile.getState().moveMany(profileIds, folder);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      anchorRef={anchorRef}
      anchorPoint={anchorPoint}
      triggerRef={triggerRef}
      align="start"
      aria-label={t("commands.moveToFolderTitle")}
      className="w-[260px] p-0"
    >
      <Combobox
        aria-label={t("folderPicker.find")}
        placeholder={t("folderPicker.find")}
        options={options}
        value={shared || null}
        onChange={(folder) => { if (folder !== shared) move(folder); else onClose(); }}
        onCreate={adminRefusal() ? undefined : (name) => {
          onClose();
          useProfileUi.getState().setFolderDialog({ mode: "create", name, moveIds: profileIds });
        }}
        createLabel={(name) => t("folderPicker.create", { name })}
        emptyText={t("folderPicker.empty")}
      />
    </Popover>
  );
}
