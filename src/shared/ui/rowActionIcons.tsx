import type { ReactElement } from "react";
import {
  CopyIcon, DeleteIcon, EditIcon, EditFieldIcon, EyeIcon, FolderIcon, FolderMinusIconApp, PinIconApp, PlayIcon, RenameIcon,
  StopIcon, TagIcon, UnpinIconApp, RefreshIcon,
} from "../icons";

type IconProps = { className?: string };

/// Owner feedback 5m: every row menu item carries the same icon as its
/// hover button, where one exists — one map from action to icon, shared by
/// both, so they can never drift apart. Each rendered icon also carries a
/// stable `data-icon` name, read by tests to prove a menu item and its
/// hover button really are the same glyph. Actions with no hover button
/// (Rename, Move to folder, Remove from folder, Tags, Copy ID, Show in list)
/// use the nearest existing app icon. The cookie pair lives in the command
/// registry only (E3): Export is Upload and Import is Download there, as
/// every export and import is.
///
/// Fix round 1, finding 10: the row's own hover button keeps one stable
/// label and glyph, "Pin", whether or not the profile is pinned — only its
/// color and `aria-pressed` say "on" (the APG toggle-button pattern). Only
/// the *menu* item's label and icon still flip to "Unpin" (Hugeicons'
/// `PinOffIcon`, distinct from `pin`'s `PinIcon`) once pinned, so `unpin`
/// stays a menu-only entry in this map — nothing calls it for the button.
export const rowActionIcons = {
  pin: (p: IconProps) => <PinIconApp data-icon="pin" {...p} />,
  unpin: (p: IconProps) => <UnpinIconApp data-icon="unpin" {...p} />,
  edit: (p: IconProps) => <EditIcon data-icon="edit" {...p} />,
  editField: (p: IconProps) => <EditFieldIcon data-icon="edit-field" {...p} />,
  rename: (p: IconProps) => <RenameIcon data-icon="rename" {...p} />,
  clone: (p: IconProps) => <CopyIcon data-icon="clone" {...p} />,
  trash: (p: IconProps) => <DeleteIcon data-icon="trash" {...p} />,
  start: (p: IconProps) => <PlayIcon data-icon="start" {...p} />,
  stop: (p: IconProps) => <StopIcon data-icon="stop" {...p} />,
  test: (p: IconProps) => <RefreshIcon data-icon="test" {...p} />,
  copyId: (p: IconProps) => <CopyIcon data-icon="copy-id" {...p} />,
  copyAddress: (p: IconProps) => <CopyIcon data-icon="copy-address" {...p} />,
  moveToFolder: (p: IconProps) => <FolderIcon data-icon="move-to-folder" {...p} />,
  removeFromFolder: (p: IconProps) => <FolderMinusIconApp data-icon="remove-from-folder" {...p} />,
  tags: (p: IconProps) => <TagIcon data-icon="tags" {...p} />,
  showInList: (p: IconProps) => <EyeIcon data-icon="show-in-list" {...p} />,
} as const satisfies Record<string, (p: IconProps) => ReactElement>;

export type RowActionIcon = keyof typeof rowActionIcons;
