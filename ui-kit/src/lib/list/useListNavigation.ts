import { useEffect, useId, useRef, useState } from 'react'
import { pointerMoveStill } from '@/lib/overlay/modality'

export type ListNavigationOptions<T> = {
  items: readonly T[]
  getId: (item: T) => string
  isDisabled?: (item: T) => boolean
  /** The text typeahead matches (a list with no text field of its own). */
  getText?: (item: T) => string
  typeahead?: boolean
  /** Home and End move the highlight. Off in a text field, where they move the caret. */
  homeEnd?: boolean
  onPick: (item: T, how: { alt: boolean; pointer: boolean }) => void
  /** The item to highlight when none is (the current value); else the first enabled one. */
  defaultActiveId?: string | null
  loop?: boolean
  pageSize?: number
  idPrefix?: string
  /** Brings an index into view (a windowed list); default: the option element's scrollIntoView. */
  scrollToIndex?: (index: number) => void
}

export type OptionProps = {
  id: string
  role: 'option'
  'aria-disabled'?: true
  'data-highlighted'?: ''
  onPointerMove: (e: React.PointerEvent) => void
  onMouseDown: (e: React.MouseEvent) => void
  onClick: (e: React.MouseEvent) => void
}

export type ListNavigation<T> = {
  activeId: string | null
  activeIndex: number
  setActiveId: (id: string | null) => void
  move: (to: number | 'first' | 'last') => void
  /** The DOM id of an item's option, for `aria-activedescendant`. */
  optionId: (id: string) => string
  /** Handles the list keys; returns true (and prevents the default) when it used the key. */
  onKeyDown: (e: React.KeyboardEvent) => boolean
  /** A typeahead word is being typed (Space then belongs to it). */
  isTyping: () => boolean
  /** Starts afresh when the list opens: back on the default item (or the
   *  first), no typed word, and the highlight brought into view. The hook
   *  scrolls on its own when it mounts, so a list that mounts with it needs
   *  no reset; one that opens under a hook that stayed mounted (a Select
   *  trigger keeps it) calls this each time it opens. */
  reset: () => void
  getOptionProps: (item: T, index?: number) => OptionProps
}

const TYPEAHEAD_MS = 500
const safe = (s: string) => s.replace(/[^\w-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)

/**
 * One list model for the kit (EMIL-04): an active item that DOM focus never
 * leaves the field or trigger for (`aria-activedescendant`), arrows, Home,
 * End, PageUp, PageDown, typeahead, a pointer that moves the same highlight,
 * Enter and click to pick, and scroll into view for what the keys reach.
 */
export function useListNavigation<T>({
  items,
  getId,
  isDisabled,
  getText,
  typeahead = false,
  homeEnd = true,
  onPick,
  defaultActiveId = null,
  loop = true,
  pageSize = 10,
  idPrefix,
  scrollToIndex,
}: ListNavigationOptions<T>): ListNavigation<T> {
  const auto = useId()
  const prefix = idPrefix ?? `list${safe(auto)}`
  const [chosenId, setChosenId] = useState<string | null>(null)
  const typed = useRef({ text: '', at: 0 })
  // Scroll the highlight into view when the keys moved it (and on mount or
  // `reset`: the list opened); never when the pointer did.
  const scrollNext = useRef(true)
  // Bumped by `reset`, so the list scrolls even when the highlight is where it was.
  const [opening, setOpening] = useState(0)

  const ids = items.map(getId)
  const enabled = (i: number) => i >= 0 && i < items.length && !(isDisabled?.(items[i]) ?? false)
  const first = () => { for (let i = 0; i < items.length; i++) if (enabled(i)) return i; return -1 }
  const last = () => { for (let i = items.length - 1; i >= 0; i--) if (enabled(i)) return i; return -1 }
  const chosenIndex = chosenId === null ? -1 : ids.indexOf(chosenId)
  const defaultIndex = defaultActiveId === null ? -1 : ids.indexOf(defaultActiveId)
  const activeIndex = enabled(chosenIndex) ? chosenIndex : enabled(defaultIndex) ? defaultIndex : first()
  const activeId = activeIndex >= 0 ? ids[activeIndex] : null
  const optionId = (id: string) => `${prefix}-${safe(id)}`

  const step = (from: number, dir: 1 | -1, count: number): number => {
    const n = items.length
    let i = from
    let found = from
    for (let moved = 0, guard = 0; moved < count && guard < n; guard++) {
      let next = i + dir
      if (next < 0 || next >= n) {
        if (!loop || count > 1) break
        next = (next + n) % n
      }
      i = next
      if (enabled(i)) { found = i; moved++ }
    }
    return found
  }
  const go = (i: number) => {
    if (i < 0) return
    scrollNext.current = true
    setChosenId(ids[i])
  }
  const move = (to: number | 'first' | 'last') => {
    if (to === 'first') go(first())
    else if (to === 'last') go(last())
    else if (activeIndex < 0) go(to > 0 ? first() : last())
    else go(step(activeIndex, to > 0 ? 1 : -1, Math.abs(to)))
  }
  const isTyping = () => typed.current.text !== '' && Date.now() - typed.current.at <= TYPEAHEAD_MS
  const typeAhead = (key: string): boolean => {
    if (key === ' ' && !isTyping()) return false
    const now = Date.now()
    const text = now - typed.current.at > TYPEAHEAD_MS ? key : typed.current.text + key
    typed.current = { text, at: now }
    const q = text.toLowerCase()
    const repeated = [...q].every((c) => c === q[0])
    const needle = repeated ? q[0] : q
    const n = items.length
    const start = repeated || activeIndex < 0 ? activeIndex + 1 : activeIndex
    for (let k = 0; k < n; k++) {
      const i = (((start + k) % n) + n) % n
      if (enabled(i) && getText!(items[i]).toLowerCase().startsWith(needle)) { go(i); break }
    }
    return true
  }

  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    const ne = e.nativeEvent
    if (ne.isComposing || ne.keyCode === 229) return false
    let handled = true
    switch (e.key) {
      case 'ArrowDown': move(1); break
      case 'ArrowUp': move(-1); break
      case 'PageDown': move(pageSize); break
      case 'PageUp': move(-pageSize); break
      case 'Home': if (homeEnd) move('first'); else handled = false; break
      case 'End': if (homeEnd) move('last'); else handled = false; break
      case 'Enter':
        if (activeIndex < 0) { handled = false; break }
        if (!ne.repeat) onPick(items[activeIndex], { alt: e.metaKey || e.ctrlKey, pointer: false })
        break
      default:
        handled = typeahead && getText != null && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && typeAhead(e.key)
    }
    if (handled) e.preventDefault()
    return handled
  }

  useEffect(() => {
    if (!scrollNext.current || activeIndex < 0) return
    scrollNext.current = false
    if (scrollToIndex) scrollToIndex(activeIndex)
    else document.getElementById(optionId(ids[activeIndex]))?.scrollIntoView?.({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the highlight moves or the list opens
  }, [activeIndex, activeId, opening])

  const getOptionProps = (item: T, index?: number): OptionProps => {
    const id = getId(item)
    const i = index ?? ids.indexOf(id)
    const disabled = !enabled(i)
    return {
      id: optionId(id),
      role: 'option',
      'aria-disabled': disabled || undefined,
      'data-highlighted': i === activeIndex ? '' : undefined,
      // The pointer moves the one highlight the keys move (EMIL-04, EMIL-06).
      // A list the keys scrolled under a still pointer keeps the keys' highlight.
      onPointerMove: (e) => {
        if (disabled || i === activeIndex || pointerMoveStill(e)) return
        scrollNext.current = false
        setChosenId(id)
      },
      // A press keeps focus in the field or on the trigger.
      onMouseDown: (e) => e.preventDefault(),
      onClick: (e) => { if (!disabled) onPick(item, { alt: e.metaKey || e.ctrlKey, pointer: true }) },
    }
  }

  return {
    activeId,
    activeIndex,
    setActiveId: (id) => { scrollNext.current = true; setChosenId(id) },
    move,
    optionId,
    onKeyDown,
    isTyping,
    getOptionProps,
    reset: () => {
      typed.current = { text: '', at: 0 }
      scrollNext.current = true
      setChosenId(null)
      setOpening((n) => n + 1)
    },
  }
}
