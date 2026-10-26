import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { mergeRefs } from '@/lib/mergeRefs'
import { useFieldsetDisabled } from '@/lib/fieldset'
import { useLabels } from '@/lib/labels'
import { Portal } from '@/lib/overlay/Portal'
import { usePresence } from '@/lib/overlay/usePresence'
import { useDismiss } from '@/lib/overlay/useDismiss'
import { originFor, useFloatingPosition } from '@/lib/overlay/position'
import { layoutRect, layoutViewport, pageZoom } from '@/lib/overlay/zoom'
import { useListNavigation } from '@/lib/list/useListNavigation'
import { ChevronDownIcon } from '@/lib/icons'
import Combobox from '@/components/Combobox'
import OptionList, { OptionBadgeMark, type ListOption, type OptionBadge } from '@/components/Combobox/OptionList'
import { inputFrameClass } from '@/components/Input/frame'
import Label from '@/components/Label'

export type SelectOption = {
  label: string
  value: string
  icon?: React.ReactNode
  /** Renders in place of the icon and label, in the option row and in the
   *  field once picked (a tinted chip). `label` still names the option and
   *  drives search. Fix round 1 (I1). */
  content?: React.ReactNode
  disabled?: boolean
  /** Secondary text at the end (host:port), kept visible where the label truncates (TYPE-07). */
  hint?: string
  /** A fact that must never be cut ("Not encrypted"): a badge at the end of
   *  the row and of the field, which the label gives way to. */
  badge?: OptionBadge
  /** Extra words a searchable list matches. */
  keywords?: string[]
}

export type SelectProps = {
  options: SelectOption[]
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  label?: string
  hint?: string
  error?: string
  size?: 'medium' | 'small' | 'xsmall'
  disabled?: boolean
  /** A search field inside the list (a Combobox). */
  isSearchable?: boolean
  searchPlaceholder?: string
  className?: string
  /** The field's id (a caption elsewhere may point at it). */
  id?: string
  /** Names the field when there is no visible `label`. */
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  /** Shown when the search matches nothing; pass a translated string. */
  noResultsText?: string
}

/** The list's tallest, as before the rebuild. */
const LIST_MAX = 264
/** The widest a list grows past its field, to show its options whole
 *  (controller ruling, Pair 35); a wider field keeps its own width. */
const LIST_WIDE = 360
/** Between the field and its list. */
const OFFSET = 4
/** Kept clear at the window's edge (the positioning's margin). */
const EDGE = 8
/** A searchable list's search field and its hairline, above the rows. */
const SEARCH_H = 36
/** However tight the window, about three rows show. */
const LIST_MIN = 96

/**
 * One choice from a list (APG select-only combobox; A11Y-01, EMIL-07):
 * ArrowDown, ArrowUp, Enter, Space or a letter open it on the current value;
 * the arrows, Home, End, PageUp, PageDown and typeahead move the highlight
 * while focus stays on the field; Enter or Space picks; Tab and Esc close;
 * focus always comes back to the field. `isSearchable` puts a Combobox in the
 * list and moves focus into its search.
 */
export default function Select({
  options, value, onChange, placeholder, label, hint, error, size = 'medium', disabled: disabledProp = false,
  isSearchable = false, searchPlaceholder, className, id, noResultsText, ...aria
}: SelectProps) {
  const labels = useLabels()
  const auto = useId()
  const fieldId = id ?? `${auto}-field`
  const labelId = `${auto}-label`
  const listId = `${auto}-list`
  const msgId = `${auto}-msg`
  const fieldRef = useRef<HTMLDivElement>(null)
  // Off inside a disabled fieldset too, as a native <select> would be.
  const disabled = useFieldsetDisabled(fieldRef) || disabledProp
  const popupRef = useRef<HTMLDivElement>(null)
  const scrollTo = useRef<((i: number) => void) | null>(null)
  const [open, setOpen] = useState(false)
  const [exit, setExit] = useState<'animate' | 'instant'>('animate')
  const [listMax, setListMax] = useState(LIST_MAX)
  const hasError = Boolean(error)
  const selected = options.find((o) => o.value === value)
  const rows = useMemo<ListOption[]>(() => options.map((o) => ({ ...o, id: o.value })), [options])

  const presence = usePresence(open, { group: 'overlay', exit })
  const pos = useFloatingPosition(fieldRef, popupRef, { open: presence.mounted, side: 'bottom', align: 'start', offset: OFFSET })

  const close = (how: 'animate' | 'instant' = 'animate') => {
    setExit(how)
    setOpen(false)
    // Closed, the highlight rests on the value again, so a letter typed at
    // the closed field searches from it.
    nav.setActiveId(null)
    // Focus comes back to the field, wherever it was (EMIL-07).
    const at = document.activeElement
    if (!at || at === document.body || popupRef.current?.contains(at)) fieldRef.current?.focus({ preventScroll: true })
  }
  // A pointer pick's second click is already swallowed by the list (OptionList, C3).
  const choose = (v: string) => {
    onChange?.(v)
    close('instant')
  }
  useDismiss({ enabled: open, onDismiss: () => close(), refs: [fieldRef, popupRef], layer: popupRef })

  const nav = useListNavigation<ListOption>({
    items: rows,
    getId: (r) => r.id,
    isDisabled: (r) => !!r.disabled,
    getText: (r) => r.label,
    typeahead: true,
    onPick: (r) => choose(r.value),
    defaultActiveId: value ?? null,
    // Only the list's own scroller moves (never the dialog or page around it).
    scrollToIndex: (i) => { if (open) scrollTo.current?.(i) },
  })

  // As tall as the roomier side of the window allows, up to LIST_MAX: the
  // positioning then puts it on the side it fits (as the old list did).
  const fitList = () => {
    const el = fieldRef.current
    if (!el) return LIST_MAX
    const r = layoutRect(el)
    const view = layoutViewport(pageZoom())
    const room = Math.max(view.height - r.bottom, r.top) - OFFSET - EDGE - (isSearchable ? SEARCH_H : 0)
    return Math.max(LIST_MIN, Math.min(LIST_MAX, Math.floor(room)))
  }
  const openList = () => {
    if (disabled) return
    nav.reset() // on the current value, in view, no typed word (C16)
    setListMax(fitList())
    setExit('animate')
    setOpen(true)
  }

  // A searchable list takes focus into its field once it is placed (a hidden element cannot take focus).
  const placed = pos !== null
  useEffect(() => {
    if (open && isSearchable && placed) popupRef.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }, [open, isSearchable, placed])

  const onFieldKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openList()
      } else if (!isSearchable && (e.key === 'Home' || e.key === 'End')) {
        e.preventDefault()
        openList()
        nav.move(e.key === 'Home' ? 'first' : 'last')
      } else if (!isSearchable && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        openList()
        nav.onKeyDown(e)
      }
      return
    }
    if (isSearchable) return
    if (e.key === 'Tab') { close(); return } // Tab picks nothing (EMIL-07) and moves on
    if (e.key === ' ' && !nav.isTyping()) {
      e.preventDefault()
      const r = rows[nav.activeIndex]
      if (r && !r.disabled) choose(r.value)
      return
    }
    nav.onKeyDown(e)
  }

  const describedBy = [aria['aria-describedby'], hint || error ? msgId : null].filter(Boolean).join(' ') || undefined
  const name = label
    ? { 'aria-labelledby': labelId }
    : aria['aria-labelledby'] ? { 'aria-labelledby': aria['aria-labelledby'] } : { 'aria-label': aria['aria-label'] }

  return (
    <div className={cn('flex w-full flex-col gap-[3px]', className)}>
      {label && (
        // A caption, not a <label>: a <label> names only native controls.
        // A click on it focuses the field and changes nothing (WIG-01).
        <Label as="span" id={labelId} onClick={() => fieldRef.current?.focus()}>
          {label}
        </Label>
      )}
      <div
        ref={fieldRef}
        id={fieldId}
        role="combobox"
        tabIndex={disabled ? undefined : 0}
        aria-haspopup={isSearchable ? 'dialog' : 'listbox'}
        aria-expanded={open}
        aria-controls={open && !isSearchable ? listId : undefined}
        aria-activedescendant={open && !isSearchable && nav.activeId ? nav.optionId(nav.activeId) : undefined}
        aria-invalid={hasError || undefined}
        aria-disabled={disabled || undefined}
        aria-describedby={describedBy}
        {...name}
        // The base layer's pointer cursor (a div has none of its own).
        data-clickable={disabled ? undefined : ''}
        onClick={() => {
          if (disabled) return
          if (open) close()
          else openList()
        }}
        onKeyDown={onFieldKeyDown}
        className={cn(
          // The text field's frame, so it matches the fields beside it (C15),
          // with a keyboard-only focus ring: focus comes back here after a
          // pointer pick, and a ring then would stay for nothing.
          inputFrameClass({ size, error: hasError, focusSelf: true }),
          'select-none justify-between',
          // Disabled keeps its pointer events, so the not-allowed cursor shows (Fix round 1, I2).
          disabled && 'cursor-not-allowed text-text-disabled-300',
          // Open is a state, as focus is: its ring stays (borderless, owner).
          open && !hasError && 'ring-2 ring-inset ring-primary-base',
        )}
      >
        <span className={cn('flex min-w-0 flex-1 items-center gap-[7px] text-body', disabled ? 'text-text-disabled-300' : selected ? 'text-text-strong-950' : 'text-text-soft-400')}>
          {selected?.content ? (
            <span className="min-w-0 truncate">{selected.content}</span>
          ) : (
            <>
              {selected?.icon && <span className="flex size-3.5 [&>svg]:size-3.5 shrink-0 items-center justify-center">{selected.icon}</span>}
              <span className="min-w-0 truncate">{selected ? selected.label : placeholder ?? labels.select}</span>
              {selected?.hint && <span className="ml-auto min-w-0 max-w-[55%] shrink truncate text-mono text-text-soft-400">{selected.hint}</span>}
              {selected?.badge && <OptionBadgeMark badge={selected.badge} className={selected.hint ? undefined : 'ml-auto'} />}
            </>
          )}
        </span>
        {/* No rotation: the list below already says it is open (EMIL-07). */}
        <ChevronDownIcon className="size-3.5 shrink-0 text-icon-soft-400" />
      </div>

      {presence.mounted && (
        <Portal>
          <div
            {...presence.rootProps}
            ref={mergeRefs(popupRef, presence.rootProps.ref)}
            role={isSearchable ? 'dialog' : undefined}
            aria-label={isSearchable ? (label ?? aria['aria-label']) : undefined}
            onKeyDown={(e) => { if (isSearchable && e.key === 'Tab') { e.preventDefault(); close() } }}
            style={{
              left: pos?.x ?? 0,
              top: pos?.y ?? 0,
              visibility: pos ? 'visible' : 'hidden',
              // As wide as its options, from the field's width up to
              // LIST_WIDE, so a long option reads whole (controller ruling,
              // Pair 35); past that the label truncates, never a badge.
              width: 'max-content',
              minWidth: fieldRef.current?.offsetWidth,
              maxWidth: Math.max(LIST_WIDE, fieldRef.current?.offsetWidth ?? 0),
              transformOrigin: originFor(pos?.side, 'start'),
            }}
            className={cn(
              // Borderless (owner, 2026-10-01): the float shadow, no ring.
              'fixed z-(--layer-overlay) flex flex-col overflow-hidden rounded-surface bg-bg-popover shadow-(--shadow-float) forced-edge',
              // Select: 100 ms in, 75 ms out; opened from the keys it fades only.
              'transition-[opacity,scale] duration-(--motion-fast) ease-out',
              'data-starting-style:opacity-0 data-starting-style:scale-(--motion-scale-in) data-[input=keyboard]:data-starting-style:scale-100',
              'data-ending-style:opacity-0 data-ending-style:duration-(--motion-exit-fast) data-ending-style:pointer-events-none',
            )}
          >
            {isSearchable ? (
              <Combobox
                aria-label={searchPlaceholder ?? labels.search}
                placeholder={searchPlaceholder ?? labels.search}
                options={options}
                value={value ?? null}
                onChange={(v) => choose(v)}
                emptyText={noResultsText ?? labels.noResults}
                maxListHeight={listMax}
                autoFocus={false}
              />
            ) : (
              <OptionList
                id={listId}
                rows={rows}
                nav={nav}
                labelledBy={label ? labelId : aria['aria-labelledby']}
                label={label || aria['aria-labelledby'] ? undefined : aria['aria-label']}
                isChecked={(r) => r.value === value}
                maxHeight={listMax}
                scrollTo={scrollTo}
                selection="active"
              />
            )}
          </div>
        </Portal>
      )}

      {(hint || error) && (
        <p id={msgId} className={cn('m-0 text-secondary', hasError ? 'text-error-text' : 'text-text-sub-600')}>{error ?? hint}</p>
      )}
    </div>
  )
}
