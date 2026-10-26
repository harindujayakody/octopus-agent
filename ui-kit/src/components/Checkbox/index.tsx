import { forwardRef, useEffect, useId, useRef } from 'react'
import { cn } from '@/lib/cn'
import { CheckIcon, MinusIcon } from '@/lib/icons'

export type CheckboxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'size'
> & {
  label?: React.ReactNode
  /** Renders the indeterminate (dash) state. */
  indeterminate?: boolean
  /** The new state after a change, like Switch's (EMIL-21). */
  onCheckedChange?: (checked: boolean) => void
  wrapperClassName?: string
  /** The 29 px target around the box (FEEL-23). `false` where the whole row
   *  is already the label (a picker list): there it adds nothing and, in
   *  rows shorter than 29 px, would reach into the row above. */
  hitArea?: boolean
}

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, indeterminate = false, className, wrapperClassName, hitArea = true, disabled, checked, id, onChange, onCheckedChange, ...rest },
  ref,
) {
  const autoId = useId()
  const boxId = id ?? autoId
  const isOn = Boolean(checked) || indeterminate
  // The mixed state is a DOM property only, never an attribute: set it so a
  // screen reader hears "mixed" and not "not checked". A click clears it in
  // the DOM; the prop decides (PC-090), so it is set again after every
  // render and after every change.
  const inner = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate
  })
  const setRef = (el: HTMLInputElement | null) => {
    inner.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  return (
    <label
      htmlFor={boxId}
      className={cn(
        // `align-top`: an inline-flex element still sits on the text
        // baseline and gets a line-box descender under it, which pushes it
        // off-center in a row/cell that centers the line box (owner
        // feedback: checkboxes sat ~2.5px above the row's middle). Pointer
        // cursor is the kit's own base rule now (owner feedback 5v): a
        // `label[for]` around an `input[type=checkbox]`. `disabled` stays:
        // the base rule only knows the *input's* disabled state, never a
        // plain label's.
        // 17 px box, 12 px tick, 7 px gap: never larger than before the 4 px
        // grid (17.5, 12.25, 7; owner). The tick is a control mark, not an
        // icon: it scales with the box.
        'inline-flex items-center gap-[7px] align-top',
        disabled && 'cursor-not-allowed opacity-60',
        wrapperClassName,
      )}
    >
      {/* FEEL-23: a 29 px target (the ::before, 6 px out each side) in the
          list's 28 px select column and its 10 px gap. The input is
          positioned so it paints over the ::before and keeps its hover. */}
      <span
        className={cn(
          'relative flex size-[17px] items-center justify-center',
          hitArea && "before:absolute before:-inset-[6px] before:content-['']",
        )}
      >
        <input
          ref={setRef}
          id={boxId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => {
            onChange?.(e)
            onCheckedChange?.(e.currentTarget.checked)
            e.currentTarget.indeterminate = indeterminate
          }}
          className={cn(
            'peer relative size-[17px] shrink-0 appearance-none rounded-chip bg-bg-white-0 ring-1 ring-inset ring-stroke-control forced-native',
            'hover:ring-stroke-strong-950 checked:bg-primary-base checked:ring-0 checked:hover:bg-primary-darker',
            indeterminate && 'bg-primary-base ring-0 hover:bg-primary-darker',
            'focus-ring',
            className,
          )}
          {...rest}
        />
        <span
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center text-static-white forced-hidden',
            isOn ? 'opacity-100' : 'opacity-0',
          )}
        >
          {indeterminate ? <MinusIcon className="size-3" /> : <CheckIcon className="size-3" />}
        </span>
      </span>
      {label && <span className="text-body text-text-strong-950">{label}</span>}
    </label>
  )
})

export default Checkbox
