import { Switch } from "@proxyshard/shardx-ui-kit";
import { useT, LANG_OPTIONS, type Lang } from "../../../shared/i18n";
import { SelectField } from "../../../shared/ui/SelectField";
import { SettingRow, SettingsGroup, type SettingsProps } from "../SettingRow";

export function GeneralSection({ s, setS, p, setP }: SettingsProps) {
  const t = useT();
  return (
    <SettingsGroup>
      <SettingRow
        id="language"
        title={t("settings.interfaceLanguageLabel")}
        help={t("settings.languageHelp")}
        control={({ labelId, helpId }) => (
          // Short: the longest choice is one word (CRAFT-31).
          <div className="w-[160px]">
            <SelectField<Lang>
              aria-labelledby={labelId}
              aria-describedby={helpId}
              value={p.lang}
              onChange={(v) => setP("lang", v)}
              options={LANG_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>
        )}
      />
      {/* The page-wide single keys (C, /, ?, G), on by default; kept in this
          window's storage, changed on Save (O14, WCAG 2.1.4). */}
      <SettingRow
        id="single-keys"
        title={t("settings.singleKeysLabel")}
        help={t("settings.singleKeysHelp")}
        control={({ labelId, helpId }) => (
          <Switch aria-labelledby={labelId} aria-describedby={helpId} checked={p.singleKeys} onChange={(on) => setP("singleKeys", on)} />
        )}
      />
      <SettingRow
        id="tray"
        title={t("settings.trayLabel")}
        help={t("settings.trayHelp")}
        control={({ labelId, helpId }) => (
          <Switch aria-labelledby={labelId} aria-describedby={helpId} checked={s.minimize_to_tray ?? true} onChange={(on) => setS({ ...s, minimize_to_tray: on })} />
        )}
      />
      {/* Its help says plainly where the request goes from (owner, §3.8). */}
      <SettingRow
        id="ext-update-check"
        title={t("settings.extUpdateCheckLabel")}
        help={t("settings.extUpdateCheckHelp")}
        control={({ labelId, helpId }) => (
          <Switch aria-labelledby={labelId} aria-describedby={helpId} checked={s.ext_update_check ?? true} onChange={(on) => setS({ ...s, ext_update_check: on })} />
        )}
      />
    </SettingsGroup>
  );
}
