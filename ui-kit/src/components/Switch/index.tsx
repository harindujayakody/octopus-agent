import { forwardRef, useId } from 'react'
import { cn } from '@/lib/cn'

export type SwitchProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'size' | 'onChange'
> & {
  label?: React.ReactNode
  onChange?: (checked: boolean) => void
  wrapperClassName?: string
}

const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, onChange, className, wrapperClassName, disabled, id, ...rest },
  ref,
) {
  const autoId = useId()
  const switchId = id ?? autoId

  return (
    <label
      htmlFor={switchId}
      className={cn(
        // Pointer cursor is the kit's own base rule now (owner feedback
        // 5v): a `label[for]`. `disabled` stays: the base rule only knows
        // the *input's* disabled state, never a plain label's.
        // 17 x 28 with a 13 px knob and a 7 px gap: never larger than before
        // the 4 px grid (17.5 x 28, 14, 7; owner). The knob sits 2 px in.
        'inline-flex items-center gap-[7px]',
        disabled && 'cursor-not-allowed opacity-60',
        wrapperClassName,
      )}
    >
      <span className="relative inline-flex">
        <input
          ref={ref}
          id={switchId}
          type="checkbox"
          // Announced as on/off, not checked (A11Y-21).
          role="switch"
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.checked)}
          className={cn(
            // Pointer/not-allowed cursor is the kit's own base rule now
            // (owner feedback 5v): `input[type=checkbox]:not(:disabled)` /
            // `:disabled`.
            'peer h-[17px] w-7 shrink-0 appearance-none rounded-full bg-stroke-control transition-[background-color] duration-(--motion-base) ease-out forced-native',
            'checked:bg-primary-base',
            'focus-ring',
            className,
          )}
          {...rest}
        />
        <span className="pointer-events-none absolute left-[2px] top-[2px] size-[13px] rounded-full bg-static-white shadow-[var(--shadow-sm)] transition-[translate] duration-(--motion-base) ease-out reduced:transition-none peer-checked:translate-x-[11px] forced-hidden" />
      </span>
      {label && <span className="text-body text-text-strong-950">{label}</span>}
    </label>
  )
})

export default Switch
