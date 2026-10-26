import { useId } from 'react'
import { cn } from '@/lib/cn'
import Label from '@/components/Label'

export type SliderProps = {
  value: number
  min?: number
  max?: number
  step?: number
  onChange?: (value: number) => void
  label?: string
  /** Text shown at the right of the label row (e.g. the value). */
  valueLabel?: React.ReactNode
  disabled?: boolean
  className?: string
}

export default function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  label,
  valueLabel,
  disabled = false,
  className,
}: SliderProps) {
  const id = useId()
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className={cn('flex w-full flex-col gap-[8px]', className)}>
      {(label || valueLabel != null) && (
        <div className="flex items-center justify-between">
          {label && (
            <Label htmlFor={id}>{label}</Label>
          )}
          {valueLabel != null && <span className="text-ui tabular-nums text-text-sub-600">{valueLabel}</span>}
        </div>
      )}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(Number(e.target.value))}
        className={cn(
          // Pointer/not-allowed cursor is the kit's own base rule now
          // (owner feedback 5v): `input[type=range]:not(:disabled)` /
          // `:disabled`.
          'sx-slider h-1.5 w-full appearance-none rounded-full focus-visible:outline-hidden',
          disabled && 'opacity-60',
        )}
        style={{
          background: `linear-gradient(to right, var(--color-primary-base) 0%, var(--color-primary-base) ${pct}%, var(--bg-sunken) ${pct}%, var(--bg-sunken) 100%)`,
        }}
      />
    </div>
  )
}
