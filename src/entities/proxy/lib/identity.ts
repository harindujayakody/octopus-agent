import type { ProxyEntry } from "../model/types";

type Identity = Pick<ProxyEntry, "kind" | "host" | "port" | "username" | "password">;

/// The same proxy, as the backend decides it on import (`same_proxy` in
/// proxy.rs): one kind, host, port, user and password. The password counts:
/// providers that carry a session or routing parameters in it serve
/// different exits from one host, port and user, so those are different
/// proxies. Only an identical one is skipped.
export const sameProxy = (a: Identity, b: Identity): boolean =>
  a.kind === b.kind && a.host === b.host && a.port === b.port && a.username === b.username && a.password === b.password;
