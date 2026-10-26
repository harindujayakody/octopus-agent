import { SegmentControl, Switch, type Theme } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { INTERFACE_SIZES, useInterfaceSize, type InterfaceSizeChoice } from "../../../shared/model/interfaceSize";
import { SelectField } from "../../../shared/ui/SelectField";
import { SettingRow, SettingsGroup, type SettingsProps } from "../SettingRow";

// Each shows at once, as a preview, and lives in this window's storage, not in
// settings.json: it is stored on Save, and Don't save puts the old one back.
export function AppearanceSection({ p, setP }: SettingsProps) {
  const t = useT();
  const auto = useInterfaceSize((s) => s.auto);
  return (
    <SettingsGroup>
      <SettingRow
        id="theme"
        title={t("settings.themeTitle")}
        control={({ labelId }) => (
          // One choice that switches no panel: a radio group (C26).
          <SegmentControl
            fit
            aria-labelledby={labelId}
            size="xsmall"
            value={p.theme}
            onChange={(v) => setP("theme", v as Theme)}
            items={[
              { value: "light", label: t("settings.themeLight") },
              { value: "dark", label: t("settings.themeDark") },
              { value: "system", label: t("settings.themeSystem") },
            ]}
          />
        )}
      />
      <SettingRow
        id="interface-size"
        title={t("settings.interfaceSizeTitle")}
        help={t("settings.interfaceSizeHelp")}
        control={({ labelId, helpId }) => (
          <div className="w-[200px]">
            <SelectField
              aria-labelledby={labelId}
              aria-describedby={helpId}
              value={p.size}
              onChange={(v) => setP("size", v)}
              options={[
                { value: "auto" as InterfaceSizeChoice, label: t("settings.interfaceSizeAuto", { n: auto }) },
                ...INTERFACE_SIZES.map((n) => ({ value: n as InterfaceSizeChoice, label: t("settings.interfaceSizePercent", { n }) })),
              ]}
            />
          </div>
        )}
      />
      <SettingRow
        id="motion"
        title={t("settings.reduceMotion")}
        help={t("settings.motionHelp")}
        control={({ labelId, helpId }) => <Switch aria-labelledby={labelId} aria-describedby={helpId} checked={p.reduceMotion} onChange={(on) => setP("reduceMotion", on)} />}
      />
    </SettingsGroup>
  );
}
