import { forwardRef, useId } from 'react'
import { cn } from '@/lib/cn'
import Label from '@/components/Label'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string
  hint?: string
  error?: string
  /** Show a character counter (requires `maxLength`). */
  showCount?: boolean
  wrapperClassName?: string
  /** User agents, JSON, launch arguments, proxy lists: no spellcheck,
   *  autocorrect, capitalization or page translation (WIG-03). */
  technical?: boolean
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    hint,
    error,
    showCount,
    className,
    wrapperClassName,
    disabled,
    id,
    maxLength,
    value,
    defaultValue,
    technical = false,
    autoComplete = 'off',
    'aria-describedby': describedBy,
    ...rest
  },
  ref,
) {
  const autoId = useId()
  const msgId = useId()
  const areaId = id ?? autoId
  const hasError = Boolean(error)
  const length = typeof value === 'string' ? value.length : typeof defaultValue === 'string' ? defaultValue.length : 0

  return (
    <div className={cn('flex w-full flex-col gap-[3px]', wrapperClassName)}>
      {label && (
        <Label htmlFor={areaId}>{label}</Label>
      )}
      <div
        className={cn(
          // 91 px at rest (10 + 71 + 10): its height before the 4 px grid
          // (O1), rounded down, with the xsmall field's 10 px side padding.
          // Borderless (owner, 2026-10-01): as the Input's field.
          'rounded-control control-fill p-[10px] forced-edge',
          !hasError && 'contrast-more:ring-1 contrast-more:ring-inset contrast-more:ring-stroke-sub-300',
          // Always, disabled too: it also hides the text box's
          // outline-hidden, which forced colors paint (see Input).
          'focus-ring-within',
          hasError && 'ring-1 ring-inset ring-error-base [--focus-color:var(--error-base)]',
          disabled && 'pointer-events-none',
          className,
        )}
      >
        {/* Block: an inline textarea sits on the line box and adds a 5 px
            descender gap under it (the frame measured 96, not 91). */}
        <textarea
          ref={ref}
          id={areaId}
          disabled={disabled}
          maxLength={maxLength}
          value={value}
          defaultValue={defaultValue}
          aria-invalid={hasError || undefined}
          autoComplete={autoComplete}
          aria-describedby={[describedBy, hint || error ? msgId : null].filter(Boolean).join(' ') || undefined}
          {...(technical ? { spellCheck: false, autoCorrect: 'off', autoCapitalize: 'off', translate: 'no' as const } : {})}
          className="block min-h-[71px] w-full resize-y bg-transparent text-body text-text-strong-950 outline-hidden placeholder:text-text-soft-400 disabled:cursor-not-allowed disabled:text-text-disabled-300"
          {...rest}
        />
        {showCount && maxLength != null && (
          <div className="mt-[4px] text-right text-secondary tabular-nums text-text-soft-400">
            {length}/{maxLength}
          </div>
        )}
      </div>
      {(hint || error) && (
        <p id={msgId} className={cn('text-secondary', hasError ? 'text-error-text' : 'text-text-sub-600')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
})

export default Textarea
