import { fmtDay } from "../../../shared/lib/utils";
import { fmtBytesParts, fmtCount } from "../../../shared/lib/format";
import { useT } from "../../../shared/i18n";
import { PropertyRow } from "../../../shared/ui/peek";
import { StatValue } from "../../../shared/ui/Stat";
import type { ProfileMeta } from "../../../entities/profile";

/// A runtime as a stat: whole hours ("212" h) from an hour up, minutes under
/// it. Not fmtDuration's "8 d 20 h": a stat keeps its number and its one unit
/// apart (owner's stat rule); the number is grouped by fmtCount.
function runtime(ms: number, t: ReturnType<typeof useT>): { value: string; unit: string } {
  const min = Math.max(0, Math.floor(ms / 60_000));
  return min >= 60
    ? { value: fmtCount(Math.floor(min / 60)), unit: t("peek.unitHours") }
    : { value: fmtCount(min), unit: t("peek.unitMinutes") };
}

/// Activity (owner, "more air, clearer hierarchy"): the numbers on top as a
/// stat strip, big and dark under small section labels (Total time, Launches,
/// Traffic, each only when its data exists: Launches and Traffic come with
/// backend B41), then a hairline, then when the profile was made and when it
/// last ran as label and value rows.
export function ActivityLine({ profile }: { profile: ProfileMeta }) {
  const t = useT();
  const created = profile.created_at ? fmtDay(profile.created_at) : "";
  const value = "flex h-[28px] min-w-0 items-center truncate px-1.5 text-ui";
  const time = runtime(profile.total_runtime_ms, t);
  // A profile that has never run has started 0 times and carried 0 bytes:
  // known without the backend's counts (B41), which a new profile never has.
  // Without this a just-made profile's strip showed Total time alone, its
  // other two places empty, as if they had not loaded (owner, 2026-10-02).
  const neverRun = !profile.last_launched_at && !profile.total_runtime_ms;
  const launches = typeof profile.launches === "number" ? profile.launches : neverRun ? 0 : null;
  const bytes = typeof profile.traffic_bytes === "number" ? profile.traffic_bytes : neverRun ? 0 : null;
  const traffic = bytes !== null ? fmtBytesParts(bytes) : null;
  const stats = [
    { id: "total-time", label: t("peek.activityTotalTime"), ...time },
    ...(launches !== null ? [{ id: "launches", label: t("peek.activityLaunches"), value: fmtCount(launches), unit: undefined }] : []),
    ...(traffic ? [{ id: "traffic", label: t("peek.activityTraffic"), ...traffic }] : []),
  ];
  return (
    <div data-peek-activity className="flex flex-col">
      <dl data-peek-stats className="m-0 grid grid-cols-3 gap-[12px] pb-[14px]">
        {stats.map((s) => (
          <div key={s.id} data-peek-stat={s.id} className="flex min-w-0 flex-col">
            <dt className="truncate text-section-label text-text-soft-400">{s.label}</dt>
            <dd className="m-0 min-w-0"><StatValue size="sm" value={s.value} unit={s.unit} /></dd>
          </div>
        ))}
      </dl>
      {/* 8 px under the stats: with the row's own 6, its text sits 14 px down. */}
      <div className="mt-[8px] flex flex-col gap-[2px]">
        {created && (
          <PropertyRow id="created" label={t("peek.activityCreated")}>
            {() => <span className={`${value} text-text-strong-950`}>{created}</span>}
          </PropertyRow>
        )}
        <PropertyRow id="last-run" label={t("peek.activityLastRun")}>
          {() => profile.last_launched_at
            ? <span className={`${value} text-text-strong-950`}>{fmtDay(profile.last_launched_at)}</span>
            : <span className={`${value} text-text-soft-400`}>{t("peek.never")}</span>}
        </PropertyRow>
      </div>
    </div>
  );
}
