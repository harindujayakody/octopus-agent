import { useMemo } from "react";
import { type ComboboxOption } from "@proxyshard/shardx-ui-kit";
import { duplicateLabels, proxyAddressHint, proxyLabel, type ProxyEntry } from "../../../entities/proxy";
import { bindRefusal, useAccess, useInTeam } from "../../../entities/space";
import { useT } from "../../../shared/i18n";
import { ProxyFlag } from "../../../shared/ui/ProxyFlag";

/// The proxy choices every picker shows (TYPE-07): "No proxy" first, then
/// each proxy by its name with host:port kept whole as the hint, its flag (a
/// globe in the same slot when it has none, so the names line up), and its
/// host, country and type as words the search finds. A name more than one
/// proxy has gets `host:port, CC` as the hint so they can be told apart
/// (owner item 11). Built once per
/// list, not per render (PERF-15: 1,000 proxies); `t` changes only with the
/// language, which rebuilds the tree. A bound proxy that is gone (`value`
/// names no proxy) reads as missing, never as No proxy (IFACE-01).
export function useProxyOptions(proxies: ProxyEntry[], value?: string | null): ComboboxOption[] {
  const t = useT();
  // A team binds only a proxy this member may use; one they cannot see comes with its profile.
  const team = useInTeam();
  const read = useAccess((s) => s.read);
  return useMemo(() => {
    const shared = duplicateLabels(proxies);
    return [
      { value: "", label: t("proxySelect.directConnection") },
      ...(value && !proxies.some((p) => p.id === value)
        ? [{ value, label: team ? t("profileRow.proxyHidden") : t("profileRow.proxyMissing"), disabled: true }]
        : []),
      ...proxies.map((p) => {
        const label = proxyLabel(p);
        const isShared = shared.has(label);
        const refused = team && p.id !== value ? bindRefusal(p.id) : null;
        return {
          value: p.id,
          label,
          hint: refused ?? (isShared || label !== `${p.host}:${p.port}` ? proxyAddressHint(p, isShared) : undefined),
          keywords: [p.host, p.country ?? "", p.kind],
          icon: <ProxyFlag cc={p.country} height={14} />,
          ...(refused ? { disabled: true } : {}),
        };
      }),
    ];
    // `read`: the access the refusals are judged by.
  }, [proxies, value, t, team, read]);
}
