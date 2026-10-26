import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@proxyshard/shardx-ui-kit";
import { textWidth } from "../lib/measureText";

/// The app's charts, one look (owner, "more air, clearer hierarchy"): a thin
/// line (1.6 px) with a faint area under it, a faint horizontal grid, axis
/// numbers soft at 11 px with tabular digits, and a dot at the last point.
/// Drawn to scale: the value axis runs to the first grid step at or above
/// the peak, and every step has its gridline and its label. Theme tokens
/// only. Drawn in real pixels at the box's measured size (no stretched
/// strokes or text), so a chart can fill whatever height its card has.
/// Without history a chart is the No data ghost, never a made-up line.

/** The size of the box `ref` points at, kept current, in layout px: under
 *  Interface size (CSS zoom on <html>) a rect is zoomed, so a chart drawn to
 *  it ran past its card (owner's live screenshot); offsetWidth is not. */
function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Grid steps of 1, 2, 2.5 or 5 times a power of ten: two to four under the peak. */
function niceStep(peak: number): number {
  if (!(peak > 0)) return 1;
  const rough = peak / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag;
}

const LINE_W = 1.6;
/** The axis labels' face (`text-micro`), for measuring them. */
const AXIS_FONT = "500 11px 'Inter Variable', sans-serif";
const DOT_R = 3;

/** The line through the points, and its area down to the baseline. */
function paths(points: number[], x: (i: number) => number, y: (v: number) => number, base: number) {
  if (points.length === 0) return { line: "", area: "" };
  const line = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`;
  return { line, area };
}

/** An x label at its data point (`at`, 0 to n - 1). `first`: the range's
 *  opening label (its first point's day), shown only when it fits. */
export type ChartTick = { at: number; label: string; first?: boolean };

/** A line chart with its axes: values (in the unit its labels name) per
 *  bucket, `ticks` the x labels at their bucket positions (0 to n - 1). */
export function LineChart({ points, ticks, formatValue, label, className }: {
  points: number[];
  ticks: ChartTick[];
  /** A grid value as its axis label ("2 GB"). */
  formatValue: (v: number) => string;
  /** What a screen reader hears: what it shows, over what, and its peak. */
  label: string;
  className?: string;
}) {
  const [ref, { w, h }] = useBoxSize<HTMLDivElement>();
  const AXIS_W = 52; // the values' column, right of the plot, clear of the end dot
  const AXIS_H = 20; // the dates' row, under it
  const top = 8; // the top label's half height, clear of the card's edge
  const right = Math.max(0, w - AXIS_W);
  const base = Math.max(top, h - AXIS_H);
  const peak = Math.max(0, ...points);
  const step = niceStep(peak);
  // The axis covers the data: up to the first step at or above the peak.
  const max = peak > 0 ? Math.ceil(peak / step - 1e-9) * step : step;
  const grid: number[] = [];
  for (let k = 0; k * step <= max + 1e-9; k++) grid.push(k * step);
  const x = (i: number) => (points.length < 2 ? right : (i / (points.length - 1)) * right);
  const y = (v: number) => base - (v / max) * (base - top);
  const { line, area } = paths(points, x, y, base);
  // A date label sits centered under its data point, moved in only as far
  // as it must to stay inside the chart at an edge. The regular labels go
  // first, each 6 px clear of the one before; the range's opening label
  // joins only where it fits.
  const placed = (t: ChartTick) => {
    const tx = x(t.at);
    const width = textWidth(t.label, AXIS_FONT);
    const left = Math.max(0, Math.min(tx - width / 2, w - width));
    return { ...t, left, right: left + width };
  };
  const shown: ReturnType<typeof placed>[] = [];
  for (const t of ticks.filter((k) => !k.first).map(placed)) {
    if (t.left < (shown.at(-1)?.right ?? -Infinity) + 6) continue;
    shown.push(t);
  }
  const opening = ticks.find((k) => k.first);
  if (opening) {
    const t = placed(opening);
    if (t.right + 6 <= (shown[0]?.left ?? Infinity)) shown.unshift(t);
  }
  return (
    <div ref={ref} className={cn("relative min-h-[140px]", className)}>
      {w > 0 && h > 0 && (
        <svg role="img" aria-label={label} width={w} height={h} className="absolute inset-0 overflow-visible">
          <path d={area} className="fill-information-tint" />
          {grid.map((v) => (
            <g key={v}>
              <line data-grid x1={0} x2={right} y1={y(v)} y2={y(v)} className="stroke-stroke-soft-200" strokeWidth={1} shapeRendering="crispEdges" />
              <text data-grid-label x={w} y={y(v) + 4} textAnchor="end" className="fill-text-soft-400 text-micro tabular-nums">{formatValue(v)}</text>
            </g>
          ))}
          <path data-line d={line} fill="none" className="stroke-information-base" strokeWidth={LINE_W} strokeLinejoin="round" strokeLinecap="round" />
          {points.length > 0 && <circle cx={x(points.length - 1)} cy={y(points.at(-1)!)} r={DOT_R} className="fill-information-base" />}
          {shown.map((t) => (
            // Proportional digits, as measured: the label stays centered on its point.
            <text key={t.at} data-x-label x={t.left} y={h - 4} textAnchor="start" className="fill-text-soft-400 text-micro">{t.label}</text>
          ))}
        </svg>
      )}
    </div>
  );
}

/** The small chart of a stat card: 84 px, the line, its area, a baseline
 *  and the last point's dot, no axes. */
export function Sparkline({ points, label, bleed }: { points: number[]; label: string; bleed?: boolean }) {
  const [ref, { w }] = useBoxSize<HTMLDivElement>();
  const h = 84;
  const top = DOT_R + 2;
  // Bleeding (edge to edge in a card that clips it): the line runs the whole
  // width and the area sits on the very bottom; only the dot is held inside.
  const base = bleed ? h : h - 1;
  const right = bleed ? w : Math.max(0, w - DOT_R - 1);
  const peak = Math.max(0, ...points);
  const x = (i: number) => (points.length < 2 ? right : (i / (points.length - 1)) * right);
  const y = (v: number) => (peak > 0 ? base - (v / peak) * (base - top) : base);
  const { line, area } = paths(points, x, y, base);
  // The last point's dot, drawn whole: held its radius and 1 px from the
  // edge, on the line's own height there.
  const last = points.length - 1;
  const dotX = bleed ? Math.min(right, w - DOT_R - 1) : x(last);
  const held = bleed && dotX < right && last > 0;
  const dotY = held
    ? y(points[last - 1] + (points[last] - points[last - 1]) * ((dotX - x(last - 1)) / (right - x(last - 1))))
    : last >= 0 ? y(points[last]) : 0;
  return (
    <div ref={ref} data-sparkline className="relative h-[84px]">
      {w > 0 && (
        <svg role="img" aria-label={label} width={w} height={h} className="absolute inset-0 overflow-visible">
          <path d={area} className="fill-information-tint" />
          {!bleed && <line x1={0} x2={right} y1={base} y2={base} className="stroke-stroke-soft-200" strokeWidth={1} shapeRendering="crispEdges" />}
          <path d={line} fill="none" className="stroke-information-base" strokeWidth={LINE_W} strokeLinejoin="round" strokeLinecap="round" />
          {points.length > 0 && <circle cx={dotX} cy={dotY} r={DOT_R} className="fill-information-base" />}
        </svg>
      )}
    </div>
  );
}

/** An empty chart (owner-approved): a faint wave and a pill that says why.
 *  84 px, a sparkline's height; `tall` takes a big chart's room instead, and
 *  `fill` whatever room its column gives it. */
export function NoDataGhost({ label, tall, fill }: { label: ReactNode; tall?: boolean; fill?: boolean }) {
  return (
    <div data-no-data className={cn("relative grid place-items-center", tall ? "min-h-[140px] flex-1" : fill ? "min-h-[84px] flex-1" : "h-[84px]")}>
      <svg aria-hidden viewBox="0 0 200 84" preserveAspectRatio="none" className="absolute inset-0 size-full">
        <path d="M0 50 C 30 40, 50 60, 80 46 S 130 30, 160 52 S 190 44, 200 40" fill="none" vectorEffect="non-scaling-stroke" className="stroke-stroke-soft-200" strokeWidth={1.5} />
      </svg>
      <span className="relative rounded-full border border-stroke-soft-200 bg-bg-white-0 px-[10px] py-[2px] text-secondary text-text-soft-400">{label}</span>
    </div>
  );
}
