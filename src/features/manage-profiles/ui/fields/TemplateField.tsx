import { SelectField } from "../../../../shared/ui/SelectField";
import { HOST_OS } from "../../../../shared/lib/utils";
import { useT } from "../../../../shared/i18n";
import type { FieldProps } from "./types";
import type { FingerprintPick } from "./useFingerprintPick";

/** The library fingerprint the profile is built on (named GPU in the old editor). */
/** `help`: a line under it that says what it decides (the profile form). */
type TemplateFieldProps = {
  f: FieldProps["f"];
  /** Absent where the field is read-only; the graphics-card choice needs it. */
  u?: FieldProps["u"];
  pick: FingerprintPick;
  label?: string;
  help?: string;
};

export function TemplateField({ f, u, pick, label, help }: TemplateFieldProps) {
  const t = useT();
  // Offered only while the profile claims this computer's system: a Windows
  // profile reporting a Mac's card is a worse tell than the template's.
  const canUseReal = !!u && pick.osFilter === HOST_OS;
  return (
    <div className="flex flex-col gap-1">
      <SelectField
        value={f.gpu_preset_id}
        onChange={(v) => pick.chooseGpu(v)}
        label={label ?? t("inlineEditor.gpuLabel")}
        placeholder={t("inlineEditor.gpuEmpty", { os: pick.osFilter })}
        options={pick.gpusForOs.map((g) => ({ value: g.id, label: g.label }))}
      />
      {canUseReal && (
        <SelectField
          label={t("inlineEditor.gpuSourceLabel")}
          value={f.real_gpu ? "real" : "template"}
          onChange={(v) => u?.("real_gpu", v === "real")}
          options={[
            { value: "template", label: t("inlineEditor.gpuSourceTemplate") },
            { value: "real", label: t("profileForm.realHardware"), badge: { label: t("inlineEditor.gpuSourceReal"), color: "information" as const } },
          ]}
        />
      )}
      {help && <p className="m-0 text-secondary text-text-soft-400">{help}</p>}
      {f.real_gpu && <p className="m-0 text-secondary text-text-soft-400">{t("inlineEditor.gpuSourceRealHelp")}</p>}
    </div>
  );
}
