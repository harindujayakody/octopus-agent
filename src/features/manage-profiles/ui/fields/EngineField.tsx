import { useEffect } from "react";
import { Button } from "@proxyshard/shardx-ui-kit";
import { SelectField } from "../../../../shared/ui/SelectField";
import { EngineIcon } from "../../../../shared/brands";
import { useT } from "../../../../shared/i18n";
import { engineLabel, STOCK_ENGINES, type EngineId } from "../../../../entities/profile";
import { detectEngines, downloadEngine, isMissing, useEngines } from "../../lib/engineDownloads";
import { useProfileForm } from "../../../profile-form/model/useProfileForm";
import type { FieldProps } from "./types";

const ENGINES: EngineId[] = ["shardx", ...STOCK_ENGINES];

/// The browser the profile starts in. Only the Octopus Agent engine reads the
/// fingerprint; the others get the profile's data and proxy, and the line
/// under says so. One this computer lacks is downloaded as soon as it is
/// picked. It is chosen once, when the profile is made: the profile's data
/// folder belongs to that browser, so an existing profile shows it fixed
/// (the backend keeps it on every save too).
export function EngineField({ f, u }: FieldProps) {
  const t = useT();
  // The Octopus Agent engine says it applies the fingerprint; the others are named.
  const nameOf = (id: EngineId) => (id === "shardx" ? t("profileForm.engineShardx") : engineLabel(id, t));
  const found = useEngines((s) => s.found);
  const downloads = useEngines((s) => s.downloads);
  useEffect(() => { void detectEngines(); }, []);
  const fixed = useProfileForm((s) => s.mode === "edit");
  const options = ENGINES.map((id) => {
    const d = id === "shardx" ? undefined : downloads[id];
    const running = d && !("error" in d);
    return {
      value: id,
      label: nameOf(id),
      icon: <EngineIcon engine={id} />,
      // Still pickable: picking it starts the download.
      ...(running
        ? { badge: { label: t("profileForm.engineDownloadingBadge"), color: "information" as const } }
        : isMissing(found, id) ? { badge: { label: t("profileForm.engineNotFound"), color: "warning" as const } } : {}),
    };
  });
  const pick = (v: EngineId) => {
    u("engine", v);
    if (v !== "shardx" && isMissing(found, v)) void downloadEngine(v);
  };
  const engine = f.engine;
  const d = engine === "shardx" ? undefined : downloads[engine];
  const name = nameOf(engine);
  return (
    <div className="flex flex-col gap-1">
      <SelectField label={t("profileForm.groupEngine")} value={engine} options={options} onChange={pick} disabled={fixed} />
      {fixed && <p data-engine-fixed className="m-0 text-secondary text-text-sub-600">{t("profileForm.engineFixed")}</p>}
      {engine !== "shardx" && d && !("error" in d) && (
        <p role="status" className="m-0 text-secondary text-text-sub-600">
          {d.phase === "extract"
            ? t("profileForm.engineUnpacking", { engine: name })
            : t("profileForm.engineDownloading", { engine: name, percent: d.percent })}
        </p>
      )}
      {engine !== "shardx" && (!d || "error" in d) && isMissing(found, engine) && (
        <div className="flex items-center gap-2">
          <p className="m-0 flex-1 text-secondary text-text-sub-600">
            {d ? t("profileForm.engineDownloadFailed", { engine: name, reason: d.error }) : t("profileForm.engineDownloadHelp")}
          </p>
          <Button variant="neutral" mode="stroke" size="xsmall" onClick={() => void downloadEngine(engine)}>
            {d ? t("overview.tryAgain") : t("profileForm.engineDownload", { engine: name })}
          </Button>
        </div>
      )}
      <p className="m-0 text-secondary text-text-soft-400">
        {engine === "shardx" ? t("profileForm.engineHelp") : t("profileForm.engineStockWarning", { engine: name })}
      </p>
    </div>
  );
}
