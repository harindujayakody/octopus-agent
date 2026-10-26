import { useMemo, useState } from "react";
import { SegmentControl } from "@proxyshard/shardx-ui-kit";
import { OS_OPTIONS } from "../../shared/constants";
import { FilterChips, FilterMenu, type FilterChip, type FilterField } from "../../shared/ui/filters";
import { useT } from "../../shared/i18n";
import { deviceTypeOf, filterFingerprints, gpuVendorOf, useFingerprint, type DeviceType, type FingerprintFilters, type GpuVendor } from "../../entities/fingerprint";

const VENDORS: GpuVendor[] = ["NVIDIA", "AMD", "Intel", "Apple", "Qualcomm", "Arm", "Other"];
const DEVICES: DeviceType[] = ["desktop", "phone"];
type T = ReturnType<typeof useT>;
const deviceLabel = (t: T, d: DeviceType) => (d === "phone" ? t("fingerprintFilters.phone") : t("fingerprintFilters.desktop"));
const vendorLabel = (t: T, v: GpuVendor) => (v === "Other" ? t("fingerprintFilters.otherVendor") : v);

/// Above the card grid: the OS as a segment at its own width (a small,
/// exclusive set, CRAFT-05; Bookmarks' Folder tabs are the same control),
/// and Device and GPU vendor in the Filters menu, each applied one as a
/// removable chip (O8), as on Profiles. The header's filter box narrows by
/// text on top of them.
export function FingerprintFilterBar() {
  const t = useT();
  const items = useFingerprint((s) => s.items);
  const filters = useFingerprint((s) => s.filters);
  const search = useFingerprint((s) => s.search);
  const setFilters = useFingerprint((s) => s.setFilters);
  const [open, setOpen] = useState(false);

  // Built only while the menu is open: each value with how many cards it
  // would show beside the other filters and the search.
  const fields = useMemo<FilterField[]>(() => {
    if (!open) return [];
    const countBy = (reset: Partial<FingerprintFilters>, key: (e: (typeof items)[number]) => string) => {
      const m = new Map<string, number>();
      for (const e of filterFingerprints(items, search, { ...filters, ...reset })) m.set(key(e), (m.get(key(e)) ?? 0) + 1);
      return m;
    };
    const byDevice = countBy({ device: "all" }, deviceTypeOf);
    const byVendor = countBy({ vendor: "all" }, gpuVendorOf);
    // Only the vendors the library has.
    const present = new Set(items.map(gpuVendorOf));
    return [
      {
        id: "device",
        label: t("fingerprintFilters.device"),
        current: filters.device === "all" ? null : filters.device,
        set: (v) => setFilters({ device: (v ?? "all") as FingerprintFilters["device"] }),
        values: DEVICES.map((d) => ({ value: d, label: deviceLabel(t, d), count: byDevice.get(d) ?? 0 })),
      },
      {
        id: "vendor",
        label: t("fingerprintFilters.vendor"),
        current: filters.vendor === "all" ? null : filters.vendor,
        set: (v) => setFilters({ vendor: (v ?? "all") as FingerprintFilters["vendor"] }),
        values: VENDORS.filter((v) => present.has(v)).map((v) => ({ value: v, label: vendorLabel(t, v), count: byVendor.get(v) ?? 0 })),
      },
    ];
  }, [open, items, filters, search, setFilters, t]);

  const chips: FilterChip[] = [
    ...(filters.device !== "all" ? [{
      id: "device",
      label: t("filters.chip", { field: t("fingerprintFilters.device"), value: deviceLabel(t, filters.device) }),
      onRemove: () => setFilters({ device: "all" }),
    }] : []),
    ...(filters.vendor !== "all" ? [{
      id: "vendor",
      label: t("filters.chip", { field: t("fingerprintFilters.vendor"), value: vendorLabel(t, filters.vendor) }),
      onRemove: () => setFilters({ vendor: "all" }),
    }] : []),
  ];

  return (
    <>
      <div role="group" aria-label={t("fingerprintFilters.label")} className="mb-3.5 flex shrink-0 flex-wrap items-center gap-2">
        <SegmentControl
          fit
          size="xsmall"
          aria-label={t("fingerprintFilters.os")}
          value={filters.os}
          items={[{ value: "all", label: t("fingerprintFilters.allOs") }, ...OS_OPTIONS.map((o) => ({ value: o.id, label: o.label }))]}
          onChange={(os) => setFilters({ os })}
        />
        <FilterMenu open={open} onOpenChange={setOpen} fields={fields} activeCount={chips.length} label={t("profileFilterBar.filters")} />
      </div>
      <FilterChips chips={chips} onClear={() => setFilters({ device: "all", vendor: "all" })} />
    </>
  );
}
