import { SegmentControl } from "@proxyshard/shardx-ui-kit";
import { NumField } from "../../../../shared/ui/NumField";
import { SelectField } from "../../../../shared/ui/SelectField";
import type { GeoMode, WebRtcMode } from "../../../../entities/profile";
import { useT } from "../../../../shared/i18n";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import type { FieldProps } from "./types";

/** `webrtcHelp`: a line under WebRTC that says what it decides (the profile
 *  form). `onInvalid`: a coordinate or the accuracy shows text that is not a
 *  number (the field's name, and whether), so a form can hold its Save. */
export function PrivacyFields({ f, u, webrtcHelp, onInvalid }: FieldProps & { webrtcHelp?: string; onInvalid?: (field: string, bad: boolean) => void }) {
  const t = useT();
  return (
    <>
      <div className="grid grid-cols-2 gap-[12px]">
        <div className="flex flex-col gap-1">
          <SelectField
            label={t("inlineEditor.webrtcLabel")}
            value={f.webrtc}
            onChange={(v) => u("webrtc", v as WebRtcMode)}
            options={[
              { value: "auto", label: t("inlineEditor.webrtcAuto") },
              { value: "tcp_only", label: t("inlineEditor.webrtcTcpOnly") },
              { value: "block", label: t("inlineEditor.webrtcBlock") },
            ]}
          />
          {webrtcHelp && <p className="m-0 text-secondary text-text-soft-400">{webrtcHelp}</p>}
        </div>
        <div className="flex flex-col gap-1">
          <SelectField
            label={t("inlineEditor.dntLabel")}
            value={f.do_not_track ? "1" : "0"}
            onChange={(v) => u("do_not_track", v === "1")}
            options={[
              { value: "0", label: t("inlineEditor.dntOff") },
              { value: "1", label: t("inlineEditor.dntOn") },
            ]}
          />
        </div>
      </div>

      <FieldGroup label={t("inlineEditor.geoLabel")}>
        {(labelId) => (
          <SegmentControl
            aria-labelledby={labelId}
            size="xsmall"
            className="w-full *:flex-1"
            value={f.geo_mode}
            items={(["auto", "manual"] as GeoMode[]).map((m) => ({
              value: m,
              label: m === "auto" ? t("inlineEditor.geoAuto") : t("inlineEditor.geoManual"),
            }))}
            onChange={(v) => u("geo_mode", v as GeoMode)}
          />
        )}
      </FieldGroup>
      {f.geo_mode === "manual" && (
        <div className="grid grid-cols-3 gap-[12px]">
          <NumField label={t("inlineEditor.latitudeLabel")} value={f.geo_lat} min={-90} max={90} decimals={4} onChange={(v) => u("geo_lat", v)} onInvalid={(bad) => onInvalid?.("geo_lat", bad)} />
          <NumField label={t("inlineEditor.longitudeLabel")} value={f.geo_lng} min={-180} max={180} decimals={4} onChange={(v) => u("geo_lng", v)} onInvalid={(bad) => onInvalid?.("geo_lng", bad)} />
          <NumField label={t("inlineEditor.accuracyLabel")} value={f.geo_accuracy} min={1} max={100000} onChange={(v) => u("geo_accuracy", v)} onInvalid={(bad) => onInvalid?.("geo_accuracy", bad)} />
        </div>
      )}
    </>
  );
}
