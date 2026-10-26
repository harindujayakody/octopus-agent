import { Switch } from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../../shared/i18n";
import { SectionHeading } from "./SectionHeading";
import type { FieldProps } from "./types";

/// How the profile's window behaves, next to the screen it claims: for now the
/// one switch, focus. Shown for every OS — unlike the resolution, nothing here
/// depends on the host.
export function WindowFields({ f, u }: FieldProps) {
  const t = useT();
  return (
    <>
      <div className="mt-2.5">
        <SectionHeading>{t("inlineEditor.windowHeading")}</SectionHeading>
      </div>
      <Switch
        label={t("inlineEditor.keepFocusLabel")}
        checked={f.keep_focus}
        onChange={(checked) => u("keep_focus", checked)}
      />
      <p className="m-0 -mt-1 text-secondary text-text-soft-400">
        {t("inlineEditor.keepFocusHelp")}
      </p>
    </>
  );
}
