import { SegmentControl } from "@proxyshard/shardx-ui-kit";
import { useT } from "../i18n";
import type { NoiseMode } from "../../entities/profile";
import { FieldGroup } from "./FieldGroup";

/// Two-way toggle (Real/Auto-noise or Allow/Block) — UI-kit SegmentControl.
export function Pair({
  label, value, on, blockLabel, onText,
}: {
  label: string;
  value: NoiseMode;
  on: (v: NoiseMode) => void;
  /// Allow/Block labels instead of Real/Auto (used by Ports).
  blockLabel?: boolean;
  /// Custom "on" label (default "Auto noise"; Fonts passes "Noise").
  onText?: string;
}) {
  const t = useT();
  const labelFor = (o: NoiseMode) =>
    blockLabel
      ? (o === "real" ? t("portList.allow") : t("portList.block"))
      : (o === "real" ? t("inlineEditor.noiseReal") : (onText ?? t("inlineEditor.noiseAuto")));
  return (
    <FieldGroup label={label}>
      {(labelId) => (
        <SegmentControl
          aria-labelledby={labelId}
          size="xsmall"
          className="w-full *:flex-1 flex-nowrap text-nowrap"
          value={value}
          items={(["real", "auto"] as NoiseMode[]).map((o) => ({ value: o, label: labelFor(o) }))}
          onChange={(v) => on(v as NoiseMode)}
        />
      )}
    </FieldGroup>
  );
}
