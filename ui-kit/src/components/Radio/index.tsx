import { forwardRef, useId } from 'react'
import { cn } from '@/lib/cn'

export type RadioProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'size'
> & {
  label?: React.ReactNode
  wrapperClassName?: string
}

const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, className, wrapperClassName, disabled, id, ...rest },
  ref,
) {
  const autoId = useId()
  const radioId = id ?? autoId

  return (
    <label
      htmlFor={radioId}
      className={cn(
        // Pointer cursor is the kit's own base rule now (owner feedback
        // 5v): a `label[for]`. `disabled` stays: the base rule only knows
        // the *input's* disabled state, never a plain label's.
        // 17 px with a 7 px dot and a 7 px gap: never larger than before the
        // 4 px grid (17.5, 7, 7; owner).
        'inline-flex items-center gap-[7px]',
        disabled && 'cursor-not-allowed opacity-60',
        wrapperClassName,
      )}
    >
      <span className="relative flex size-[17px] items-center justify-center">
        <input
          ref={ref}
          id={radioId}
          type="radio"
          disabled={disabled}
          className={cn(
            'peer size-[17px] shrink-0 appearance-none rounded-full bg-bg-white-0 ring-1 ring-inset ring-stroke-control forced-native',
            'checked:ring-[5px] checked:ring-primary-base',
            'focus-ring',
            className,
          )}
          {...rest}
        />
        <span className="pointer-events-none absolute size-[7px] rounded-full bg-static-white opacity-0 peer-checked:opacity-100 forced-hidden" />
      </span>
      {label && <span className="text-body text-text-strong-950">{label}</span>}
    </label>
  )
})

export default Radio
