// Loading the definitions registers them.
import "./profileCommands";
import "./proxyCommands";
import "./appCommands";
import "./trashCommands";
import "./folderCommands";
import "./bookmarkCommands";

export * from "./subject";
export * from "./surfaces";
export * from "./sheet";
export { CommandButton } from "./CommandButton";
export { commandForKey, dispatchListKey } from "./dispatch";
export { useAppKeys } from "./useAppKeys";
export { PROFILE_COMMANDS } from "./profileCommands";
export { PROXY_COMMANDS } from "./proxyCommands";
export { TRASH_COMMANDS } from "./trashCommands";
export { FOLDER_COMMANDS } from "./folderCommands";
export { BOOKMARK_COMMANDS } from "./bookmarkCommands";
export { APP_COMMANDS, PALETTE_KEYS, SETTINGS_TABS, SETTINGS_TAB_IDS } from "./appCommands";
export { allCommands, command } from "../../shared/commands";
