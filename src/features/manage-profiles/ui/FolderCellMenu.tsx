import { Menu, type MenuItem } from "@proxyshard/shardx-ui-kit";
import { selectVisible, useFolderMeta, useFolders, useProfile, useProfileUi, type ProfileMeta } from "../../../entities/profile";
import { FolderChip } from "../../../shared/ui/FolderChip";
import { FolderAddIconApp } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";
import { toast } from "../../../shared/model/toast";
import { hasOwn } from "../../../shared/lib/utils";
import { adminRefusal, inFolder, teamRefusal, useRightsChange } from "../../../entities/space";

/// A profile's Folder, picked from a menu under its cell (the cell's edit
/// button, owner feature 2026-09-26): "No folder", every Folder as its chip
/// (5t), then "New folder…", which opens the Folder dialog (one place makes a
/// Folder, with its color and icon) and moves the profile into the Folder it
/// makes. One click to open, one to pick, the keyboard throughout.
export function FolderCellMenu({ profile, anchorRef, onClose }: {
  profile: ProfileMeta;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const t = useT();
  const folders = useFolders();
  // C1: `FolderChip` is pure, so each Folder's color is looked up here and
  // passed in.
  const folderMetaByName = useFolderMeta((s) => s.byName);
  const setProfileFolder = useProfile((s) => s.setProfileFolder);
  const setFolderDialog = useProfileUi((s) => s.setFolderDialog);
  const pick = (folder: string) => {
    if (folder === profile.folder) return;
    void setProfileFolder(profile.id, folder).then(() => {
      // A move that takes the row out of the list says so with its own Undo
      // toast; one that leaves it in view is said here (never both).
      const now = useProfile.getState().profiles.find((p) => p.id === profile.id);
      if (now?.folder !== folder || !selectVisible().indexById.has(profile.id)) return;
      toast.saved(folder ? t("useProfile.movedOne", { name: profile.name, f: folder }) : t("useProfile.movedOutOne", { name: profile.name, f: profile.folder }));
    });
  };
  // In a team a profile goes only where Create is given; only its admin makes a folder.
  useRightsChange();
  const closed = (f: string) => (f === profile.folder ? null : teamRefusal("create", inFolder(f)));
  const newFolder = adminRefusal();
  const items: MenuItem[] = [
    { type: "radio", label: t("peek.noFolder"), checked: profile.folder === "", disabled: !!closed(""), hint: closed("") ?? undefined, onSelect: () => pick("") },
    ...folders.map((f): MenuItem => ({
      type: "radio",
      label: f,
      content: <FolderChip name={f} color={hasOwn(folderMetaByName, f) ? folderMetaByName[f].color : null} />,
      checked: profile.folder === f,
      disabled: !!closed(f),
      hint: closed(f) ?? undefined,
      onSelect: () => pick(f),
    })),
    { type: "separator" },
    {
      label: t("folderCellMenu.newFolder"), icon: <FolderAddIconApp className="size-3.5" />,
      disabled: !!newFolder, hint: newFolder ?? undefined,
      onSelect: () => setFolderDialog({ mode: "create", moveIds: [profile.id] }),
    },
  ];
  return (
    <Menu
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      anchor={anchorRef}
      items={items}
      aria-label={t("folderCellMenu.label", { name: profile.name })}
    />
  );
}
