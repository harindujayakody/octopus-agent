import { useId, useRef } from 'react'
import { cn } from '@/lib/cn'
import { Link } from '@/lib/link'

export type TabItem = {
  label: string
  value: string
  icon?: React.ReactNode
  disabled?: boolean
  /** After the label, part of the tab's name: a state in words ("Changed", "Error"). */
  badge?: React.ReactNode
  /** Navigation tabs: a link target, used when there is no `onChange`. */
  url?: string
}

export type TabsProps = {
  items: TabItem[]
  value: string
  /** When given, the tabs are an in-page tablist with keyboard support. */
  onChange?: (value: string) => void
  /** Underline (default) or pill-style segmented tabs. */
  variant?: 'line' | 'pill'
  orientation?: 'horizontal' | 'vertical'
  className?: string
  'aria-label'?: string
  /** Prefix of the tab and panel ids; a `TabPanel` with the same `tabsId` is linked to its tab. */
  idBase?: string
}

/** The ids that link a tab to its panel. Every character but a Latin
 *  letter, a digit or a hyphen is written as its code point (`_4e2d_`), the
 *  underscore too, so two values never share an id: "存储" and "设置" differ
 *  (Pair 28 review M1). */
export function tabIds(idBase: string, value: string): { tab: string; panel: string } {
  const v = value.replace(/[^A-Za-z0-9-]/gu, (c) => `_${c.codePointAt(0)!.toString(16)}_`)
  return { tab: `${idBase}-tab-${v}`, panel: `${idBase}-panel-${v}` }
}

/** The content a tab shows: named by its tab, reachable with Tab (A11Y-08). */
export function TabPanel({ tabsId, value, className, children }: { tabsId: string; value: string; className?: string; children: React.ReactNode }) {
  const ids = tabIds(tabsId, value)
  return (
    <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} tabIndex={0} className={cn('focus-ring', className)}>
      {children}
    </div>
  )
}

// Owner (Task 14 fix round): nothing larger than before the 4 px grid. The
// pill is 28 in a 3 px track (34; was 28 in 35), the line's gaps 21 and 10.
const look = {
  pill: {
    // As the SegmentControl's track and selected segment (light flip).
    list: 'inline-flex items-center gap-[3px] rounded-control bg-[var(--control-fill,var(--bg-weak-50))] p-[3px]',
    item: 'inline-flex h-7 items-center gap-[5px] rounded-chip-sm px-[10px] text-ui disabled:opacity-50',
    on: 'bg-[var(--control-on,var(--bg-raised))] text-text-strong-950 shadow-[var(--control-on-shadow,var(--shadow-xs))]',
    off: 'text-text-sub-600 hover:text-text-strong-950',
  },
  line: {
    // No baseline (borderless, owner 2026-10-01): the selected tab's
    // underline is the line. The 1 px keeps the underline's place.
    list: 'flex items-center gap-[21px] pb-px',
    item: 'relative inline-flex items-center gap-[5px] py-[10px] text-ui disabled:opacity-50',
    on: 'text-text-strong-950',
    off: 'text-text-sub-600 hover:text-text-strong-950',
  },
}

const vertical = {
  list: 'flex flex-col items-stretch gap-px',
  // 8 px sides, as menu items.
  item: 'inline-flex items-center gap-[5px] rounded-control px-[8px] py-[5px] text-left text-ui disabled:opacity-50',
  // The Settings sub-navigation is navigation too: the current tab is neutral (O3).
  // Active equals hover (owner, 2026-10-01); pressed one step darker, at once.
  on: 'bg-bg-hover text-text-strong-950 active:bg-bg-active active:transition-none',
  off: 'text-text-sub-600 hover:bg-bg-hover hover:text-text-strong-950 active:bg-bg-active active:transition-none',
}

export default function Tabs({ items, value, onChange, variant = 'line', orientation = 'horizontal', className, idBase, ...aria }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const auto = useId()
  const base = idBase ?? `tabs${auto.replace(/[^\w-]/g, '')}`
  const s = orientation === 'vertical' ? vertical : look[variant]
  const enabled = items.filter((i) => !i.disabled)
  // One tab always takes Tab, even when the value is unknown or disabled (PC-001).
  const current = enabled.some((i) => i.value === value) ? value : enabled[0]?.value

  if (!onChange) {
    return (
      <div className={cn(s.list, className)}>
        {items.map((item) => {
          const active = item.value === value
          return (
            <Link key={item.value} href={item.url ?? '#'} className={cn(s.item, 'focus-ring', active ? s.on : s.off)}>
              {item.icon && <span className="flex size-3.5 [&>svg]:size-3.5 items-center justify-center">{item.icon}</span>}
              {item.label}
              {item.badge != null && ' '}
              {item.badge}
              {variant === 'line' && orientation === 'horizontal' && active && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary-base" />
              )}
            </Link>
          )
        })}
      </div>
    )
  }

  const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  const prev = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Every tab disabled: nothing to move to, and no modulo by zero.
    if (enabled.length === 0) return
    const at = Math.max(0, enabled.findIndex((i) => i.value === current))
    let to = -1
    if (e.key === next) to = (at + 1) % enabled.length
    else if (e.key === prev) to = (at - 1 + enabled.length) % enabled.length
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = enabled.length - 1
    if (to < 0) return
    e.preventDefault()
    onChange(enabled[to].value)
    ;[...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-value]') ?? [])]
      .find((el) => el.dataset.value === enabled[to].value)
      ?.focus()
  }

  return (
    <div ref={listRef} role="tablist" aria-orientation={orientation} aria-label={aria['aria-label']} onKeyDown={onKeyDown} className={cn(s.list, className)}>
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={tabIds(base, item.value).tab}
            // The selected tab alone (the other panels are not in the page),
            // and only for a caller that links panels by `idBase`: without a
            // TabPanel it would point at nothing (Pair 28 review I1).
            aria-controls={active && idBase ? tabIds(idBase, item.value).panel : undefined}
            data-value={item.value}
            aria-selected={active}
            tabIndex={item.value === current ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(s.item, 'focus-ring aria-selected:forced-selected', active ? s.on : s.off)}
          >
            {item.icon && <span className="flex size-3.5 [&>svg]:size-3.5 items-center justify-center">{item.icon}</span>}
            {item.label}
            {/* A space in the name ("Basics Changed"); a flex gap draws none. */}
            {item.badge != null && ' '}
            {item.badge}
            {variant === 'line' && orientation === 'horizontal' && active && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary-base" />
            )}
          </button>
        )
      })}
    </div>
  )
}
