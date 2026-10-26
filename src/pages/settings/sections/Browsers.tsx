import { useEffect, useState } from "react";
import { Button } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import {
  checkEngineUpdates, downloadEngine, hasUpdate, removeEngine, useEngines, type StockEngine,
} from "../../../features/manage-profiles/lib/engineDownloads";
import { SettingRow, SettingsGroup } from "../SettingRow";

const BROWSERS: StockEngine[] = ["chrome", "chromium", "firefox"];

/// Browsers: Google Chrome, Chromium and Firefox, each installed on its own
/// into the launcher's folder, apart from any copy the computer has, so a
/// profile always starts the version shown here. Each row installs, updates
/// or removes its browser; opening the page checks the vendors for newer
/// versions, and the launcher checks on its own every few hours and says so
/// in a notification. Nothing here is saved by Save: each button acts at once.
export function BrowsersSection() {
  const t = useT();
  const [checking, setChecking] = useState(false);
  const check = () => {
    setChecking(true);
    void checkEngineUpdates({ notify: false }).finally(() => setChecking(false));
  };
  useEffect(check, []);
  return (
    <SettingsGroup help={t("browsers.help")}>
      {BROWSERS.map((id) => <BrowserRow key={id} id={id} />)}
      <div className="flex justify-end py-3">
        <Button variant="neutral" mode="stroke" size="xsmall" disabled={checking} onClick={check}>
          {checking ? t("browsers.checking") : t("browsers.checkNow")}
        </Button>
      </div>
    </SettingsGroup>
  );
}

function BrowserRow({ id }: { id: StockEngine }) {
  const t = useT();
  const e = useEngines((s) => s.found?.find((x) => x.id === id));
  const d = useEngines((s) => s.downloads[id]);
  const latest = useEngines((s) => s.latest[id]);
  const update = useEngines((s) => hasUpdate(s, id));
  const removing = useEngines((s) => !!s.removing[id]);
  const name = id === "chrome" ? t("profileForm.engineChrome") : id === "chromium" ? t("profileForm.engineChromium") : t("profileForm.engineFirefox");
  const busy = !!d && !("error" in d);

  const status = busy
    ? d.phase === "extract" ? t("profileForm.engineUnpacking", { engine: name }) : t("profileForm.engineDownloading", { engine: name, percent: d.percent })
    : d && "error" in d ? t("profileForm.engineDownloadFailed", { engine: name, reason: d.error })
    : e?.managed
      ? update ? t("browsers.updateAvailable", { have: e.version ?? "", v: latest ?? "" })
        : e.version ? t("browsers.installedVersion", { v: e.version }) : t("browsers.installed")
    : e?.path ? t("browsers.systemCopy")
    : t("browsers.notInstalled");

  return (
    <SettingRow
      id={`browser-${id}`}
      title={name}
      help={<span role={busy ? "status" : undefined} data-browser-status={id}>{status}</span>}
      control={() => (
        <div className="flex items-center gap-2">
          {e?.managed ? (
            <>
              {update && (
                <Button variant="primary" mode="filled" size="xsmall" disabled={busy} onClick={() => void downloadEngine(id)}>
                  {t("browsers.update")}
                </Button>
              )}
              <Button variant="neutral" mode="stroke" size="xsmall" disabled={busy || removing} onClick={() => void removeEngine(id)}>
                {t("browsers.remove")}
              </Button>
            </>
          ) : (
            <Button variant="primary" mode={e?.path ? "stroke" : "filled"} size="xsmall" disabled={busy} onClick={() => void downloadEngine(id)}>
              {t("browsers.install")}
            </Button>
          )}
        </div>
      )}
    />
  );
}
