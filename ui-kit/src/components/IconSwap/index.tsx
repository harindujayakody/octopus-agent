import { cn } from '@/lib/cn'

export type IconSwapProps = {
  /** Which icon shows: `onIcon` when true, `offIcon` when false. */
  on: boolean
  onIcon: React.ReactNode
  offIcon: React.ReactNode
  className?: string
}

/** Two icons in the same place; a state change cross-fades between them
 *  instead of cutting (FEEL-19). Decorative: the button's label says the state. */
export default function IconSwap({ on, onIcon, offIcon, className }: IconSwapProps) {
  return (
    <span aria-hidden="true" className={cn('inline-grid place-items-center', className)}>
      <span className="icon-swap flex" data-on={on ? '' : undefined}>{onIcon}</span>
      <span className="icon-swap flex" data-on={on ? undefined : ''}>{offIcon}</span>
    </span>
  )
}
