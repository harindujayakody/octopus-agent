import { Chip, Switch } from "@proxyshard/shardx-ui-kit";
import { HELPER_KINDS } from "../../../entities/settings";
import { useT } from "../../../shared/i18n";
import { SettingRow, SettingsGroup, type SettingsProps } from "../SettingRow";

export function HelperSection({ s, setS }: SettingsProps) {
  const t = useT();
  const on = s.helper_enabled ?? true;
  return (
    <SettingsGroup>
      <SettingRow
        id="helper"
        title={t("settings.helperEnableLabel")}
        help={t("settings.helperHelp")}
        control={({ labelId, helpId }) => (
          <Switch aria-labelledby={labelId} aria-describedby={helpId} checked={on} onChange={(v) => setS({ ...s, helper_enabled: v })} />
        )}
      />
      {on && (
        <SettingRow
          id="helper-triggers"
          title={t("settings.helperReactTo")}
          help={t("settings.helperTriggersHelp")}
          below={
            <div role="group" aria-label={t("settings.helperReactTo")} className="flex flex-wrap gap-1.5">
              {HELPER_KINDS.map((k) => {
                const picked = (s.helper_triggers ?? []).includes(k.value);
                return (
                  <Chip
                    key={k.value}
                    selected={picked}
                    onClick={() => {
                      const cur = s.helper_triggers ?? [];
                      setS({ ...s, helper_triggers: picked ? cur.filter((x) => x !== k.value) : [...cur, k.value] });
                    }}
                  >
                    {t(k.label)}
                  </Chip>
                );
              })}
            </div>
          }
        />
      )}
    </SettingsGroup>
  );
}
