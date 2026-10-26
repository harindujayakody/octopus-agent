import { cn } from '@/lib/cn'

export type BadgeColor = 'success' | 'error' | 'warning' | 'primary' | 'information' | 'gray'
export type BadgeVariant = 'soft' | 'stroke'
export type BadgeSize = 'small' | 'medium'
export type BadgeShape = 'chip' | 'pill'

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  color?: BadgeColor
  size?: BadgeSize
  /** A leading dot in the text color, for live states such as "running". */
  dot?: boolean
  /** Drawn before the text in a 14 px slot: a status dot, a spinner or an
   *  icon. Decoration only (hidden from assistive tech): the text says what
   *  the state is. */
  lead?: React.ReactNode
} & (
  | { shape?: 'chip'; variant?: BadgeVariant }
  /** A status pill: fully rounded, fill and text only, so always soft. */
  | { shape: 'pill'; variant?: 'soft' }
)

const soft: Record<BadgeColor, string> = {
  success: 'bg-success-tint text-success-text',
  error: 'bg-error-tint text-error-text',
  warning: 'bg-warning-tint text-warning-text',
  primary: 'bg-primary-tint text-primary-text',
  information: 'bg-information-tint text-information-text',
  gray: 'bg-bg-weak-50 text-text-sub-600',
}

const stroke: Record<BadgeColor, string> = {
  success: 'border-success-base text-success-text',
  error: 'border-error-base text-error-text',
  warning: 'border-warning-base text-warning-text',
  primary: 'border-primary-base text-primary-text',
  information: 'border-information-base text-information-text',
  gray: 'border-stroke-soft-200 text-text-sub-600',
}

// Side padding per size. A lead's 14 px slot is mostly air around a 7 px dot
// (3.5 px each side), so the lead side takes 3 px less and the dot sits about
// as far in as the text does on the other side.
const inline: Record<BadgeSize, { plain: string; lead: string }> = {
  small: { plain: 'px-[5px]', lead: 'pl-[2px] pr-[5px]' },
  medium: { plain: 'px-[7px]', lead: 'pl-[4px] pr-[7px]' },
}

/** Small status chip: proxy types, counts, connection and run state. As a
 *  pill (`shape="pill"`), the status pill of the Live layer: the same height
 *  as a row's Tag and Folder chips, fully rounded, and in forced colors a
 *  1 px system edge in place of the tint. */
export default function Badge({
  color = 'gray',
  variant = 'soft',
  size = 'medium',
  shape = 'chip',
  dot = false,
  lead,
  className,
  children,
  ...rest
}: BadgeProps) {
  const pill = shape === 'pill'
  const hasLead = lead !== undefined && lead !== null && lead !== false
  const pad = hasLead ? inline[size].lead : inline[size].plain
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-[3px] whitespace-nowrap',
        pill ? 'rounded-full' : 'rounded-chip',
        'text-center font-medium',
        size === 'small' ? cn(pad, 'py-[1px] text-micro') : cn(pad, 'py-[1px] text-secondary'),
        variant === 'stroke' && !pill ? cn('border bg-transparent', stroke[color]) : soft[color],
        pill && 'forced-edge',
        className,
      )}
      {...rest}
    >
      {dot && <span className="size-[5px] shrink-0 rounded-full bg-current" />}
      {hasLead && (
        <span aria-hidden="true" className="flex size-3.5 shrink-0 items-center justify-center">
          {lead}
        </span>
      )}
      {children}
    </span>
  )
}
