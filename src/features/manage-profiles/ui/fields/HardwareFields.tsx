import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Field } from "../../../../shared/ui/Field";
import { SelectField, optionsOf } from "../../../../shared/ui/SelectField";
import { CPU_OPTIONS, MEMORY_OPTIONS, REFRESH_RATE_OPTIONS } from "../../../../shared/constants";
import { useT } from "../../../../shared/i18n";
import type { FieldProps } from "./types";

type HostHardware = { os: string; cores: number; memory_gb: number };

/** What this computer really has. Null while it is being asked. */
function useHostHardware(): HostHardware | null {
  const [hw, setHw] = useState<HostHardware | null>(null);
  useEffect(() => {
    invoke<HostHardware>("host_hardware").then(setHw).catch(() => setHw(null));
  }, []);
  return hw;
}

export function HardwareFields({ f, u, os }: FieldProps & { os?: string }) {
  const t = useT();
  const host = useHostHardware();
  // Offered only on a profile that claims this very operating system. A
  // Windows profile reporting a Mac's core count, or a Mac one reporting a
  // number no Mac ships, is a worse tell than the rounded guess it replaces.
  const canUseReal = !!host && !!os && os === host.os;
  // An entry of its own, named for what it is, so picking the number this
  // computer really has is something the operator does on purpose — the
  // plain numbers beside it stay what they were. Worth saying out loud
  // because every profile that takes it answers alike, which ties them to
  // each other; that is the trade and it should be visible.
  const withReal = (values: number[], real: number, badge: string) =>
    canUseReal && real > 0
      ? [
          { value: real, label: `${real}`, badge: { label: badge, color: "information" as const } },
          ...optionsOf(values.filter((v) => v !== real)),
        ]
      : optionsOf(values);
  return (
    <>
      <Field label={t("inlineEditor.userAgentLabel")} value={f.user_agent} onChange={(v) => u("user_agent", v)} mono />

      <div className="grid grid-cols-2 gap-[12px]">
        <SelectField
          label={t("inlineEditor.cpuLabel")}
          value={f.hardware_concurrency}
          onChange={(v) => u("hardware_concurrency", v)}
          options={withReal(CPU_OPTIONS, host?.cores ?? 0, t("profileForm.realHardware"))}
        />
        <SelectField
          label={t("inlineEditor.memoryLabel")}
          value={f.device_memory}
          onChange={(v) => u("device_memory", v)}
          options={withReal(MEMORY_OPTIONS, host?.memory_gb ?? 0, t("profileForm.realHardware"))}
        />
      </div>

      <SelectField
        label={t("inlineEditor.refreshRateLabel")}
        value={f.refresh_rate}
        onChange={(v) => u("refresh_rate", v)}
        options={optionsOf(REFRESH_RATE_OPTIONS, (v) => `${v} Hz`)}
      />
      <p className="m-0 -mt-2 text-secondary text-text-soft-400">
        {t("inlineEditor.refreshRateHelp")}
      </p>
    </>
  );
}
