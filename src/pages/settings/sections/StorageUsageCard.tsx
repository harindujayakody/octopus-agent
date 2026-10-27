import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@proxyshard/shardx-ui-kit";
import { cacheClearAll, storageUsage, type StorageUsage } from "../../../entities/profile";
import { fmtBytes, fmtBytesParts } from "../../../shared/lib/format";
import { StatValue } from "../../../shared/ui/Stat";
import { UsageBar, UsageDot, type UsageTone } from "../../../shared/ui/UsageBar";
import { LoadError } from "../../../shared/ui/ListStates";
import { confirmModal } from "../../../shared/model/confirm";
import { toast } from "../../../shared/model/toast";
import { useT } from "../../../shared/i18n";

type Part = "profiles" | "cache" | "browsers" | "extensions" | "trash" | "other";
const PARTS: { id: Part; tone: UsageTone }[] = [
  { id: "profiles", tone: "primary" },
  { id: "cache", tone: "warning" },
  { id: "browsers", tone: "information" },
  { id: "extensions", tone: "success" },
  { id: "trash", tone: "error" },
  { id: "other", tone: "gray" },
];

function partLabel(id: Part, usage: StorageUsage | null, t: ReturnType<typeof useT>): string {
  switch (id) {
    case "profiles": return usage ? t("settings.storageProfilesN", { n: usage.profile_count }) : t("settings.storageProfiles");
    case "cache": return t("settings.storageCache");
    case "browsers": return t("settings.storageBrowsers");
    case "extensions": return t("settings.storageExtensions");
    case "trash": return t("settings.storageTrash");
    case "other": return t("settings.storageOther");
  }
}

/// What Octopus Agent takes on this computer: the total as a stat, a bar of
/// each kind with its legend, and Clear all caches, which empties every
/// closed profile's cache (cookies, logins and history stay).
export function StorageUsageCard() {
  const t = useT();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setError(null);
    storageUsage().then(setUsage, (e) => setError(String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const clearAll = async () => {
    const ok = await confirmModal({
      title: t("settings.storageClearTitle"),
      message: t("settings.storageClearHelp"),
      confirmLabel: t("settings.storageClearConfirm"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await cacheClearAll();
      toast.ok(t("settings.storageCleared", { size: fmtBytes(r.freed), n: r.cleared }));
      if (r.skipped_running > 0) toast.info(t("settings.storageSkipped", { n: r.skipped_running }));
      load();
    } catch (e) {
      toast.fail({ title: t("settings.storageClearFailed"), detail: e });
    } finally {
      setBusy(false);
    }
  };

  if (error) return <LoadError what={t("settings.storageTitle")} error={error} onRetry={load} />;
  const total = usage ? PARTS.reduce((n, p) => n + usage[p.id], 0) : 0;
  const totalParts = fmtBytesParts(total);
  return (
    <Card data-storage-usage padding="none" className="flex flex-col gap-3 px-cell py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-section-label text-text-soft-400">{t("settings.storageTotal")}</span>
          <StatValue value={usage ? totalParts.value : null} unit={totalParts.unit} />
        </div>
        <Button variant="neutral" mode="stroke" size="xsmall" data-clear-all-cache isLoading={busy} disabled={!usage || usage.cache === 0} onClick={() => void clearAll()}>
          {t("settings.storageClearAll")}
        </Button>
      </div>
      <UsageBar
        label={t("settings.storageBarLabel", { size: fmtBytes(total) })}
        total={total}
        parts={usage ? PARTS.map((p) => ({ id: p.id, value: usage[p.id], tone: p.tone })) : []}
      />
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-4 gap-y-1.5 p-0">
        {PARTS.map((p) => (
          <li key={p.id} data-storage-part={p.id} className="flex min-w-0 items-center gap-2 text-secondary">
            <UsageDot tone={p.tone} />
            <span className="min-w-0 flex-1 truncate text-text-sub-600">
              {partLabel(p.id, usage, t)}
            </span>
            <span className="shrink-0 tabular-nums text-text-strong-950">{usage ? fmtBytes(usage[p.id]) : "…"}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
