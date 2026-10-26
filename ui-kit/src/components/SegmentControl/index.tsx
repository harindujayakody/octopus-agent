import { useRef } from 'react'
import { cn } from '@/lib/cn'

export type SegmentItem = {
  label: string
  value: string
  icon?: React.ReactNode
  disabled?: boolean
  /** A count after the label, in the soft color ("Traffic 2"). */
  count?: number
}

export type SegmentControlProps = {
  items: SegmentItem[]
  value: string
  onChange?: (value: string) => void
  size?: 'medium' | 'small' | 'xsmall'
  className?: string
  'aria-label'?: string
  /** The id of a visible caption that names the group, instead of `aria-label`. */
  'aria-labelledby'?: string
  /** 'radio' (default): one choice; 'tabs' only where it switches a panel. */
  semantics?: 'radio' | 'tabs'
  /** Take the control's own width instead of the row's: for a small,
   *  exclusive set beside other controls (CRAFT-05). Default false. */
  fit?: boolean
}

export default function SegmentControl({ items, value, onChange, size = 'medium', className, semantics = 'radio', fit = false, ...aria }: SegmentControlProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const enabled = items.filter((i) => !i.disabled)
  // One item always takes Tab, even when the value is unknown or disabled (PC-001).
  const current = enabled.some((i) => i.value === value) ? value : enabled[0]?.value
  const radio = semantics === 'radio'

  // The arrows move and choose; Home and End go to the first and the last.
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Every item disabled: nothing to move to, and no modulo by zero.
    if (enabled.length === 0) return
    const at = Math.max(0, enabled.findIndex((i) => i.value === current))
    let to = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (at + 1) % enabled.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (at - 1 + enabled.length) % enabled.length
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = enabled.length - 1
    if (to < 0) return
    e.preventDefault()
    onChange?.(enabled[to].value)
    ;[...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-value]') ?? [])]
      .find((el) => el.dataset.value === enabled[to].value)
      ?.focus()
  }

  return (
    <div
      ref={listRef}
      // A single choice is a radio group; a tab list only where it switches
      // a panel (A11Y-08, EMIL-21).
      role={radio ? 'radiogroup' : 'tablist'}
      aria-label={aria['aria-label']}
      aria-labelledby={aria['aria-labelledby']}
      onKeyDown={onKeyDown}
      // Owner (Task 14 fix round): a 3 px track (3.5 before the 4 px grid),
      // so the xsmall frame is 30 and small 34 with 24 and 28 px tabs.
      // Its own width or the row's: a switch, not a merge (PC-009), so
      // `fit` cannot lose to a `w-full` in the base string. At its own width
      // no label wraps: a row too narrow for it scrolls or wraps around it.
      // The track rests as a field does (borderless, owner 2026-10-01; the
      // sunken gray before): white on the page's ground in light, the weak
      // fill on a tile or a white surface (`--control-fill`). The selected
      // segment steps the other way (`--control-on`): a gray step in a white
      // track, the raised layer in a gray one.
      className={cn('inline-flex items-center gap-[3px] rounded-control bg-[var(--control-fill,var(--bg-weak-50))] p-[3px]', fit ? 'w-fit whitespace-nowrap' : 'w-full', className)}
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            role={radio ? 'radio' : 'tab'}
            type="button"
            data-value={item.value}
            {...(radio ? { 'aria-checked': active } : { 'aria-selected': active })}
            tabIndex={item.value === current ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange?.(item.value)}
            className={cn(
              // Forced colors: the checked (or selected) one keeps a Highlight fill.
              'inline-flex flex-1 items-center justify-center gap-[5px] rounded-chip-sm text-ui focus-ring aria-checked:forced-selected aria-selected:forced-selected disabled:opacity-50',
              size === 'medium' ? 'h-8 px-[12px]' : size === 'small' ? 'h-7 px-[10px]' : 'h-6 px-[8px]',
              active ? 'bg-[var(--control-on,var(--bg-raised))] text-text-strong-950 shadow-[var(--control-on-shadow,var(--shadow-xs))]' : 'text-text-sub-600 hover:text-text-strong-950',
            )}
          >
            {item.icon && <span className="flex size-3.5 [&>svg]:size-3.5 items-center justify-center">{item.icon}</span>}
            {item.label}
            {item.count !== undefined && <span className="tabular-nums text-text-soft-400">{item.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
