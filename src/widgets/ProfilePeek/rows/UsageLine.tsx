import { useEffect, useState } from "react";
import { fmtDay } from "../../../shared/lib/utils";
import { fmtBytes, fmtBytesParts } from "../../../shared/lib/format";
import { useT } from "../../../shared/i18n";
import { PropertyRow } from "../../../shared/ui/peek";
import { StatValue } from "../../../shared/ui/Stat";
import { UsageBar } from "../../../shared/ui/UsageBar";
import { profileCacheInfo, useProfile, type CacheInfo } from "../../../entities/profile";

/// Usage, drawn as Activity is: the numbers on top as a stat strip (what the
/// profile's data takes on disk, its cache, and how full its 2 GB cache
/// limit is), the cache as a bar against that limit, then when the cache was
/// last emptied as a label and value row. Read again when the profile stops.
export function UsageLine({ id }: { id: string }) {
  const t = useT();
  const running = useProfile((s) => s.running[id] !== undefined);
  const [info, setInfo] = useState<CacheInfo | null>(null);
  useEffect(() => {
    let alive = true;
    profileCacheInfo(id).then((i) => { if (alive) setInfo(i); }, () => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, [id, running]);
  const value = "flex h-[28px] min-w-0 items-center truncate px-1.5 text-ui";
  const disk = info ? fmtBytesParts(info.data_bytes) : null;
  const cache = info ? fmtBytesParts(info.bytes) : null;
  const pct = info && info.limit > 0 ? Math.min(100, Math.round((info.bytes / info.limit) * 100)) : null;
  const stats = [
    { id: "disk", label: t("peek.usageDisk"), value: disk?.value ?? null, unit: disk?.unit },
    { id: "cache", label: t("peek.usageCache"), value: cache?.value ?? null, unit: cache?.unit },
    { id: "limit", label: t("peek.usageLimit"), value: pct === null ? null : String(pct), unit: "%" },
  ];
  return (
    <div data-peek-usage className="flex flex-col">
      <dl data-peek-usage-stats className="m-0 grid grid-cols-3 gap-[12px] pb-[14px]">
        {stats.map((s) => (
          <div key={s.id} data-peek-usage-stat={s.id} className="flex min-w-0 flex-col">
            <dt className="truncate text-section-label text-text-soft-400">{s.label}</dt>
            <dd className="m-0 min-w-0"><StatValue size="sm" value={s.value} unit={s.unit} /></dd>
          </div>
        ))}
      </dl>
      <UsageBar
        label={info ? t("profileForm.cacheOfLimit", { size: fmtBytes(info.bytes), limit: fmtBytes(info.limit) }) : t("peek.usageCache")}
        total={info?.limit ?? 1}
        parts={info ? [{ id: "cache", value: info.bytes, tone: pct !== null && pct >= 80 ? "warning" : "primary" }] : []}
      />
      <div className="mt-[8px] flex flex-col gap-[2px]">
        <PropertyRow id="cache-cleared" label={t("peek.usageCleared")}>
          {() => info?.cleared_at
            ? <span className={`${value} text-text-strong-950`}>{fmtDay(new Date(info.cleared_at * 1000).toISOString())}</span>
            : <span className={`${value} text-text-soft-400`}>{t("peek.never")}</span>}
        </PropertyRow>
      </div>
    </div>
  );
}
