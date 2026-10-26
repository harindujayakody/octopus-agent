import { useProxy } from "../../../entities/proxy";
import { FilterChips } from "../../../shared/ui/filters";
import { useProxyFilterChips } from "../lib/filterFields";

/** The applied Proxies filters as chips (no "Save as view" yet: Views on proxies come later, IFACE-13). */
export function ProxyFilterChips() {
  const chips = useProxyFilterChips();
  const clearFilters = useProxy((s) => s.clearFilters);
  return <FilterChips chips={chips} onClear={clearFilters} />;
}
