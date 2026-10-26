import { Button, IconButton, useContextMenu, useLatched } from "@proxyshard/shardx-ui-kit";
import { CloseIcon, MoreIcon, RestoreIcon } from "../../shared/icons";
import { BulkBarFrame } from "../../shared/ui/BulkBarFrame";
import type { TrashEntry } from "../../entities/trash";
import { command, menuItemsFor, runCommand } from "../../features/commands";
import { useT } from "../../shared/i18n";

/// The Trash's selection bar (F5): Restore the lot, or delete it for good
/// from its … menu (it asks, naming how many: CRAFT-03). It counts and acts
/// on the selected entries the list shows. No action here clears or narrows
/// the selection (owner): an entry restored or deleted leaves the Trash, and
/// the page drops it from the selection as it goes; one that failed stays
/// picked. Only the X, Esc on the list, or the entries leaving clear it.
export function TrashBulkBar({ selected, onClear, onClosedWithFocus }: {
  selected: TrashEntry[];
  onClear: () => void;
  /** Focus was in the bar as it closed: where it goes back to. */
  onClosedWithFocus?: () => void;
}) {
  const t = useT();
  const more = useContextMenu();
  const n = selected.length;
  // Through its exit it keeps the count and the entries it showed.
  const label = useLatched(n > 0 ? t("bulkActionsBar.selectedCount", { n }) : null) ?? "";
  const shown = useLatched(n > 0 ? selected : null) ?? [];
  // The registry's commands (F25b): the palette runs the same on the same picks.
  const run = (id: string) => void runCommand(command(id), { ids: shown.map((e) => e.id) }, { from: "bulkBar" });
  return (
    <BulkBarFrame open={n > 0} label={label} onClosedWithFocus={onClosedWithFocus}>
      {() => (
        <>
          <span className="mr-1.5 text-secondary font-medium text-text-strong-950 tabular-nums">{label}</span>
          <Button
            variant="neutral"
            mode="ghost"
            size="3xsmall"
            leftIcon={<RestoreIcon className="size-3.5" />}
            onClick={() => run("trash.restore")}
          >
            {t("trash.restoreCount", { n: shown.length })}
          </Button>
          <IconButton
            label={t("profileBulkBar.more")}
            icon={<MoreIcon className="size-3.5" />}
            size="3xsmall"
            // The menu host sets aria-expanded while its menu is open.
            aria-haspopup="menu"
            aria-expanded="false"
            // Delete for good… from the registry, with its name and key (E8).
            onClick={(e) => more.openFrom(e.currentTarget, menuItemsFor("bulkMore", "trash", { ids: shown.map((x) => x.id) }))}
          />
          <IconButton label={t("commands.clearSelection")} icon={<CloseIcon className="size-3.5" />} size="3xsmall" onClick={onClear} />
          {more.node}
        </>
      )}
    </BulkBarFrame>
  );
}
