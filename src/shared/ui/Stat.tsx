import type { ReactNode } from "react";
import { cn } from "@proxyshard/shardx-ui-kit";
import { TrendDownIcon, TrendFlatIcon, TrendUpIcon } from "../icons";
import { useT } from "../i18n";

/// A key number as the owner's rule draws it ("more air, clearer
/// hierarchy"): the number big, bold and dark (`text-stat`, or `-sm` in Peek
/// and in tiles), its unit beside it small and soft, and a trend after it.
/// An unknown number is a soft dash.

/** Which way is better for a measure: its trend is green that way and red
 *  the other; `neutral` (neither is better) is soft both ways. */
export type TrendPolarity = "upGood" | "downGood" | "neutral";

export function StatValue({ value, unit, size = "md", trend, polarity = "neutral" }: {
  /** null: not known (a soft dash). */
  value: ReactNode | null;
  unit?: string;
  size?: "md" | "sm";
  /** Whole percent against the period before; null or absent: none shown. */
  trend?: number | null;
  polarity?: TrendPolarity;
}) {
  return (
    <div data-stat className="flex min-w-0 items-baseline gap-[6px]">
      <span data-stat-value className={cn(size === "md" ? "text-stat" : "text-stat-sm", "truncate", value === null && "text-text-soft-400")}>
        {value ?? "—"}
      </span>
      {unit && value !== null && <span data-stat-unit className="shrink-0 text-body text-text-soft-400">{unit}</span>}
      {trend != null && <Trend pct={trend} polarity={polarity} />}
    </div>
  );
}

/** "↗ 18%": 12 px medium, the arrow in a 14 px slot centered on the text's
 *  line, the text itself on the row's baseline (the number's and the unit's); green where the move
 *  is good, red where it is bad, soft where neither is better. */
export function Trend({ pct, polarity }: { pct: number; polarity: TrendPolarity }) {
  const t = useT();
  const dir = Math.sign(pct);
  const good = dir === 0 || polarity === "neutral" ? null : (dir === 1) === (polarity === "upGood");
  const Icon = dir === 1 ? TrendUpIcon : dir === -1 ? TrendDownIcon : TrendFlatIcon;
  const n = `${Math.abs(pct)}%`;
  return (
    <span
      data-trend={dir === 1 ? "up" : dir === -1 ? "down" : "flat"}
      className={cn(
        "inline-flex shrink-0 items-baseline gap-[2px] text-secondary font-medium tabular-nums",
        good === null ? "text-text-soft-400" : good ? "text-success-text" : "text-error-text",
      )}
    >
      <span aria-hidden className="inline-grid w-3.5 self-center place-items-center"><Icon className="size-3.5" /></span>
      <span aria-hidden>{n}</span>
      <span className="sr-only">{dir === 1 ? t("stat.trendUp", { n }) : dir === -1 ? t("stat.trendDown", { n }) : t("stat.trendFlat")}</span>
    </span>
  );
}
