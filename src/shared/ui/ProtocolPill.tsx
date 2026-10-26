import { cn } from "@proxyshard/shardx-ui-kit";
import type { ProxyEntry } from "../../entities/proxy";

type Kind = ProxyEntry["kind"];

/// A proxy's protocol as a neutral chip (owner, 2026-10-01): the plain Folder
/// chip's look, the weak fill and sub text, no border. The protocol is not a
/// state, so it carries no color. The word as the type column shows it
/// (written in capitals, HTTP or SOCKS5, never a CSS transform; medium
/// weight); no edge but the forced-colors one.
export function ProtocolPill({ kind, className }: { kind: Kind; className?: string }) {
  return (
    <span
      data-pill="protocol"
      data-protocol={kind}
      className={cn(
        "inline-flex shrink-0 items-center rounded-chip-sm px-1.5 py-0.5 align-middle bg-bg-weak-50 text-secondary font-medium text-text-sub-600 forced-edge",
        className,
      )}
    >
      {kind.toUpperCase()}
    </span>
  );
}
