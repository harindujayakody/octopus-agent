import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { fill, useLabels } from '@/lib/labels'
import { useListNavigation } from '@/lib/list/useListNavigation'
import { SearchIcon } from '@/lib/icons'
import Input from '@/components/Input'
import { defaultFilter } from './filter'
import OptionList, { type ListOption } from './OptionList'

export type ComboboxOption = {
  value: string
  label: string
  /** Secondary text at the end of the row (host:port, a count). */
  hint?: string
  icon?: React.ReactNode
  /** Renders in place of the icon and label (a tinted chip); `label` still
   *  names the option and is what the filter matches. */
  content?: React.ReactNode
  disabled?: boolean
  /** Extra words the filter matches (ids, hosts). */
  keywords?: string[]
}

type Base = {
  options: ComboboxOption[]
  /** Names the search field. */
  'aria-label': string
  placeholder?: string
  /** Controlled query; uncontrolled when omitted. */
  query?: string
  onQueryChange?: (query: string) => void
  /** Default: every word of the query is in the label, hint or keywords. */
  filter?: (option: ComboboxOption, query: string) => boolean
  /** Shown as the last row while the query names nothing exactly: "Create “x”". */
  onCreate?: (query: string) => void
  createLabel?: (query: string) => string
  emptyText?: string
  maxListHeight?: number
  autoFocus?: boolean
  className?: string
}
type Single = { multiple?: false; value?: string | null; onChange: (value: string) => void }
type Multiple = { multiple: true; value: string[]; mixed?: string[]; onChange: (value: string, checked: boolean) => void }
export type ComboboxProps = Base & (Single | Multiple)

const CREATE = '\u0000create'

/**
 * A search field over a list: typing filters and highlights the first match,
 * the arrows and the pointer move one highlight, Enter picks it (EMIL-04,
 * IFACE-04). "Create …" is the explicit last row, or Cmd/Ctrl+Enter (6.2).
 * Esc clears a typed query first; the next one reaches the surface around it.
 * Inline: put it in a Popover or a dialog.
 */
export default function Combobox(props: ComboboxProps) {
  const {
    options, placeholder, query: controlled, onQueryChange, filter = defaultFilter, onCreate, createLabel,
    emptyText, maxListHeight = 264, autoFocus = true, className,
  } = props
  const labels = useLabels()
  const listId = useId()
  const scrollTo = useRef<((i: number) => void) | null>(null)
  const [own, setOwn] = useState('')
  const query = controlled ?? own
  const setQuery = (q: string) => {
    if (controlled === undefined) setOwn(q)
    onQueryChange?.(q)
  }
  const trimmed = query.trim()
  // The option the query names exactly (trimmed, any case): nothing to create.
  const exact = useMemo(
    () => (trimmed ? options.find((o) => o.label.trim().toLowerCase() === trimmed.toLowerCase()) : undefined),
    [options, trimmed],
  )

  const rows = useMemo<ListOption[]>(() => {
    const matches = trimmed ? options.filter((o) => filter(o, trimmed)) : options
    const list: ListOption[] = matches.map((o) => ({ ...o, id: o.value }))
    if (onCreate && trimmed && !exact) {
      list.push({ id: CREATE, value: CREATE, label: createLabel ? createLabel(trimmed) : fill(labels.create, { query: trimmed }), create: true })
    }
    return list
  }, [options, trimmed, exact, filter, onCreate, createLabel, labels.create])
  const open = rows.length > 0
  // The icon slot follows all the options, not the rows a query leaves: the
  // labels stay put while typing (the proxy picker: No proxy alone left).
  const reserveIcon = useMemo(() => options.some((o) => !!o.icon && !o.content), [options])

  const checked = props.multiple ? new Set(props.value) : null
  const mixed = props.multiple ? new Set(props.mixed ?? []) : null
  const pick = (row: ListOption, how: { alt: boolean; pointer: boolean }) => {
    if (row.create) { onCreate?.(trimmed); return }
    // Cmd/Ctrl+click names its row: it picks (or toggles) that option and
    // never creates; only the create row creates (Pair 25 ruling). The
    // shortcut below is the keyboard's Cmd/Ctrl+Enter.
    if (how.alt && !how.pointer && onCreate && trimmed) {
      if (!exact) { onCreate(trimmed); return }
      // Cmd/Ctrl+Enter on a name that already exists picks that option,
      // never a second one of the same name (Pair 20 ruling).
      if (exact.disabled) return
      if (!props.multiple) props.onChange(exact.value)
      else if (!checked!.has(exact.value)) props.onChange(exact.value, true)
      return
    }
    if (props.multiple) props.onChange(row.value, !checked!.has(row.value))
    else props.onChange(row.value)
  }
  const nav = useListNavigation<ListOption>({
    items: rows,
    getId: (r) => r.id,
    isDisabled: (r) => !!r.disabled,
    homeEnd: false, // Home and End move the caret in the field
    onPick: pick,
    // The current value holds the highlight only while nothing is typed:
    // typing highlights the first match, so Enter picks it and the list
    // stays at its top (EMIL-04; Pair 20 review).
    defaultActiveId: !props.multiple && props.value && !trimmed ? props.value : null,
    scrollToIndex: (i) => scrollTo.current?.(i),
  })

  // The list opens again (after "No results", or when options arrive): it
  // starts on the current value or the first match, in view (C16 `reset`).
  // It mounted with the field, so its first opening needs none.
  const wasOpen = useRef(open)
  useLayoutEffect(() => {
    if (open && !wasOpen.current) nav.reset()
    wasOpen.current = open
  })

  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      {/* 2 px in: the search icon lines up with the option rows' content (4 + 8 = 12 px). */}
      <div className="border-b border-stroke-soft-200 px-[2px]">
        <Input
          variant="bare"
          inputSize="small"
          technical
          role="combobox"
          aria-label={props['aria-label']}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && nav.activeId ? nav.optionId(nav.activeId) : undefined}
          placeholder={placeholder ?? labels.search}
          leftIcon={<SearchIcon className="size-3.5" />}
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => { setQuery(e.target.value); nav.setActiveId(null) }}
          onKeyDown={(e) => {
            const composing = e.nativeEvent.isComposing || e.keyCode === 229
            // Esc clears what was typed first; the surface around it hears the next one.
            if (e.key === 'Escape' && query && !composing) {
              e.preventDefault()
              e.stopPropagation()
              setQuery('')
              nav.setActiveId(null)
              return
            }
            if (nav.onKeyDown(e)) return
            // Nothing to pick (no row, or none enabled): Enter does nothing,
            // and never submits a form around the field (Pair 19 review).
            if (e.key === 'Enter' && !composing) e.preventDefault()
          }}
        />
      </div>
      {open && (
        <OptionList
          id={listId}
          rows={rows}
          nav={nav}
          label={props['aria-label']}
          multiple={props.multiple}
          isChecked={(r) => (props.multiple ? checked!.has(r.value) : r.value === props.value)}
          isMixed={(r) => mixed?.has(r.value) ?? false}
          mixedLabel={labels.mixed}
          maxHeight={maxListHeight}
          reserveIcon={reserveIcon}
          scrollTo={scrollTo}
          selection={props.multiple ? 'checked' : 'active'}
        />
      )}
      {/* A live region outside the listbox (A11Y-05), there from the start
          so its words are announced when the list empties. */}
      <div role="status">
        {!open && <p className="m-0 px-[8px] py-[14px] text-center text-balance text-body text-text-soft-400">{emptyText ?? labels.noResults}</p>}
      </div>
    </div>
  )
}
