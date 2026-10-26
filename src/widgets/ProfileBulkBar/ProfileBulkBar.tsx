import { useRef, useState } from "react";
import { IconButton, useContextMenu, useLatched } from "@proxyshard/shardx-ui-kit";
import { CloseIcon, MoreIcon } from "../../shared/icons";
import { useT } from "../../shared/i18n";
import { useProfile, useProfileUi, useSaving } from "../../entities/profile";
import { TagPicker } from "../../features/manage-tags";
import { FolderPicker } from "../../features/manage-profiles";
import { CommandButton, barCommands, capOf, ariaOf, menuItemsFor } from "../../features/commands";
import { command } from "../../shared/commands";
import { useDialogLife } from "../../shared/lib/useDialogLife";
import { focusProfileRow } from "../../shared/lib/focusRow";
import { BulkBarFrame } from "../../shared/ui/BulkBarFrame";

/// Floats at the bottom of the Profiles list column while anything is selected: the
/// count and what can be done to all of it. Owner fix 1 (2026-09-28): every
/// action here keeps the selection exactly as it was, success or failure —
/// a person who picks 100 profiles to stop, then delete, should not have to
/// select them again in between. The only things that change it are the
/// explicit clear (this bar's own X, or Esc on the list) and Move to Trash,
/// which drops just the ids it actually deleted — one it could not delete
/// (a failure, already toasted) is put right back (fix round 1). Start and
/// Stop are held while either runs, so a second press can't start a
/// parallel one.
export function ProfileBulkBar() {
  const t = useT();
  const selected = useProfileUi((s) => s.selected);
  const clearSelected = useProfileUi((s) => s.clearSelected);
  const more = useContextMenu();
  const tagPicker = useProfileUi((s) => s.tagPicker);
  const tagsButton = useRef<HTMLButtonElement>(null);
  const folderPicker = useProfileUi((s) => s.folderPicker);
  const moveButton = useRef<HTMLButtonElement>(null);
  // Holds Start and Stop while either runs: a second press would start a
  // parallel loop over the same (or by-then-different) ids (fix round 1,
  // finding 2).
  const [busy, setBusy] = useState(false);
  const hold = (run: Promise<void>) => {
    setBusy(true);
    void run.finally(() => setBusy(false));
  };

  const count = selected.size;
  // The bar's picker stays mounted, on the profiles it opened for, through
  // its exit (FEEL-01), even when a press on the bar's X closes it and
  // clears the selection at once.
  const barPicker = tagPicker?.from === "bar" && count > 0 ? tagPicker : null;
  const barPickerLife = useDialogLife(barPicker != null);
  const barPickerShown = useLatched(barPicker);
  // Move to folder's picker, under its button, the same way (EMIL-09).
  const barFolder = folderPicker?.from === "bar" && count > 0 ? folderPicker : null;
  const barFolderLife = useDialogLife(barFolder != null);
  const barFolderShown = useLatched(barFolder);
  // The bar acts on the selection it counts. Every button, the More menu and
  // the close button come from the command registry: the same words, icons
  // and keys as the row menu, the palette and the sheet (E4, IFACE gap 1).
  // Through its exit it keeps the selection it showed, so no button dims or
  // renames while it fades.
  const subject = useLatched(count > 0 ? { ids: [...selected] } : null) ?? { ids: [] };
  // Start and Stop say why they cannot run (every selected profile runs;
  // none does): the bar draws again when one of its profiles starts or stops.
  useProfile((s) => {
    let n = 0;
    for (const id of subject.ids) if (s.running[id] !== undefined) n++;
    return n === 0 ? "none" : n === subject.ids.length ? "all" : "some";
  });
  // And when one's session starts or ends being saved: Start waits for it.
  useSaving((s) => subject.ids.filter((id) => s.ids.has(id)).length);
  const clear = command("profile.clearSelection");
  // The count it showed stays through the exit, not "0 selected".
  const label = useLatched(count > 0 ? t("bulkActionsBar.selectedCount", { n: count }) : null) ?? "";

  return (
    <>
      {/* The frame places it in the list column, runs its enter and exit,
          and folds the longer buttons to icons in a narrow column. */}
      <BulkBarFrame
        open={count > 0}
        label={label}
        onClosedWithFocus={() => focusProfileRow(useProfileUi.getState().activeId, { ifLost: true, orTabbable: true })}
      >
        {(narrow) => (
          <>
            <span className="mr-1.5 text-secondary font-medium text-text-strong-950 tabular-nums">{label}</span>
            {barCommands("profiles").map((c) => {
              const held = c.id === "profile.start" || c.id === "profile.stop";
              return (
                <CommandButton
                  key={c.id}
                  command={c}
                  subject={subject}
                  from="bulkBar"
                  narrow={narrow}
                  {...(held ? { disabled: busy, onRun: hold } : {})}
                  {...(c.id === "profile.tags"
                    ? { buttonRef: tagsButton, "aria-haspopup": "dialog" as const, "aria-expanded": barPicker != null }
                    : c.id === "profile.moveToFolder"
                      ? { buttonRef: moveButton, "aria-haspopup": "dialog" as const, "aria-expanded": barFolder != null }
                      : {})}
                />
              );
            })}
            {/* The less frequent ones, so the bar fits the smallest window. */}
            <IconButton
              label={t("profileBulkBar.more")}
              icon={<MoreIcon className="size-3.5" />}
              size="3xsmall"
              // The menu host sets aria-expanded while its menu is open.
              aria-haspopup="menu"
              aria-expanded="false"
              // Launch synced says why it cannot run, in the item (EMIL-05, PC-034).
              onClick={(e) => more.openFrom(e.currentTarget, menuItemsFor("bulkMore", "profiles", subject))}
            />
            <IconButton
              label={clear.label(count)}
              shortcut={capOf(clear)}
              aria-keyshortcuts={ariaOf(clear)}
              icon={<CloseIcon className="size-3.5" />}
              size="3xsmall"
              onClick={clearSelected}
            />
            {more.node}
          </>
        )}
      </BulkBarFrame>
      {barPickerLife.mounted && barPickerShown && (
        <TagPicker key={barPickerLife.session} open={barPicker != null} profileIds={barPickerShown.profileIds} anchorRef={tagsButton} onClose={() => useProfileUi.getState().setTagPicker(null)} />
      )}
      {barFolderLife.mounted && barFolderShown && (
        <FolderPicker key={barFolderLife.session} open={barFolder != null} profileIds={barFolderShown.profileIds} anchorRef={moveButton} onClose={() => useProfileUi.getState().setFolderPicker(null)} />
      )}
    </>
  );
}
