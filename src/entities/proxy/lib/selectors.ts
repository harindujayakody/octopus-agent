import { useMemo } from "react";
import { filterProxies, sortProxies, useProxy, usedByProxy } from "./useProxy";

/// The proxies the list shows, in Display's order: the search (name, host,
/// port, country, notes, user, geo snapshot) and the Filters menu.
export function useFilteredProxies() {
    const proxies = useProxy((s) => s.proxies);
    const snapshots = useProxy((s) => s.snapshots);
    const search = useProxy((s) => s.search);
    const filters = useProxy((s) => s.filters);
    const sort = useProxy((s) => s.sort);
    const used = useProfileCountByProxy();
    return useMemo(
        () => sortProxies(filterProxies(proxies, snapshots, search, filters, used), sort, snapshots, used),
        [proxies, snapshots, search, filters, sort, used],
    );
}

/// proxy_id → bound-profile count (O(n) tally; n is small).
export function useProfileCountByProxy() {
    const profiles = useProxy((s) => s.profiles);
    return useMemo(() => usedByProxy(profiles), [profiles]);
}

/// The selected proxies the list shows, in its order: what bulk actions act on.
export function useSelectedVisibleProxies() {
    const visible = useFilteredProxies();
    const sel = useProxy((s) => s.proxySel);
    return useMemo(() => visible.filter((p) => sel.has(p.id)), [visible, sel]);
}
