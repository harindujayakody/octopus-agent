import { useId } from "react";
import { SelectField } from "../../../../shared/ui/SelectField";
import { AUTO_LANG, AUTO_TZ, LOCALES, TIMEZONES } from "../../../../shared/constants";
import { useT } from "../../../../shared/i18n";
import type { UiLanguage } from "../../../../entities/profile";
import type { FieldProps } from "./types";

export function LocaleFields({ f, u }: FieldProps) {
  const t = useT();
  const helpId = useId();
  return (
    <div className="grid grid-cols-2 gap-[12px]">
      <div className="flex flex-col gap-1">
        <SelectField
          value={f.timezone}
          label={t("inlineEditor.timezoneLabel")}
          onChange={(v) => u("timezone", v)}
          options={TIMEZONES.map((tz) => ({
            value: tz,
            label: tz === AUTO_TZ ? t("inlineEditor.timezoneAuto") : tz,
          }))}
        />
      </div>
      <div className="flex flex-col gap-1">
        <SelectField
          label={t("inlineEditor.languageLabel")}
          value={f.language}
          onChange={(v) => u("language", v)}
          options={LOCALES.map((l) => ({
            value: l.code,
            // Every other entry is the language's own name for itself.
            label: l.code === AUTO_LANG ? t("inlineEditor.languageAuto") : l.label,
          }))}
        />
      </div>
      {/* The browser's own menus: this computer's language unless chosen (#81). */}
      <div className="col-span-2 flex flex-col gap-1">
        <SelectField<UiLanguage>
          label={t("inlineEditor.uiLanguageLabel")}
          value={f.ui_language}
          onChange={(v) => u("ui_language", v)}
          aria-describedby={helpId}
          options={[
            { value: "system", label: t("inlineEditor.uiLanguageSystem") },
            { value: "profile", label: t("inlineEditor.uiLanguageProfile") },
          ]}
        />
        <p id={helpId} className="m-0 text-secondary text-text-soft-400">
          {f.ui_language === "profile" ? t("inlineEditor.uiLanguageHelpProfile") : t("inlineEditor.uiLanguageHelpSystem")}
        </p>
      </div>
    </div>
  );
}
