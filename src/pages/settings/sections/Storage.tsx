import { useEffect, useState } from "react";
import { DataRootCard } from "../../../features/manage-profiles/ui/DataRootCard";
import { DeleteAllData, KeptIn, ShowBackupButton } from "../../../features/delete-all-data";
import { appResetBackup } from "../../../entities/settings";
import { useT } from "../../../shared/i18n";
import { SettingRow, SettingsGroup } from "../SettingRow";
import { StorageUsageCard } from "./StorageUsageCard";

export function StorageSection() {
  const t = useT();
  // The old data a Delete all data kept, while its folder is there.
  const [backup, setBackup] = useState<string | null>(null);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let live = true;
    appResetBackup().then((b) => { if (live) setBackup(b ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [asked]);
  return (
    <div className="flex flex-col gap-[32px]">
      <SettingsGroup title={t("settings.storageTitle")}>
        <div className="py-3">
          <StorageUsageCard />
        </div>
      </SettingsGroup>
      <SettingsGroup title={t("settings.dataLocationTitle")}>
        <div className="py-3">
          <DataRootCard />
        </div>
      </SettingsGroup>
      {/* A fresh start (owner, 2026-10-08): everything the user made moves
          to a backup folder, the browser engine stays. Two warnings stand
          before it. */}
      <SettingsGroup>
        <SettingRow
          id="delete-all-data"
          title={t("deleteAllData.title")}
          help={t("deleteAllData.help")}
          control={({ helpId }) => <DeleteAllData describedBy={helpId} onChanged={() => setAsked((n) => n + 1)} />}
        />
        {backup && (
          <SettingRow
            id="reset-backup"
            title={t("deleteAllData.backupTitle")}
            help={<span className="break-words"><KeptIn backups={[backup]} /></span>}
            control={({ helpId }) => <ShowBackupButton path={backup} describedBy={helpId} />}
          />
        )}
      </SettingsGroup>
    </div>
  );
}
