import type { ProxyEntry } from "../model/types";

/// How a list names a proxy: its name, else its address.
export const proxyLabel = (p: ProxyEntry): string => p.name || `${p.host}:${p.port}`;

/// The labels more than one proxy has (three called "standart resi"): those
/// proxies need their address and country beside the name to be told apart.
export function duplicateLabels(proxies: readonly ProxyEntry[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const p of proxies) {
    const label = proxyLabel(p);
    if (seen.has(label)) twice.add(label);
    else seen.add(label);
  }
  return twice;
}

/// A proxy's address as a picker's hint: `host:port`, and for a proxy whose
/// label another proxy shares, `host:port, CC` with the country code when it
/// is known.
export function proxyAddressHint(p: ProxyEntry, shared: boolean): string {
  const address = `${p.host}:${p.port}`;
  return shared && p.country ? `${address}, ${p.country.toUpperCase()}` : address;
}
