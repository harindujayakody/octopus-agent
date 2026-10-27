import { useEffect, useState } from "react";
import { Button } from "@proxyshard/shardx-ui-kit";
import { PropertyRow } from "../../../../shared/ui/peek";
import { profileCacheClear, profileCacheInfo, useProfile, type CacheInfo } from "../../../../entities/profile";
import { fmtBytes } from "../../../../shared/lib/format";
import { fmtDay } from "../../../../shared/lib/utils";
import { UsageBar } from "../../../../shared/ui/UsageBar";
import { toast } from "../../../../shared/model/toast";
import { useT } from "../../../../shared/i18n";

/// An existing profile's browser cache: how much of its 2 GB it takes, as a
/// bar, when it was last emptied, and Clear (what the browser rebuilds by
/// itself: cookies, logins and history stay). Past 2 GB it is emptied by
/// itself before the profile starts. A running profile holds the files, so
/// Clear waits for it.
export function CacheRow({ id, name }: { id: string; name: string }) {
  const t = useT();
  const running = useProfile((s) => s.running[id] !== undefined);
  const [info, setInfo] = useState<CacheInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    profileCacheInfo(id).then((i) => { if (alive) setInfo(i); }, () => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, [id, running]);
  const clear = async () => {
    setBusy(true);
    try {
      const freed = await profileCacheClear(id);
      setInfo((i) => i && { ...i, bytes: 0, data_bytes: Math.max(0, i.data_bytes - freed), cleared_at: Math.floor(Date.now() / 1000) });
      toast.ok(t("profileRow.cacheCleared", { name, size: fmtBytes(freed) }));
    } catch (e) {
      toast.fail({ title: t("profileRow.cacheClearFailed", { name }), detail: e, subject: name });
    } finally {
      setBusy(false);
    }
  };
  const bytes = info?.bytes ?? null;
  const limit = info?.limit ?? 0;
  const near = bytes !== null && limit > 0 && bytes / limit >= 0.8;
  return (
    <PropertyRow id="cache" label={t("profileForm.cache")}>
      {() => (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-1.5 py-1">
          <div className="flex min-w-0 items-center gap-2">
            <span data-cache-size className="min-w-0 flex-1 truncate text-ui tabular-nums text-text-strong-950">
              {bytes === null ? "…" : t("profileForm.cacheOfLimit", { size: fmtBytes(bytes), limit: fmtBytes(limit) })}
            </span>
            <Button variant="neutral" mode="stroke" size="3xsmall" data-cache-clear disabled={busy || running || !bytes} onClick={() => void clear()}>
              {running ? t("profileForm.cacheRunning") : t("profileForm.cacheClear")}
            </Button>
          </div>
          {info && (
            <UsageBar
              label={t("profileForm.cacheOfLimit", { size: fmtBytes(info.bytes), limit: fmtBytes(info.limit) })}
              total={info.limit}
              parts={[{ id: "cache", value: info.bytes, tone: near ? "warning" : "primary" }]}
            />
          )}
          <div className="flex flex-wrap justify-between gap-x-3 text-secondary text-text-soft-400">
            <span data-cache-cleared>
              {info?.cleared_at
                ? t("profileForm.cacheClearedOn", { date: fmtDay(new Date(info.cleared_at * 1000).toISOString()) })
                : t("profileForm.cacheNeverCleared")}
            </span>
            <span>{t("profileForm.cacheAuto")}</span>
          </div>
        </div>
      )}
    </PropertyRow>
  );
}
