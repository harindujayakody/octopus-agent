import { Button, Tooltip } from "@proxyshard/shardx-ui-kit";
import { AddIcon } from "../../../shared/icons";
import { keyWorksOn } from "../../../shared/commands";
import { useNav } from "../../../shared/model/navigation";
import { capOf, command, labelOf, reasonOf } from "../../commands";
import { useRightsChange } from "../../../entities/space";
import { useProfile } from "../../../entities/profile";
import { openProfileForm } from "../../profile-form/model/useProfileForm";

/// Opens the profile form on a new profile (a library fingerprint for this
/// machine's OS, the current Folder, no proxy): nothing exists until Create
/// profile. Its words and its key (C) are the registry's New profile, as the
/// palette and the sheet print them (UI-29); the key shows only on a page
/// where C works (Profiles).
export function NewProfileButton() {
  const section = useNav((s) => s.section);
  const label = labelOf("profile.new");
  const cmd = command("profile.new");
  // A team without Create anywhere for this person: the button says why and does nothing.
  useRightsChange();
  useProfile((s) => s.folderRegistry);
  const why = reasonOf(cmd, { ids: [] });
  return (
    <Tooltip content={why ?? label} shortcut={!why && keyWorksOn(cmd, section) ? capOf(cmd) : undefined}>
      <Button
        variant="primary" mode="filled" size="xsmall" data-mode="filled"
        data-tour="new-profile"
        leftIcon={<AddIcon className="size-3.5" />}
        disabled={!!why}
        aria-description={why ?? undefined}
        onClick={() => { if (!why) openProfileForm({ mode: "create" }); }}
      >
        {label}
      </Button>
    </Tooltip>
  );
}
