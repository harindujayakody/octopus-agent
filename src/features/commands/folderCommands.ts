import { t } from "../../shared/i18n";
import { DeleteIcon, EditIcon, FolderIcon } from "../../shared/icons";
import { useNav } from "../../shared/model/navigation";
import { defineCommands, type Command } from "../../shared/commands";
import { leaveList, useProfile, useProfileUi } from "../../entities/profile";
import { adminRefusal } from "../../entities/space";

// A Folder is named by its name: the subject's one id is the Folder (A11Y-13).
const FOLDER = { area: "folders", scope: "active" } as const;

/// A Folder's commands: its sidebar menu and its actions in the palette
/// (Tab on a Folder), so editing and deleting one never needs a right-click.
export const FOLDER_COMMANDS: readonly Command[] = [
  {
    ...FOLDER, id: "folder.open", group: "open", icon: FolderIcon,
    label: () => t("commands.openFolder"),
    surfaces: ["paletteActions"],
    run: (s) => { void leaveList(() => { useProfileUi.getState().setFolder(s.ids[0]); void useNav.getState().setSection("profiles", { focus: true }); }); },
  },
  {
    ...FOLDER, id: "folder.edit", group: "organize", icon: EditIcon,
    focusAfter: true,
    label: () => t("commands.editFolder"),
    surfaces: ["rowMenu", "paletteActions"],
    // In a team its folders are its admin's to change.
    disabled: () => adminRefusal(),
    run: (s) => useProfileUi.getState().setFolderDialog({ mode: "edit", name: s.ids[0] }),
  },
  {
    ...FOLDER, id: "folder.delete", group: "danger", icon: DeleteIcon, danger: true,
    focusAfter: true,
    label: () => t("commands.deleteFolder"),
    surfaces: ["rowMenu", "paletteActions"],
    disabled: () => adminRefusal(),
    // It asks, naming the Folder and how many profiles it holds; profiles
    // it sends to the Trash come back with one Undo (A Task 12).
    run: (s) => useProfile.getState().deleteFolder(s.ids[0]),
  },
];

defineCommands(FOLDER_COMMANDS);
