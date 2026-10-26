import { t } from "../../shared/i18n";
import { AddIcon, DownloadIcon } from "../../shared/icons";
import { useNav } from "../../shared/model/navigation";
import { defineCommands, type Command } from "../../shared/commands";
import { bookmarkTabFolder, emptyBookmark, useBookmarks } from "../../entities/bookmark";
import { useImportBookmarks } from "../import-bookmarks/model/store";
import { teamRefusal } from "../../entities/space";

/// The Bookmarks page's commands. C is each page's New (IFACE-11): a
/// bookmark here, in the Folder the page shows.
export const BOOKMARK_COMMANDS: readonly Command[] = [
  {
    area: "bookmarks", page: "bookmarks", id: "bookmark.new", scope: "page", group: "create", icon: AddIcon,
    // It opens the editor, which takes the keyboard (PC-108).
    focusAfter: true,
    label: () => t("commands.newBookmark"), keys: ["C"], keyWhere: "page", singleKey: true,
    surfaces: ["palette", "sheet"],
    // A team's bookmarks are made with Create in the team.
    disabled: () => teamRefusal("create"),
    run: async () => {
      if (!(await useNav.getState().setSection("bookmarks"))) return;
      const { folder, setEditing } = useBookmarks.getState();
      // The tab's Folder; All and Every profile give every profile.
      setEditing(emptyBookmark(bookmarkTabFolder(folder) ?? ""));
    },
  },
  {
    area: "bookmarks", page: "bookmarks", id: "bookmark.import", scope: "page", group: "create", icon: DownloadIcon,
    // A file picker, then its dialog, which takes the keyboard.
    focusAfter: true,
    label: () => t("commands.importChromeBookmarks"),
    keywords: () => [t("bookmarks.heading")],
    surfaces: ["palette"],
    disabled: () => teamRefusal("create"),
    run: async () => {
      // The picker first, while the click that asked for it still counts.
      if (!(await useImportBookmarks.getState().pick())) return;
      if (!(await useNav.getState().setSection("bookmarks"))) useImportBookmarks.getState().close();
    },
  },
];

defineCommands(BOOKMARK_COMMANDS);
