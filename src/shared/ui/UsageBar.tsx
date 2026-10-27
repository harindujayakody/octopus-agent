import { cn } from "@proxyshard/shardx-ui-kit";

/** One kind of usage in a bar: its share and its color. */
export type UsagePart = { id: string; value: number; tone: UsageTone };
export type UsageTone = "primary" | "information" | "warning" | "success" | "error" | "gray";

const TONE: Record<UsageTone, string> = {
  primary: "bg-primary-base",
  information: "bg-information-base",
  warning: "bg-warning-base",
  success: "bg-success-base",
  error: "bg-error-base",
  gray: "bg-text-soft-400",
};

/// Disk usage as one rounded bar: each part a share of `total` (the parts'
/// sum when absent), the rest of the track empty. A part too small to see
/// still gets a sliver, so a legend entry always has its color in the bar.
export function UsageBar({ parts, total, label }: { parts: UsagePart[]; total?: number; label: string }) {
  const sum = parts.reduce((n, p) => n + p.value, 0);
  const whole = Math.max(total ?? sum, 1);
  return (
    <div role="img" aria-label={label} data-usage-bar className="flex h-[8px] w-full overflow-hidden rounded-full bg-bg-on-tile">
      {parts.filter((p) => p.value > 0).map((p) => (
        <span
          key={p.id}
          data-usage-part={p.id}
          className={cn("h-full", TONE[p.tone])}
          style={{ width: `${Math.max(0.75, (p.value / whole) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/** A legend's color dot, in a part's tone. */
export function UsageDot({ tone }: { tone: UsageTone }) {
  return <span aria-hidden="true" className={cn("inline-block size-[8px] shrink-0 rounded-full", TONE[tone])} />;
}
