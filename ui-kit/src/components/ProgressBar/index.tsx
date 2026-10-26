import { cn } from '@/lib/cn'

export type ProgressColor = 'primary' | 'success' | 'error' | 'warning' | 'gray'

export type ProgressBarProps = {
  value: number
  max?: number
  color?: ProgressColor
  /** Show the numeric percentage on the right. */
  showValue?: boolean
  className?: string
  /** Names the bar for a screen reader (A11Y-09): what is in progress. */
  'aria-label'?: string
  'aria-labelledby'?: string
}

const fillColor: Record<ProgressColor, string> = {
  primary: 'bg-primary-base',
  success: 'bg-success-base',
  error: 'bg-error-base',
  warning: 'bg-warning-base',
  gray: 'bg-stroke-control',
}

export default function ProgressBar({
  value,
  max = 100,
  color = 'primary',
  showValue = false,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))

  return (
    <div className={cn('flex items-center gap-[12px]', className)}>
      {/* The sunken track on a panel, one step up on a tile (borderless, owner 2026-10-01). */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--control-fill,var(--bg-sunken))] forced-colors:outline forced-colors:outline-1 forced-colors:outline-[CanvasText]"
        role="progressbar"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          // Forced colors paint both Canvas: the fill keeps the system's Highlight.
          className={cn('h-full w-full rounded-full transition-[translate] duration-(--motion-slow) ease-out reduced:transition-none forced-colors:forced-color-adjust-none forced-colors:bg-[Highlight]', fillColor[color])}
          style={{ translate: `${pct - 100}% 0` }}
        />
      </div>
      {showValue && (
        <span className="min-w-9 shrink-0 text-right text-ui tabular-nums text-text-sub-600">
          {Math.round(pct)}%
        </span>
      )}
    </div>
  )
}
