import { forwardRef } from 'react'
import { cn } from '@/lib/cn'
import Tooltip from '@/components/Tooltip'

export type NavItemProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: React.ReactNode
  label: string
  /** The page this item opens is the current one. */
  active?: boolean
  /** A count or status shown at the end of the row. */
  badge?: React.ReactNode
  /** Spoken instead of the badge ("2 running, 8 profiles"): digits alone run
   *  into the label ("All Profiles28", A11Y-09). */
  badgeLabel?: string
  /** Icon only, label in a tooltip (compact sidebar). */
  collapsed?: boolean
  /** A key that opens the same thing, shown in the collapsed item's tooltip
   *  ("⌘K"). The tooltip declares it (`aria-keyshortcuts`) unless the caller
   *  already does. */
  shortcut?: string
  /** Highlight while something is dragged over it. */
  dropActive?: boolean
  /** medium: 32 px; small: 28 px, the launcher's dense sidebar. */
  size?: 'medium' | 'small'
}

/** One row of a sidebar: icon, label and an optional badge. */
const NavItem = forwardRef<HTMLButtonElement, NavItemProps>(function NavItem(
  { icon, label, active = false, badge, badgeLabel, collapsed = false, shortcut, dropActive = false, size = 'medium', className, type = 'button', ...rest },
  ref,
) {
  const item = (
    <button
      ref={ref}
      type={type}
      aria-current={active ? 'page' : undefined}
      // The badge's words join the label with a space: text in two spans
      // runs together in the name ("All Profiles28", A11Y-09).
      aria-label={collapsed ? label : badgeLabel ? `${label} ${badgeLabel}` : undefined}
      data-drop-active={dropActive || undefined}
      className={cn(
        // Children ignore the pointer so dragging across them never fires dragleave on the row.
        // Pointer cursor is the kit's own base rule now (owner feedback 5v): a real `<button>`.
        // 8 px in and an 8 px gap: 8.75 before the 4 px grid, floored (owner:
        // nothing larger than before), so the icon lines up with the launcher's
        // sidebar mark and group labels again.
        'relative flex w-full shrink-0 items-center gap-[8px] rounded-control px-[8px] text-left text-ui focus-ring aria-[current=page]:forced-selected [&>*]:pointer-events-none',
        size === 'small' ? 'h-7' : 'h-8',
        collapsed && 'justify-center px-0',
        // O3, LQ-04: the current page is neutral; navigation recedes once the
        // user has arrived, and the accent means "act here" (a drop target).
        // Active equals hover (owner, 2026-10-01): the current item is the
        // hover gray; pressed, it is one step darker at once, and it settles
        // back to the hover gray on release.
        // One look at a time: cn() does not merge, so two fills would resolve
        // by stylesheet order.
        dropActive
          ? 'bg-primary-tint text-primary-text outline-1 outline-dashed outline-primary-base'
          : active
            ? 'bg-bg-hover text-text-strong-950 not-aria-disabled:active:bg-bg-active active:transition-none'
            : 'bg-transparent text-text-sub-600 hover:bg-bg-hover hover:text-text-strong-950 not-aria-disabled:active:bg-bg-active active:transition-none',
        className,
      )}
      {...rest}
    >
      <span className={cn('flex size-3.5 [&>svg]:size-3.5 shrink-0 items-center justify-center', dropActive ? 'text-primary-text' : active ? 'text-icon-strong-950' : 'text-icon-soft-400')}>
        {icon}
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && badge != null && (
        // The current item's count is sub, not soft: it was set when the
        // current fill was the active gray over the canvas (soft 4.30:1), and
        // it stays (scripts/check-contrast.mjs leaves that pair out).
        <span aria-hidden={badgeLabel ? true : undefined} className={cn('flex shrink-0 items-center gap-[6px] text-micro tabular-nums', active ? 'text-text-sub-600' : 'text-text-soft-400')}>{badge}</span>
      )}
    </button>
  )
  return <Tooltip content={label} shortcut={shortcut} side="right" disabled={!collapsed}>{item}</Tooltip>
})

export default NavItem
