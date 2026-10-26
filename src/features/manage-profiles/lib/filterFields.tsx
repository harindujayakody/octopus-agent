import { useMemo } from "react";
import {
  emptyFilters, lastRunMatches, makeProfileFilter, NO_RUNNING, onProxy, proxyIdOf, sharedProxyIds, useProfile, useProfileCountries, useProfileUi, useViewFilters,
  type ProfileFilters, type ProfileMeta,
} from "../../../entities/profile";
import { tagsOf, useTags } from "../../../entities/tag";
import { fmtCountry } from "../../../shared/lib/format";
import { CountryFlag } from "../../../shared/ui/CountryFlag";
import { TagChip } from "../../../shared/ui/TagChip";
import { translate, useLang } from "../../../shared/i18n";
import type { FilterChip, FilterField } from "../../../shared/ui/filters";

const LAST_RUN = ["day", "week", "month", "stale", "never"] as const;

/** The field and value words, called literally so the i18n check sees every key. */
function words(t: (k: string) => string) {
  return {
    status: { running: t("profileFilterBar.statusRunning"), idle: t("profileFilterBar.statusIdle") },
    proxy: { bound: t("profileFilterBar.connectionBound"), direct: t("profileFilterBar.connectionDirect"), shared: t("profileFilterBar.connectionShared") },
    lastRun: {
      day: t("profileFilterBar.lastRunDay"), week: t("profileFilterBar.lastRunWeek"), month: t("profileFilterBar.lastRunMonth"),
      stale: t("profileFilterBar.lastRunStale"), unused: t("profileFilterBar.lastRunUnused"), never: t("profileFilterBar.lastRunNever"),
    },
    field: {
      status: t("profileFilterBar.statusTitle"), proxy: t("profileFilterBar.connectionTitle"), tag: t("profileFilterBar.tagTitle"),
      lastRun: t("profileFilterBar.lastRunTitle"), country: t("profileFilterBar.countryTitle"),
    },
  };
}

/** `useT`, but one function per language, so the memos below can depend on it. */
function useLangT() {
  const lang = useLang((s) => s.lang);
  return useMemo(() => (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
}

/** A proxy as the Connection field and its chip name it. */
const proxyName = (p: { name: string; host: string; port: number }) => p.name || `${p.host}:${p.port}`;

/// The Filters menu's fields for Profiles (O8). Each value counts the
/// profiles it would list with the other filters, the Folder and the search
/// as they are (CRAFT-08). Counted only while the menu is open (`enabled`).
/// Connection lists, after Through a proxy and Direct, every proxy a profile
/// uses: the profiles on one proxy (`onProxy`), which the Live layer's
/// cards also set. A field the open View filters by itself is `locked`: it
/// shows its value and cannot be changed (the View is edited, not the list).
export function useProfileFilterFields(enabled: boolean): FilterField[] {
  const t = useLangT();
  const lang = useLang((s) => s.lang);
  const profiles = useProfile((s) => s.profiles);
  const proxies = useProfile((s) => s.proxies);
  const running = useProfile((s) => (enabled ? s.running : NO_RUNNING));
  const search = useProfileUi((s) => s.search);
  const folder = useProfileUi((s) => s.folder);
  const filters = useProfileUi((s) => s.filters);
  const setFilters = useProfileUi((s) => s.setFilters);
  const tags = useTags((s) => s.tags);
  const byProfile = useTags((s) => s.byProfile);
  const countries = useProfileCountries();
  const own = useViewFilters();

  return useMemo(() => {
    if (!enabled) return [];
    const w = words(t);
    const now = Date.now();
    const byId = new Map(proxies.map((p) => [p.id, p]));
    const tagsOfId = (id: string) => tagsOf(id, { tags, byProfile });
    const boundTo = (p: ProfileMeta) => (p.proxy_id && byId.has(p.proxy_id) ? p.proxy_id : null);
    // How many profiles each value lists, with this field set aside.
    const count = <K extends keyof ProfileFilters>(key: K, off: ProfileFilters[K], valuesOf: (p: ProfileMeta) => string[]) => {
      const keep = makeProfileFilter(proxies, search, folder, { ...filters, [key]: off }, running, tagsOfId, now, undefined, profiles);
      const m = new Map<string, number>();
      for (const p of profiles) if (keep(p)) for (const v of valuesOf(p)) m.set(v, (m.get(v) ?? 0) + 1);
      return m;
    };
    const status = count("status", "all", (p) => [running[p.id] ? "running" : "idle"]);
    // Who shares a proxy, among what the Folder and the other filters keep (the search aside).
    const shared = sharedProxyIds(profiles.filter(makeProfileFilter(proxies, "", folder, { ...filters, proxy: "all" }, running, tagsOfId, now)), byId);
    const proxy = count("proxy", "all", (p) => { const id = boundTo(p); return id ? ["bound", onProxy(id), ...(shared.has(id) ? ["shared"] : [])] : ["direct"]; });
    const tag = count("tag", "", (p) => tagsOfId(p.id).map((x) => x.id));
    // "Unused for a month" is the Unused action card's own Review filter: in
    // the menu only while it is applied, beside the values a person picks.
    const lastRunValues = filters.lastRun === "unused" ? [...LAST_RUN, "unused" as const] : LAST_RUN;
    const lastRun = count("lastRun", "any", (p) => lastRunValues.filter((v) => lastRunMatches(p.last_launched_at, v, now, p.created_at)));
    const country = count("country", "", (p) => { const id = boundTo(p); const cc = id ? byId.get(id)?.country ?? "" : ""; return cc ? [cc.toUpperCase()] : []; });
    // The proxies any profile uses, in the Proxies page's order, and the one
    // applied even if none does now.
    const used = new Set<string>();
    for (const p of profiles) { const id = boundTo(p); if (id) used.add(id); }
    const on = proxyIdOf(filters.proxy);
    if (on) used.add(on);

    const fields: FilterField[] = [
      {
        id: "status", label: w.field.status, current: filters.status === "all" ? null : filters.status, locked: own !== null && own.status !== "all",
        set: (v) => setFilters({ status: (v ?? "all") as ProfileFilters["status"] }),
        values: (["running", "idle"] as const).map((v) => ({ value: v, label: w.status[v], count: status.get(v) ?? 0 })),
      },
      {
        id: "proxy", label: w.field.proxy, current: filters.proxy === "all" ? null : filters.proxy, locked: own !== null && own.proxy !== "all",
        set: (v) => setFilters({ proxy: (v ?? "all") as ProfileFilters["proxy"] }),
        values: [
          ...(["bound", "direct", "shared"] as const).map((v) => ({ value: v, label: w.proxy[v], count: proxy.get(v) ?? 0 })),
          ...proxies.filter((x) => used.has(x.id)).map((x) => ({
            value: onProxy(x.id), label: proxyName(x), count: proxy.get(onProxy(x.id)) ?? 0,
            keywords: [x.host, `${x.host}:${x.port}`, x.country],
          })),
        ],
      },
      ...(tags.length > 0 ? [{
        id: "tag", label: w.field.tag, current: filters.tag || null, locked: own !== null && own.tag !== "",
        set: (v: string | null) => setFilters({ tag: v ?? "" }),
        // The tag's own chip, as on the rows (owner feedback 5t: never a dot).
        values: tags.map((x) => ({ value: x.id, label: x.name, count: tag.get(x.id) ?? 0, content: <TagChip tag={x} /> })),
      }] : []),
      {
        id: "lastRun", label: w.field.lastRun, current: filters.lastRun === "any" ? null : filters.lastRun, locked: own !== null && own.lastRun !== "any",
        set: (v) => setFilters({ lastRun: (v ?? "any") as ProfileFilters["lastRun"] }),
        values: lastRunValues.map((v) => ({ value: v, label: w.lastRun[v], count: lastRun.get(v) ?? 0 })),
      },
      ...(countries.length > 0 ? [{
        id: "country", label: w.field.country, current: filters.country || null, locked: own !== null && own.country !== "",
        set: (v: string | null) => setFilters({ country: v ?? "" }),
        // The flag in the row's 14 px icon slot (10 px tall, 13 wide).
        // The name is the label; the code stays a search keyword ("DE" finds Germany).
        values: countries.map((c) => ({ value: c, label: fmtCountry(c), count: country.get(c) ?? 0, icon: <CountryFlag cc={c} height={10} />, keywords: [c] })),
      }] : []),
    ];
    return fields;
  }, [enabled, t, lang, profiles, proxies, running, search, folder, filters, setFilters, tags, byProfile, countries, own]);
}

/// The filters a person added as chips: "Status: Running", "Tag: warm-up".
/// Inside a View, the View's own filters are not chips (they are locked, see
/// `ProfileFilterChips`): a chip is a filter that differs from the View's,
/// and taking it off gives the View's own back.
export function useProfileFilterChips(): FilterChip[] {
  const t = useLangT();
  const filters = useProfileUi((s) => s.filters);
  const setFilters = useProfileUi((s) => s.setFilters);
  const only = useProfileUi((s) => s.only);
  const setOnly = useProfileUi((s) => s.setOnly);
  const tags = useTags((s) => s.tags);
  const proxies = useProfile((s) => s.proxies);
  const own = useViewFilters();
  return useMemo(() => {
    const w = words(t);
    const base = own ?? emptyFilters();
    const chip = (id: string, field: string, value: string, onRemove: () => void): FilterChip =>
      ({ id, label: t("filters.chip", { field, value }), onRemove });
    const out: FilterChip[] = [];
    // A problem card's click: the profiles it named ("Problem: Location leak").
    if (only) out.push(chip("only", t("overview.chipField"), only.label, () => setOnly(null)));
    if (filters.status !== "all" && filters.status !== base.status) out.push(chip("status", w.field.status, w.status[filters.status], () => setFilters({ status: base.status })));
    if (filters.proxy !== "all" && filters.proxy !== base.proxy) {
      const on = proxyIdOf(filters.proxy);
      const x = on ? proxies.find((p) => p.id === on) : undefined;
      const value = filters.proxy === "bound" || filters.proxy === "direct" || filters.proxy === "shared" ? w.proxy[filters.proxy] : x ? proxyName(x) : on ?? "";
      out.push(chip("proxy", w.field.proxy, value, () => setFilters({ proxy: base.proxy })));
    }
    if (filters.tag && filters.tag !== base.tag) out.push(chip("tag", w.field.tag, tags.find((x) => x.id === filters.tag)?.name ?? "", () => setFilters({ tag: base.tag })));
    if (filters.lastRun !== "any" && filters.lastRun !== base.lastRun) out.push(chip("lastRun", w.field.lastRun, w.lastRun[filters.lastRun], () => setFilters({ lastRun: base.lastRun })));
    if (filters.country && filters.country !== base.country) out.push(chip("country", w.field.country, fmtCountry(filters.country), () => setFilters({ country: base.country })));
    return out;
  }, [t, filters, setFilters, only, setOnly, tags, proxies, own]);
}
