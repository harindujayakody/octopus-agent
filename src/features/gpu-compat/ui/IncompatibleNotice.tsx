import { useState } from "react";
import { Button, Checkbox, Modal } from "@proxyshard/shardx-ui-kit";
import { useGpuCompat } from "../../../shared/model/gpuCompat";
import { useT } from "../../../shared/i18n";
import type { GpuCompat } from "../../../entities/fingerprint/model/types";

/// The one text that explains an incompatible fingerprint, used by both the
/// badge and the warning dialog — so the operator reads the same reason
/// wherever they meet it.
export function IncompatibleExplainer({ compat }: { compat: GpuCompat }) {
  const t = useT();
  const caps = useGpuCompat((s) => s.caps);
  const missing = [...compat.missing_webgl1, ...compat.missing_webgl2];
  const unique = Array.from(new Set(missing));
  const gpuMissing = Array.from(new Set(compat.missing_webgpu ?? []));
  return (
    <div className="flex flex-col gap-3 text-body text-text-sub-600">
      <p className="m-0">
        {missing.length > 0 && gpuMissing.length > 0
          ? t("incompatibleNotice.claimsBoth")
          : gpuMissing.length > 0 ? t("incompatibleNotice.claimsWebgpu") : t("incompatibleNotice.claimsWebgl")}
      </p>
      <div className="rounded-control bg-bg-weak-50 p-3 text-secondary">
        <div>
          <span className="text-text-soft-400">{t("incompatibleNotice.profileClaims")}</span>{" "}
          <span className="text-text-strong-950">{compat.profile_renderer || "—"}</span>
        </div>
        <div>
          <span className="text-text-soft-400">{t("incompatibleNotice.thisMachineHas")}</span>{" "}
          <span className="text-text-strong-950">{caps?.renderer || t("incompatibleNotice.unknownRenderer")}</span>
        </div>
      </div>
      <p className="m-0">
        {t("incompatibleNotice.reportsListNote")}
      </p>
      <pre className="m-0 overflow-x-auto rounded-control bg-bg-weak-50 p-3 text-secondary">
{`gl.getSupportedExtensions()
  -> [ ..., "${unique[0] ?? "WEBGL_compressed_texture_astc"}", ... ]

gl.getExtension("${unique[0] ?? "WEBGL_compressed_texture_astc"}")
  -> null`}
      </pre>
      <p className="m-0">
        {t("incompatibleNotice.contradictionNote")}
      </p>
      <div>
        <div className="mb-1 text-secondary text-text-soft-400">
          {unique.length === 1
            ? t("incompatibleNotice.extensionsUnbackedOne", { n: unique.length })
            : t("incompatibleNotice.extensionsUnbackedMany", { n: unique.length })}
        </div>
        <div className="max-h-[112px] overflow-y-auto rounded-control bg-bg-weak-50 p-3 text-mono text-text-strong-950">
          {unique.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      </div>
      {gpuMissing.length > 0 && (
        <div>
          <div className="mb-1 text-secondary text-text-soft-400">
            {gpuMissing.length === 1
              ? t("incompatibleNotice.webgpuUnbackedOne", { n: gpuMissing.length })
              : t("incompatibleNotice.webgpuUnbackedMany", { n: gpuMissing.length })}
          </div>
          <div className="max-h-[112px] overflow-y-auto rounded-control bg-bg-weak-50 p-3 text-mono text-text-strong-950">
            {gpuMissing.map((f) => (
              <div key={f}>{f}</div>
            ))}
          </div>
          <p className="m-0 mt-1.5 text-secondary text-text-soft-400">
            {t("incompatibleNotice.webgpuNote")}
          </p>
        </div>
      )}
      <p className="m-0 text-text-soft-400">
        {t("incompatibleNotice.advice")}
      </p>
    </div>
  );
}

/// Shown when the operator picks an incompatible fingerprint by hand. It does
/// not refuse — the choice is theirs and there are legitimate reasons for it
/// (testing, a profile meant for another machine) — it makes sure the cost is
/// known before it is paid.
export function IncompatibleWarningModal({
  open,
  compat,
  onKeep,
  onCancel,
}: {
  open: boolean;
  compat: GpuCompat;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [dontWarn, setDontWarn] = useState(false);
  const setSuppressed = useGpuCompat((s) => s.setSuppressed);
  const keep = () => {
    if (dontWarn) setSuppressed(true);
    onKeep();
  };
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t("incompatibleNotice.warningModalTitle")}
      footer={
        <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Checkbox
            wrapperClassName="min-w-0 flex-1"
            label={t("incompatibleNotice.dontWarnAgain")}
            checked={dontWarn}
            onChange={(e) => setDontWarn(e.target.checked)}
          />
          <div className="flex flex-none gap-2">
            <Button size="xsmall" variant="neutral" mode="stroke" onClick={onCancel}>
              {t("incompatibleNotice.pickAnother")}
            </Button>
            <Button size="xsmall" variant="error" mode="filled" onClick={keep}>
              {t("incompatibleNotice.useAnyway")}
            </Button>
          </div>
        </div>
      }
    >
      <IncompatibleExplainer compat={compat} />
    </Modal>
  );
}
