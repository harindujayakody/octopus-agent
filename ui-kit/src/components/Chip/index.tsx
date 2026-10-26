import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

export type ChipTone = 'primary' | 'success' | 'warning' | 'neutral'

export type ChipProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  selected?: boolean
  tone?: ChipTone
  size?: 'small' | 'xsmall'
  leftIcon?: React.ReactNode
  children?: React.ReactNode
}

// Fill and text, no ring (borderless, owner 2026-10-01).
const selectedLook: Record<ChipTone, string> = {
  primary: 'bg-bg-selected text-primary-text',
  success: 'bg-success-tint text-success-text',
  warning: 'bg-warning-tint text-warning-text',
  neutral: 'bg-bg-active text-text-strong-950',
}

/** Toggle chip: filters, on/off grants, include/exclude. */
const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected = false, tone = 'primary', size = 'small', leftIcon, children, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        'inline-flex shrink-0 items-center gap-[3px] rounded-chip font-medium focus-ring transition-hover forced-edge aria-pressed:forced-selected',
        'disabled:pointer-events-none disabled:opacity-50',
        // Never larger than before the 4 px grid: side padding 7 and 5, gap 3.
        // xsmall draws at 21 px (owner) with a 24 px tall target, the ::before
        // 1.5 px out top and bottom (WCAG 2.5.8, FEEL-26).
        size === 'small'
          ? 'h-6 px-[7px] text-secondary'
          : "relative h-[21px] px-[5px] text-micro before:absolute before:inset-x-0 before:-inset-y-[1.5px] before:content-['']",
        selected ? selectedLook[tone] : 'control-fill text-text-sub-600 hover:bg-bg-active hover:text-text-strong-950',
        className,
      )}
      {...rest}
    >
      {leftIcon && <span className="flex size-3.5 [&>svg]:size-3.5 items-center justify-center">{leftIcon}</span>}
      {children}
    </button>
  )
})

export default Chip
