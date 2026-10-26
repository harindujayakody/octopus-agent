import type { StatusDotTone } from "../../../shared/ui/StatusDot";
import type { ProxyTestSnapshot } from "../model/types";

/// What the last test says: reached (with its time), failed, or never run.
///
/// Either proof counts, because each one is traffic that went through the
/// proxy and came back: an answer from the host the probe asked for, or an
/// address a geo service saw us arrive from. A latency on its own no longer
/// does — the old test called a proxy reached as soon as it had greeted us,
/// so a gateway with a dead upstream, no traffic left or a banned address
/// read as working.
export function proxyStatus(snap: ProxyTestSnapshot | undefined): "ok" | "failed" | "untested" {
  if (!snap) return "untested";
  return snap.tcp_ms != null || snap.ip !== "" ? "ok" : "failed";
}

/// Owner feedback 5i: the one mapping from a proxy's Test result to its
/// dot's color, shared by the Proxies list and Proxy Peek's status line so
/// neither drifts from the other (fix round 1, finding 12: moved here from
/// the Proxies list widget, mirroring `src/entities/profile/lib/status.ts`,
/// so a widget other than the list — Peek — isn't importing from a sibling
/// widget for it). A test in flight always reads `info`, whatever the
/// previous result was.
export function proxyStatusDot(status: ReturnType<typeof proxyStatus>, busy: boolean): StatusDotTone {
  if (busy) return "info";
  return status === "ok" ? "success" : status === "failed" ? "error" : "outline";
}
