import { Button, Tooltip } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { DownloadIcon } from "../../../shared/icons";
import { useProfile } from "../../../entities/profile";
import { useRightsChange } from "../../../entities/space";
import { command, reasonOf } from "../../commands";

export function ImportProfilesButton() {
  const t = useT();
  const importFromClipboard = useProfile((s) => s.importFromClipboard);
  // The registry's Import: a team without Create anywhere says why, as the … menu does.
  useRightsChange();
  useProfile((s) => s.folderRegistry);
  const why = reasonOf(command("profile.import"), { ids: [] });
  return (
    <Tooltip content={why ?? t("importProfilesButton.tooltip")}>
      <Button
        variant="neutral"
        mode="stroke"
        size="xsmall"
        leftIcon={<DownloadIcon className="size-3.5" />}
        disabled={!!why}
        aria-description={why ?? undefined}
        onClick={() => { if (!why) void importFromClipboard(); }}
      >
        {t("importProfilesButton.label")}
      </Button>
    </Tooltip>
  );
}
