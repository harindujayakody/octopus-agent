import { useMemo } from "react";
import { countActiveProxyFilters, filterProxies, proxyStatus, useProfileCountByProxy, useProxy, type ProxyFilters } from "../../../entities/proxy";
import { fmtCountry } from "../../../shared/lib/format";
import { CountryFlag } from "../../../shared/ui/CountryFlag";
import { useT } from "../../../shared/i18n";
import type { FilterChip, FilterField } from "../../../shared/ui/filters";

const STATES = ["working", "failed", "untested"] as const;
const KINDS = ["socks5", "http", "https"] as const;
const KIND_LABEL = { socks5: "SOCKS5", http: "HTTP", https: "HTTPS" } as const;

/** The field and value words, called literally so the i18n check sees every key. */
function words(t: (k: string) => string) {
  return {
    state: { working: t("proxyFilters.statusWorking"), failed: t("proxyFilters.statusFailed"), untested: t("proxyFilters.statusUntested") },
    used: { used: t("proxyFilters.used"), unused: t("proxyFilters.unused") },
    field: { status: t("profileFilterBar.statusTitle"), used: t("proxyFilters.usedTitle"), kind: t("proxyFilters.kindTitle"), country: t("proxyFilters.countryTitle") },
  };
}

/// The Proxies Filters menu (O8, IFACE-13): status, used by, type, country,
/// each value counted with its own field set aside and the search as it is.
/// Built only while the menu is open.
export function useProxyFilterFields(enabled: boolean): FilterField[] {
  const t = useT();
  const proxies = useProxy((s) => s.proxies);
  const snapshots = useProxy((s) => s.snapshots);
  const search = useProxy((s) => s.search);
  const filters = useProxy((s) => s.filters);
  const setFilters = useProxy((s) => s.setFilters);
  const used = useProfileCountByProxy();
  return useMemo(() => {
    if (!enabled) return [];
    const w = words(t);
    const byId = new Map(proxies.map((p) => [p.id, p]));
    const ccOf = (id: string) => (snapshots[id]?.country_code || byId.get(id)?.country || "").toUpperCase();
    const count = <K extends keyof ProxyFilters>(key: K, off: ProxyFilters[K], valueOf: (id: string) => string) => {
      const m = new Map<string, number>();
      for (const p of filterProxies(proxies, snapshots, search, { ...filters, [key]: off }, used)) {
        const v = valueOf(p.id);
        if (v) m.set(v, (m.get(v) ?? 0) + 1);
      }
      return m;
    };
    const status = count("status", "any", (id) => { const s = proxyStatus(snapshots[id]); return s === "ok" ? "working" : s; });
    const usedBy = count("used", "any", (id) => (used[id] > 0 ? "used" : "unused"));
    const kind = count("kind", "", (id) => byId.get(id)?.kind ?? "");
    const country = count("country", "", ccOf);
    const countries = [...new Set(proxies.map((p) => ccOf(p.id)).filter(Boolean))].sort();
    const fields: FilterField[] = [
      {
        id: "status", label: w.field.status, current: filters.status === "any" ? null : filters.status,
        set: (v) => setFilters({ status: (v ?? "any") as ProxyFilters["status"] }),
        values: STATES.map((v) => ({ value: v, label: w.state[v], count: status.get(v) ?? 0 })),
      },
      {
        id: "used", label: w.field.used, current: filters.used === "any" ? null : filters.used,
        set: (v) => setFilters({ used: (v ?? "any") as ProxyFilters["used"] }),
        values: (["used", "unused"] as const).map((v) => ({ value: v, label: w.used[v], count: usedBy.get(v) ?? 0 })),
      },
      {
        id: "kind", label: w.field.kind, current: filters.kind || null,
        set: (v) => setFilters({ kind: (v ?? "") as ProxyFilters["kind"] }),
        values: KINDS.map((v) => ({ value: v, label: KIND_LABEL[v], count: kind.get(v) ?? 0 })),
      },
      ...(countries.length > 0 ? [{
        id: "country", label: w.field.country, current: filters.country || null,
        set: (v: string | null) => setFilters({ country: v ?? "" }),
        // The flag in the row's 14 px icon slot, as the Profiles menu's.
        values: countries.map((c) => ({ value: c, label: fmtCountry(c), count: country.get(c) ?? 0, icon: <CountryFlag cc={c} height={10} />, keywords: [c] })),
      }] : []),
    ];
    return fields;
  }, [enabled, t, proxies, snapshots, search, filters, setFilters, used]);
}

/// The applied Proxies filters as chips: "Status: Failed".
export function useProxyFilterChips(): FilterChip[] {
  const t = useT();
  const filters = useProxy((s) => s.filters);
  const setFilters = useProxy((s) => s.setFilters);
  return useMemo(() => {
    const w = words(t);
    const chip = (id: string, field: string, value: string, onRemove: () => void): FilterChip =>
      ({ id, label: t("filters.chip", { field, value }), onRemove });
    const out: FilterChip[] = [];
    if (filters.status !== "any") out.push(chip("status", w.field.status, w.state[filters.status], () => setFilters({ status: "any" })));
    if (filters.used !== "any") out.push(chip("used", w.field.used, w.used[filters.used], () => setFilters({ used: "any" })));
    if (filters.kind) out.push(chip("kind", w.field.kind, KIND_LABEL[filters.kind], () => setFilters({ kind: "" })));
    if (filters.country) out.push(chip("country", w.field.country, fmtCountry(filters.country), () => setFilters({ country: "" })));
    return out;
  }, [t, filters, setFilters]);
}

export { countActiveProxyFilters };
