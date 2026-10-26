import { forwardRef, useId } from 'react'
import { cn } from '@/lib/cn'
import { AlertCircleIcon } from '@/lib/icons'
import Label from '@/components/Label'
import { inputFrameClass, type InputSize } from './frame'

export type { InputSize }

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  label?: string
  hint?: string
  error?: string
  inputSize?: InputSize
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  /** Static text glued to the left (e.g. "https://"). */
  leftAddon?: React.ReactNode
  /** Static text glued to the right (e.g. ".com"). */
  rightAddon?: React.ReactNode
  wrapperClassName?: string
  /** A key, token or password: no autofill, spellcheck, autocorrect or
   *  capitalisation, which could change or leak it while it is shown (SEC-15). */
  secret?: boolean
  /** @deprecated Draws the same as a plain Input since Audit Phase B Task 12;
   *  kept so callers compile. It marked a field that sits inside an overlay
   *  (Popover, Menu, Select list, command palette panel, DialogModal). Every
   *  field is the control radius (8 px) now, so one 4 px inside a 12 px
   *  overlay stays concentric with its corner (owner feedback 5u: 8 + 4 =
   *  12). Its focus ring is every field's: 1 px past the frame (2 px under
   *  Increase contrast's 3 px ring), inside the inset. */
  embedded?: boolean
  /** 'bare': no frame, ring or fill (the palette's search, a Combobox's field). */
  variant?: 'field' | 'bare'
  /** 'inline': 28 px, a 1 px ring and no halo, tight padding, and the row's
   *  own type, so text edited in a row stays where it was (FEEL-29). */
  density?: 'default' | 'inline'
  /** Hosts, user agents, JSON, launch arguments, names: no spellcheck,
   *  autocorrect, capitalization or page translation (WIG-03). */
  technical?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    inputSize = 'medium',
    leftIcon,
    rightIcon,
    leftAddon,
    rightAddon,
    className,
    wrapperClassName,
    disabled,
    id,
    secret,
    embedded = false,
    variant = 'field',
    density = 'default',
    technical = false,
    autoComplete = 'off',
    'aria-describedby': describedBy,
    ...rest
  },
  ref,
) {
  const autoId = useId()
  const msgId = useId()
  const inputId = id ?? autoId
  const hasError = Boolean(error)

  return (
    <div className={cn('flex w-full flex-col gap-[3px]', wrapperClassName)}>
      {label && (
        <Label htmlFor={inputId}>{label}</Label>
      )}
      <div className={cn(inputFrameClass({ size: inputSize, error: hasError, disabled, variant, density }), className)}>
        {leftAddon && <span className="text-body text-text-soft-400">{leftAddon}</span>}
        {leftIcon && <span className="flex size-3.5 [&>svg]:size-3.5 shrink-0 items-center justify-center text-icon-soft-400">{leftIcon}</span>}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          className={cn(
            'h-full w-full min-w-0 bg-transparent text-text-strong-950 outline-hidden placeholder:text-text-soft-400 disabled:cursor-not-allowed',
            // Inline: the row's own type (a name at text-ui, a note at
            // text-secondary), so the text does not change as editing starts.
            density === 'inline' ? '[font:inherit] [letter-spacing:inherit]' : 'text-body',
          )}
          aria-invalid={hasError || undefined}
          autoComplete={autoComplete}
          aria-describedby={[describedBy, hint || error ? msgId : null].filter(Boolean).join(' ') || undefined}
          {...(technical ? { spellCheck: false, autoCorrect: 'off', autoCapitalize: 'off', translate: 'no' as const } : {})}
          // A secret is never autofilled either: autoComplete is off by
          // default above, and a caller's own value still wins.
          {...(secret ? { spellCheck: false, autoCorrect: 'off', autoCapitalize: 'off' } : {})}
          {...rest}
        />
        {rightIcon && !hasError && <span className="flex size-3.5 [&>svg]:size-3.5 shrink-0 items-center justify-center text-icon-soft-400">{rightIcon}</span>}
        {hasError && <AlertCircleIcon aria-hidden="true" className="size-3.5 shrink-0 text-error-base" />}
        {rightAddon && <span className="text-body text-text-soft-400">{rightAddon}</span>}
      </div>
      {(hint || error) && (
        <p id={msgId} className={cn('text-secondary', hasError ? 'text-error-text' : 'text-text-sub-600')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
})

export default Input
