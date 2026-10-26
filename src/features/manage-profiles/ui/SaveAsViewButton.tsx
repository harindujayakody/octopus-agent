import { Button, IconButton } from "@proxyshard/shardx-ui-kit";
import { useDiffersFromAll, useProfile, useProfileUi } from "../../../entities/profile";
import { SaveViewIcon } from "../../../shared/icons";
import { useT } from "../../../shared/i18n";

/// Whether "Save as view…" shows: outside a View, once the list is not All (a
/// Folder, a filter, an order or columns) and there are profiles.
function useCanSaveAsView(): boolean {
  const inView = useProfileUi((s) => s.viewId !== null);
  const differs = useDiffersFromAll();
  const hasProfiles = useProfile((s) => s.profiles.length > 0);
  return !inView && differs && hasProfiles;
}

/// The one "Save as view…" button, always the first item of the header's
/// actions group (owner, 2026-10-01): the same stroke button as Filters and
/// Display, with the bookmark icon. It says that the list differs from its
/// View, so Display does not. Below 960 px of header it folds to the icon
/// alone, with a tooltip, before anything else does (it is the least used).
/// The group is a flex row centered in the header, so its appearing moves
/// nothing vertically.
export function SaveAsViewButton() {
  const t = useT();
  const show = useCanSaveAsView();
  const setViewDialog = useProfileUi((s) => s.setViewDialog);
  if (!show) return null;
  const open = () => setViewDialog({ mode: "save" });
  const label = t("profileFilterBar.saveView");
  const icon = <SaveViewIcon className="size-3.5" />;
  return (
    <span data-save-view-group className="flex shrink-0 items-center">
      <span className="@max-[960px]:hidden">
        <Button variant="neutral" mode="stroke" size="xsmall" leftIcon={icon} data-save-view onClick={open}>{label}</Button>
      </span>
      <span className="@min-[960px]:hidden">
        <IconButton label={label} icon={icon} mode="stroke" size="xsmall" tooltipSide="bottom" data-save-view onClick={open} />
      </span>
    </span>
  );
}
