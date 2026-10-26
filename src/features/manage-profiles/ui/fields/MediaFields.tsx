import { Switch } from "@proxyshard/shardx-ui-kit";
import { SelectField, optionsOf } from "../../../../shared/ui/SelectField";
import { MEDIA_COUNT_OPTIONS } from "../../../../shared/constants";
import { claimsMobile } from "../../../../entities/profile";
import { useT } from "../../../../shared/i18n";
import { SectionHeading } from "./SectionHeading";
import type { FieldProps } from "./types";

export function MediaFields({ f, u }: FieldProps) {
  const t = useT();
  return (
    <>
      <div className="mt-2.5">
        <SectionHeading>{t("inlineEditor.mediaDevicesHeading")}</SectionHeading>
      </div>
      <div className="grid grid-cols-3 gap-[12px]">
        <SelectField label={t("inlineEditor.micLabel")} value={f.media_audio_in} onChange={(v) => u("media_audio_in", v)} options={optionsOf(MEDIA_COUNT_OPTIONS)} />
        <SelectField label={t("inlineEditor.speakersLabel")} value={f.media_audio_out} onChange={(v) => u("media_audio_out", v)} options={optionsOf(MEDIA_COUNT_OPTIONS)} />
        <SelectField label={t("inlineEditor.webcamLabel")} value={f.media_video_in} onChange={(v) => u("media_video_in", v)} options={optionsOf(MEDIA_COUNT_OPTIONS)} />
      </div>

      {claimsMobile(f) && (
        <>
          <div className="mt-2.5">
            <SectionHeading>{t("inlineEditor.mediaHeading")}</SectionHeading>
          </div>
          <Switch
            label={t("inlineEditor.androidMediaLabel")}
            checked={f.android_media}
            onChange={(checked) => u("android_media", checked)}
          />
          <p className="m-0 -mt-1 text-secondary text-text-soft-400">
            {t("inlineEditor.androidMediaHelp")}
          </p>
        </>
      )}
    </>
  );
}
