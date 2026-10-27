import { useEffect, useState } from "react";
import { Button } from "@proxyshard/shardx-ui-kit";
import { PropertyRow, PropertyValue } from "../../../../shared/ui/peek";
import { profileCacheClear, profileCacheSize, useProfile } from "../../../../entities/profile";
import { fmtBytes } from "../../../../shared/lib/format";
import { toast } from "../../../../shared/model/toast";
import { useT } from "../../../../shared/i18n";

/// An existing profile's browser cache: how much disk it takes, and Clear
/// to empty it (what the browser rebuilds by itself: cookies, logins and
/// history stay). A running profile holds the files, so Clear waits for it.
export function CacheRow({ id, name }: { id: string; name: string }) {
  const t = useT();
  const running = useProfile((s) => s.running[id] !== undefined);
  const [bytes, setBytes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    profileCacheSize(id).then((n) => { if (alive) setBytes(n); }, () => { if (alive) setBytes(null); });
    return () => { alive = false; };
  }, [id, running]);
  const clear = async () => {
    setBusy(true);
    try {
      const freed = await profileCacheClear(id);
      setBytes(0);
      toast.ok(t("profileRow.cacheCleared", { name, size: fmtBytes(freed) }));
    } catch (e) {
      toast.fail({ title: t("profileRow.cacheClearFailed", { name }), detail: e, subject: name });
    } finally {
      setBusy(false);
    }
  };
  return (
    <PropertyRow id="cache" label={t("profileForm.cache")}>
      {() => (
        <PropertyValue>
          <span data-cache-size className="min-w-0 flex-1 truncate tabular-nums">{bytes === null ? "…" : fmtBytes(bytes)}</span>
          <Button
            variant="neutral"
            mode="stroke"
            size="3xsmall"
            data-cache-clear
            disabled={busy || running || !bytes}
            onClick={() => void clear()}
          >
            {running ? t("profileForm.cacheRunning") : t("profileForm.cacheClear")}
          </Button>
        </PropertyValue>
      )}
    </PropertyRow>
  );
}
