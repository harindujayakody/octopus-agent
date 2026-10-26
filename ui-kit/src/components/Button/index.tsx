import { forwardRef } from 'react'
import { cn } from '@/lib/cn'
import { SpinnerIcon } from '@/lib/icons'

export type ButtonVariant = 'primary' | 'neutral' | 'error'
export type ButtonMode = 'filled' | 'stroke' | 'lighter' | 'ghost' | 'link'
export type ButtonSize = 'medium' | 'small' | 'xsmall' | '2xsmall' | '3xsmall'

export type ButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> & {
  variant?: ButtonVariant
  mode?: ButtonMode
  size?: ButtonSize
  fullRadius?: boolean
  onlyIcon?: boolean
  isLoading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  /** 'start' puts the label on the left and pushes `rightIcon` to the edge (select-like triggers). */
  contentAlign?: 'center' | 'start'
  /** No press scale: dense rows and select-like triggers (spec: list motion is 0). */
  static?: boolean
  children?: React.ReactNode
}

// Owner (Task 14 fix round): nothing larger than before the 4 px grid, whole
// pixels. xsmall 30 (was 31.5) and small 34 (the old medium, 35) keep 20 px
// text and 14 px icons on whole pixels; gaps 3 (were 3.5).
const sizes: Record<ButtonSize, { base: string; radius: string; onlyIcon: string }> = {
  medium: { base: 'h-10 gap-[3px] px-[10px]', radius: 'rounded-control', onlyIcon: 'w-10 px-0' },
  small: { base: 'h-[34px] gap-[3px] px-[8px]', radius: 'rounded-control', onlyIcon: 'w-[34px] px-0' },
  xsmall: { base: 'h-[30px] gap-[3px] px-[6px]', radius: 'rounded-control', onlyIcon: 'w-[30px] px-0' },
  '2xsmall': { base: 'h-[24px] gap-[3px] px-[3px]', radius: 'rounded-control', onlyIcon: 'w-[24px] px-0' },
  // 24 px: the smallest target WCAG 2.5.8 accepts without a spacing exception (ruling 16).
  '3xsmall': { base: 'h-6 gap-[2px] px-[3px]', radius: 'rounded-control', onlyIcon: 'w-6 px-0' },
}

// A disabled or busy button (`aria-disabled`) does not answer the pointer:
// each hover class has an `aria-disabled:hover:` twin that puts the rest look
// back (Pair 4 carry-in: the 50% button showed a 50% hover fill). The twin
// wins on specificity (0,3,0 over hover's 0,2,0) and leaves every enabled
// state, the open fill included, exactly as it was. Change a rest color here
// together with its twin.
const looks: Record<ButtonMode, Record<ButtonVariant, string>> = {
  filled: {
    primary: 'bg-primary-base text-static-white hover:bg-primary-darker aria-disabled:hover:bg-primary-base forced-edge',
    neutral: 'bg-[var(--btn-neutral-bg)] text-[var(--btn-neutral-fg)] hover:bg-[var(--btn-neutral-bg-hover)] aria-disabled:hover:bg-[var(--btn-neutral-bg)] forced-edge',
    // COLOR-05: the danger fill keeps a 5.07:1 white label (the old base was 3.66:1 in dark).
    error: 'bg-error-fill text-static-white hover:bg-error-fill-hover aria-disabled:hover:bg-error-fill forced-edge',
  },
  stroke: {
    // An open trigger (Filters or Display with a filter on) steps past its hover tint, as neutral steps past its hover fill.
    primary: 'bg-bg-white-0 text-primary-text ring-1 ring-inset ring-primary-base hover:bg-primary-tint aria-disabled:hover:bg-bg-white-0 forced-edge aria-expanded:bg-primary-tint-hover aria-pressed:bg-primary-tint-hover',
    // The secondary button. UI-21: no shadow (depth on a flat control).
    // Borderless (owner, 2026-10-01): no ring, the weak fill at rest (one
    // step up on a tile, `control-fill`), the active fill on hover; its 1 px
    // edge comes back under Increase contrast.
    neutral: 'bg-[var(--control-fill,var(--bg-weak-50))] text-text-sub-600 hover:bg-bg-active aria-disabled:hover:bg-[var(--control-fill,var(--bg-weak-50))] forced-edge aria-expanded:bg-bg-active aria-pressed:bg-bg-active not-aria-disabled:active:bg-bg-active contrast-more:ring-1 contrast-more:ring-inset contrast-more:ring-stroke-sub-300',
    error: 'bg-bg-white-0 text-error-text ring-1 ring-inset ring-error-base hover:bg-error-tint aria-disabled:hover:bg-bg-white-0 forced-edge',
  },
  lighter: {
    primary: 'bg-primary-tint text-primary-text hover:bg-primary-tint-hover aria-disabled:hover:bg-primary-tint aria-expanded:bg-primary-tint-hover aria-pressed:bg-primary-tint-hover forced-edge',
    // The resting fill is the 4% weak fill, so its hover steps to the 8% active fill.
    neutral: 'bg-bg-weak-50 text-text-sub-600 hover:bg-bg-active aria-disabled:hover:bg-bg-weak-50 aria-expanded:bg-bg-active aria-pressed:bg-bg-active not-aria-disabled:active:bg-bg-active forced-edge',
    error: 'bg-error-tint text-error-text hover:bg-error-tint-hover aria-disabled:hover:bg-error-tint forced-edge',
  },
  ghost: {
    primary: 'bg-transparent text-primary-text hover:bg-primary-tint aria-disabled:hover:bg-transparent aria-expanded:bg-primary-tint-hover aria-pressed:bg-primary-tint-hover',
    // Open or toggled on is current: the hover gray (active equals hover,
    // owner 2026-10-01); pressed is one step darker.
    neutral: 'bg-transparent text-text-sub-600 hover:bg-bg-hover aria-disabled:hover:bg-transparent aria-expanded:bg-bg-hover aria-pressed:bg-bg-hover not-aria-disabled:active:bg-bg-active',
    error: 'bg-transparent text-error-text hover:bg-error-tint aria-disabled:hover:bg-transparent',
  },
  link: {
    primary: 'bg-transparent text-primary-text hover:underline aria-disabled:hover:no-underline',
    neutral: 'bg-transparent text-text-sub-600 hover:text-text-strong-950 hover:underline aria-disabled:hover:text-text-sub-600 aria-disabled:hover:no-underline',
    error: 'bg-transparent text-error-text hover:underline aria-disabled:hover:no-underline',
  },
}

// A disabled accent button shows no accent at all: the neutral disabled look
// (weak fill, soft text), not a washed accent fill. Only `disabled` does this;
// a busy button keeps its accent look. The hover twins stay so it answers no hover.
const disabledAccent: Record<ButtonMode, string> = {
  filled: 'bg-bg-weak-50 text-text-soft-400 aria-disabled:hover:bg-bg-weak-50 forced-edge',
  lighter: 'bg-bg-weak-50 text-text-soft-400 aria-disabled:hover:bg-bg-weak-50 forced-edge',
  stroke: 'bg-[var(--control-fill,var(--bg-weak-50))] text-text-soft-400 aria-disabled:hover:bg-[var(--control-fill,var(--bg-weak-50))] forced-edge',
  ghost: 'bg-transparent text-text-soft-400 aria-disabled:hover:bg-transparent',
  link: 'bg-transparent text-text-soft-400 aria-disabled:hover:no-underline',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    mode = 'filled',
    size = 'medium',
    fullRadius = false,
    onlyIcon = false,
    isLoading = false,
    leftIcon,
    rightIcon,
    contentAlign = 'center',
    static: isStatic = false,
    children,
    className,
    disabled,
    type = 'button',
    onClick,
    ...rest
  },
  ref,
) {
  const s = sizes[size]
  // Disabled and busy buttons keep their look, their place in the Tab order
  // and their tooltip; they ignore clicks and form submits (UI-16, EMIL-05,
  // A11Y-04). `aria-disabled`, not `disabled`: a disabled element loses focus
  // and takes no pointer events, so the tooltip that says why never shows.
  const inert = Boolean(disabled || isLoading)
  const spinner = <SpinnerIcon aria-hidden="true" className="size-3.5 animate-spin" />
  const iconSlot = leftIcon ?? (isLoading && onlyIcon ? spinner : null)

  return (
    <button
      ref={ref}
      type={type}
      aria-disabled={inert || undefined}
      aria-busy={isLoading || undefined}
      data-disabled={disabled ? '' : undefined}
      data-loading={isLoading ? '' : undefined}
      onClick={(e) => {
        if (inert) {
          // Also cancels a submit button's form submit (and Enter's implicit one).
          e.preventDefault()
          e.stopPropagation()
          return
        }
        onClick?.(e)
      }}
      className={cn(
        // transition-hover names what fades, the press scale included.
        'relative inline-flex shrink-0 select-none items-center text-ui focus-ring transition-hover',
        contentAlign === 'start' ? 'justify-start text-left' : 'justify-center',
        mode === 'link' ? 'h-auto gap-[3px] rounded-chip-sm px-0 underline-offset-2' : cn(s.base, fullRadius ? 'rounded-full' : s.radius),
        onlyIcon && s.onlyIcon,
        // Fix round 1 (I2) still holds: no `pointer-events-none` on a
        // disabled button, so the pointer hit-tests it and not-allowed shows.
        disabled && variant === 'primary' ? disabledAccent[mode] : looks[mode][variant],
        // Ruling 8: buttons press by `--motion-press` (1 under reduced motion).
        !isStatic && mode !== 'link' && 'not-aria-disabled:active:scale-(--motion-press)',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50 data-loading:cursor-wait',
        // The neutral disabled look carries its own softness; no extra fade on top.
        disabled && variant === 'primary' && 'data-disabled:opacity-100',
        className,
      )}
      {...rest}
    >
      {iconSlot != null && (
        <span className="flex size-3.5 [&>svg]:size-3.5 shrink-0 items-center justify-center">{isLoading ? spinner : iconSlot}</span>
      )}
      {!onlyIcon && children != null && (
        <span className={cn(mode !== 'link' && 'px-[3px]', contentAlign === 'start' && 'min-w-0 flex-1 truncate', isLoading && leftIcon == null && 'invisible')}>
          {children}
        </span>
      )}
      {rightIcon && (
        <span className={cn('flex size-3.5 [&>svg]:size-3.5 shrink-0 items-center justify-center', isLoading && leftIcon == null && 'invisible')}>{rightIcon}</span>
      )}
      {isLoading && leftIcon == null && !onlyIcon && (
        <span className="absolute inset-0 flex items-center justify-center">{spinner}</span>
      )}
    </button>
  )
})

export default Button
