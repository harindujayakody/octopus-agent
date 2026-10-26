import { useProfile } from "../entities/profile";
import { useProxy } from "../entities/proxy";

/// The Proxies page counts and lists the profiles on each proxy from the
/// Profiles store's own list (the same array), not from a second copy read
/// over IPC after every change (PERF-21). The two stores cannot import each
/// other (the proxy entity sits below the profile one), so the app joins them.
useProxy.setState({ profiles: useProfile.getState().profiles });
useProfile.subscribe((s, prev) => {
  if (s.profiles !== prev.profiles) useProxy.setState({ profiles: s.profiles });
});

// The profile search matches a proxy's last seen IP (IFACE-13): the Proxies
// store holds the tests; the Profiles store gets a plain map of them.
let lastSnaps: unknown = null;
useProxy.subscribe((s) => {
  if (s.snapshots === lastSnaps) return;
  lastSnaps = s.snapshots;
  const ips: Record<string, string> = {};
  for (const [id, snap] of Object.entries(s.snapshots)) if (snap?.ip) ips[id] = snap.ip;
  useProfile.setState({ proxyIps: ips });
});
