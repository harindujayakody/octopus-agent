import { useLayoutEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/cn'
import { useVirtualList } from '@/lib/virtual'
import type { ListNavigation } from '@/lib/list/useListNavigation'
import { swallowFollowUpClick } from '@/lib/overlay/clickGuard'
import { layoutRect } from '@/lib/overlay/zoom'
import { CheckIcon, MinusIcon, PlusIcon } from '@/lib/icons'
import Badge, { type BadgeColor } from '@/components/Badge'

/** A fact about an option that must never be cut ("Not encrypted"): a badge
 *  at the row's end, and at the field's end once picked. The label truncates
 *  before it does (controller ruling, Pair 35). */
export type OptionBadge = { label: string; color?: BadgeColor }

/** The badge's text on a highlighted or pressed row: the row's fill lies under
 *  its tint, so the text steps up (check:contrast measures it on those rows). */
const ON_HIGHLIGHT: Record<BadgeColor, string> = {
  success: 'group-data-highlighted:text-success-text-on-highlight',
  error: 'group-data-highlighted:text-error-text-on-highlight',
  warning: 'group-data-highlighted:text-warning-text-on-highlight',
  information: 'group-data-highlighted:text-information-text-on-highlight',
  primary: 'group-data-highlighted:text-primary-text-on-highlight',
  gray: 'group-data-highlighted:text-text-strong-950',
}

/** The badge as an option row and a picked field draw it. */
export function OptionBadgeMark({ badge, className }: { badge: OptionBadge; className?: string }) {
  const color = badge.color ?? 'gray'
  return <Badge size="small" color={color} className={cn('shrink-0', ON_HIGHLIGHT[color], className)}>{badge.label}</Badge>
}

export type ListOption = {
  id: string
  value: string
  label: string
  hint?: string
  /** Never truncates (a security fact). */
  badge?: OptionBadge
  icon?: React.ReactNode
  /** Renders in place of the icon and label (a Select's tinted chip); the
   *  label still names the option for search. */
  content?: React.ReactNode
  disabled?: boolean
  keywords?: string[]
  /** The "Create …" row. */
  create?: boolean
}

/** A menu item's height, so a picker's rows match the menus beside it (and
 *  never grow past the Select options they replace). */
const ROW = 30
/** Longer lists render only the rows in view (PERF-15). */
const WINDOW_FROM = 100
/** The list's padding above its first row (`p-[4px]`), which the windowing counts. */
const PAD = 4
/** Rows rendered past each edge of the view: at least the navigation's page
 *  size (10), so PageDown and PageUp land on rows already in the DOM. The
 *  range follows the scroller one render later, and with fewer, the row
 *  before the new highlight could paint blank for a frame (Pair 20 review). */
const OVERSCAN = 10

/** The listbox under a Combobox's field (and, from Task 18, a Select's list):
 *  one row per option, the highlight `useListNavigation` moves, and windowing
 *  above 100 options. */
export default function OptionList({
  id, rows, nav, label, labelledBy, multiple = false, isChecked, isMixed, mixedLabel, maxHeight, scrollTo, selection, reserveIcon: reserve,
}: {
  id: string
  rows: ListOption[]
  nav: ListNavigation<ListOption>
  label?: string
  labelledBy?: string
  multiple?: boolean
  isChecked: (row: ListOption) => boolean
  isMixed?: (row: ListOption) => boolean
  mixedLabel?: string
  maxHeight: number
  /** Filled with the list's own scroll-to-index, for the navigation's
   *  `scrollToIndex`: it reaches rows a windowed list has not rendered, and
   *  it scrolls only the list, never a dialog body or the page around it. */
  scrollTo: React.MutableRefObject<((index: number) => void) | null>
  /** 'active': a single choice (the highlight is selected, APG); 'checked': a multiple one. */
  selection: 'active' | 'checked'
  /** Whether rows without an icon keep its slot. Default: when any row shown
   *  has an icon; a list that filters its rows passes it for all of them, so
   *  the labels do not move while the query changes. */
  reserveIcon?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // One option with an icon gives every row an icon slot, empty where it has
  // none, so the labels line up (a proxy with a flag, one without, No proxy).
  const shownIcon = useMemo(() => rows.some((r) => !!r.icon && !r.content), [rows])
  const reserveIcon = reserve ?? shownIcon
  const windowed = rows.length > WINDOW_FROM
  const { range, totalHeight, offsetOf, scrollToIndex } = useVirtualList({
    count: windowed ? rows.length : 0, rowHeight: ROW, overscan: OVERSCAN, scrollRef, headerHeight: PAD,
  })
  // A short list moves only its own scroller (scrollIntoView moves them all), in
  // layout px as scrollTop is: client px under a 90% Interface size fell short.
  const reveal = (index: number) => {
    const el = scrollRef.current
    const row = rows[index] && document.getElementById(nav.optionId(rows[index].id))
    if (!el || !row) return
    const r = layoutRect(row)
    const box = layoutRect(el)
    if (r.top < box.top + PAD) el.scrollTop -= box.top + PAD - r.top
    else if (r.bottom > box.bottom - PAD) el.scrollTop += r.bottom - (box.bottom - PAD)
  }
  scrollTo.current = windowed ? scrollToIndex : reveal

  // Opening shows the highlighted row (the current value) in view, before the first paint.
  useLayoutEffect(() => {
    if (nav.activeIndex >= 0) scrollTo.current?.(nav.activeIndex)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the list mounts
  }, [])

  const renderRow = (row: ListOption, i: number, style?: React.CSSProperties) => {
    const checked = isChecked(row)
    const mixed = !checked && (isMixed?.(row) ?? false)
    const option = nav.getOptionProps(row, i)
    return (
      <div
        key={row.id}
        {...option}
        // A pick that closes the surface or reshapes the list (a single
        // choice, a create): the second click of a double click reaches
        // nothing (EMIL-01). A multiple choice stays, as a checkbox does.
        onClick={(e) => {
          if (e.detail > 0 && !row.disabled && (!multiple || row.create)) swallowFollowUpClick(e)
          option.onClick(e)
        }}
        aria-selected={selection === 'active' ? i === nav.activeIndex : checked}
        aria-setsize={windowed ? rows.length : undefined}
        aria-posinset={windowed ? i + 1 : undefined}
        style={style}
        className={cn(
          // The one highlight (keys and pointer move it): the list-item fill,
          // and the system's Highlight in forced colors.
          'group flex h-[30px] select-none items-center gap-[7px] rounded-control px-[8px] text-body',
          // Active equals hover (owner, 2026-10-01); pressed one step darker.
          'data-highlighted:bg-bg-hover active:bg-bg-active data-highlighted:forced-selected',
          row.disabled ? 'text-text-disabled-300' : row.create ? 'text-primary-text' : 'text-text-strong-950',
        )}
      >
        {multiple && (
          <span
            aria-hidden="true"
            className={cn(
              // The kit Checkbox's box: 17 px, the chip radius, a 12 px mark.
              'flex size-[17px] shrink-0 items-center justify-center rounded-chip',
              row.create
                ? 'text-primary-text'
                : checked || mixed
                  ? 'bg-primary-base text-static-white forced-edge'
                  : 'bg-bg-white-0 ring-1 ring-inset ring-stroke-control forced-edge',
            )}
          >
            {row.create ? <PlusIcon className="size-3.5" /> : checked ? <CheckIcon className="size-3" /> : mixed ? <MinusIcon className="size-3" /> : null}
          </span>
        )}
        {!multiple && row.create && (
          <span className="flex size-3.5 [&>svg]:size-3.5 shrink-0 items-center justify-center"><PlusIcon /></span>
        )}
        {row.content ? (
          <span className="min-w-0 flex-1 truncate">{row.content}</span>
        ) : (
          <>
            {row.icon ? (
              <span className="flex size-3.5 [&>svg]:size-3.5 shrink-0 items-center justify-center">{row.icon}</span>
            ) : (
              reserveIcon && !row.create && <span aria-hidden="true" className="size-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
          </>
        )}
        {mixed && <span className="shrink-0 text-secondary text-text-soft-400 group-data-highlighted:text-text-sub-600">{mixedLabel}</span>}
        {row.hint && <span className="min-w-0 max-w-[55%] shrink truncate text-mono text-text-soft-400 group-data-highlighted:text-text-sub-600">{row.hint}</span>}
        {row.badge && <OptionBadgeMark badge={row.badge} />}
        {!multiple && checked && <CheckIcon className="size-3.5 shrink-0 text-primary-text" />}
      </div>
    )
  }

  // Windowed: the rows in view, plus the highlighted one wherever it is, so
  // `aria-activedescendant` always names an element in the DOM (a wheel
  // scroll can leave the highlight far behind).
  const windowRows = () => {
    const shown: number[] = []
    for (let i = range.start; i < range.end; i++) shown.push(i)
    const a = nav.activeIndex
    if (a >= 0 && (a < range.start || a >= range.end)) shown.push(a)
    return shown.map((i) => renderRow(rows[i], i, { position: 'absolute', top: offsetOf(i), left: 0, right: 0 }))
  }

  return (
    <div
      ref={scrollRef}
      id={id}
      role="listbox"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-multiselectable={multiple || undefined}
      className="scrollbar overflow-y-auto overscroll-contain p-[4px]"
      style={{ maxHeight }}
    >
      {windowed ? (
        <div style={{ position: 'relative', height: totalHeight }}>{windowRows()}</div>
      ) : (
        rows.map((row, i) => renderRow(row, i))
      )}
    </div>
  )
}
