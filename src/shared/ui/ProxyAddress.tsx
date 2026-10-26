import { cn, Tooltip } from "@proxyshard/shardx-ui-kit";
import { CountryFlag } from "./CountryFlag";
import type { ProxyEntry } from "../../entities/proxy";

type Kind = ProxyEntry["kind"];

/// Owner feedback 5n: "looks like we have different size texts here on the
/// proxy label in the row" — the type was 10.5 px/semibold while the
/// address next to it was mono 12 px, two sizes on two baselines. One look
/// for the type word everywhere it shows, exported on its own so a cell
/// that keeps type and address in separate columns (ProxyListRow's grid)
/// can still match this exactly without merging the columns.
export function ProxyKind({ kind, className }: { kind: Kind; className?: string }) {
  return (
    <span data-role="proxy-kind" className={cn("shrink-0 text-secondary font-medium text-text-soft-400", className)}>
      {kind.toUpperCase()}
    </span>
  );
}

/// flag + type + address, sharing one size and one baseline (owner
/// feedback 5n): both 12 px, the type medium-weight and muted, the address
/// staying JetBrains Mono in the row's usual sub text color, 6 px apart, no
/// tracking added (the protocol is written in capitals, never transformed). The one look for "a proxy's type and address" every
/// place they show together in a single cell. `wholeOnHover`: in a list
/// column sized to its content, a cut address shows whole in a tooltip
/// (autofit review I1), from anywhere on the line: a column given way to
/// its minimum can leave the address no room at all, only the flag and type.
export function ProxyAddress({ kind, host, port, country, className, wholeOnHover = false }: {
  kind: Kind;
  host: string;
  port: number;
  country?: string | null;
  className?: string;
  wholeOnHover?: boolean;
}) {
  const line = (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {country && <CountryFlag cc={country} />}
      <span className="inline-flex min-w-0 items-baseline gap-1.5">
        <ProxyKind kind={kind} />
        <span data-role="proxy-address" className="min-w-0 truncate text-mono text-text-sub-600">{host}:{port}</span>
      </span>
    </span>
  );
  return wholeOnHover ? <Tooltip content={`${host}:${port}`} whenTruncated warm={false}>{line}</Tooltip> : line;
}
