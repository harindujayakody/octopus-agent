import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

export type RovingOptions = {
  /** The items: elements inside the container that match. */
  selector: string
  /** "grid": Left and Right move by one, Up and Down by a row of the layout. */
  orientation?: 'vertical' | 'horizontal' | 'grid'
  /** A typed letter moves to the next item whose text starts with it. */
  typeahead?: boolean
  /** Holds the Tab stop before any item had focus (the current page); default the first. */
  initial?: (items: HTMLElement[]) => HTMLElement | undefined
}

/** An item the keys can reach now: enabled, and drawn (not hidden by `visibility`, not inert). */
function reachable(el: HTMLElement): boolean {
  return !el.hasAttribute('disabled') && !el.closest('[inert]') && getComputedStyle(el).visibility !== 'hidden'
}

/**
 * One Tab stop for a group of controls (A11Y-14): the arrows, Home and End
 * move focus among them, and the one focused last keeps `tabIndex` 0, the
 * rest -1. It sets tabindex through the DOM, so the items render as usual,
 * and it follows items that come and go. Until an item has had focus, and
 * whenever the group does not hold the keyboard while its current item
 * changes (`aria-current` moved: another page), the stop is `initial`'s.
 * An item hidden for now (shown only on hover or focus) is skipped by the
 * keys and is never a Tab stop of its own. A key another handler already
 * took (`defaultPrevented`) is left alone.
 */
export function useRovingFocus(ref: RefObject<HTMLElement | null>, options: RovingOptions): void {
  const { selector, orientation = 'vertical', typeahead = false } = options
  // `initial` is read when needed: a new function each render re-arms nothing.
  const initialRef = useRef(options.initial)
  useLayoutEffect(() => { initialRef.current = options.initial })

  useEffect(() => {
    const root = ref.current
    if (!root) return
    let current: HTMLElement | null = null
    const all = () => [...root.querySelectorAll<HTMLElement>(selector)]
    const items = () => all().filter(reachable)
    const settle = () => {
      const every = all()
      const list = every.filter(reachable)
      if (!current || !list.includes(current)) current = initialRef.current?.(list) ?? list[0] ?? null
      for (const el of every) {
        const want = el === current ? '0' : '-1'
        if (el.getAttribute('tabindex') !== want) el.setAttribute('tabindex', want)
      }
    }
    const go = (el: HTMLElement | undefined) => {
      if (!el) return
      current = el
      settle()
      el.focus()
    }
    const top = (el: HTMLElement) => el.getBoundingClientRect().top
    const byRow = (list: HTMLElement[], from: HTMLElement, dir: 1 | -1) => {
      const r = from.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const rows = list.filter((el) => (dir > 0 ? top(el) > r.top + 1 : top(el) < r.top - 1))
      if (rows.length === 0) return undefined
      const at = dir > 0 ? Math.min(...rows.map(top)) : Math.max(...rows.map(top))
      const row = rows.filter((el) => Math.abs(top(el) - at) < 1)
      return row.reduce((best, el) => {
        const b = best.getBoundingClientRect()
        const e = el.getBoundingClientRect()
        return Math.abs(e.left + e.width / 2 - cx) < Math.abs(b.left + b.width / 2 - cx) ? el : best
      })
    }
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>(selector) : null
      if (el && root.contains(el) && el !== current) {
        current = el
        settle()
      }
    }
    // An item shown only while the group has focus (a hover action) hides
    // again once the keyboard leaves: the stop must not stay on it, or Tab
    // back would pass the group by. Read after the styles have followed.
    let frame = 0
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && root.contains(e.relatedTarget)) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(settle)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return
      const list = items()
      const at = list.indexOf(e.target as HTMLElement)
      if (at < 0) return
      const n = list.length
      const next = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'
      const prev = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
      let to: HTMLElement | undefined
      if (orientation === 'grid' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) to = byRow(list, list[at], e.key === 'ArrowDown' ? 1 : -1)
      else if (e.key === next || (orientation === 'grid' && e.key === 'ArrowRight')) to = list[(at + 1) % n]
      else if (e.key === prev || (orientation === 'grid' && e.key === 'ArrowLeft')) to = list[(at - 1 + n) % n]
      else if (e.key === 'Home') to = list[0]
      else if (e.key === 'End') to = list[n - 1]
      else if (typeahead && e.key.length === 1 && e.key !== ' ' && !e.shiftKey) {
        const k = e.key.toLowerCase()
        for (let i = 1; i <= n && !to; i++) {
          const el = list[(at + i) % n]
          if ((el.textContent ?? '').trim().toLowerCase().startsWith(k)) to = el
        }
      } else return
      if (!to) return
      e.preventDefault()
      go(to)
    }
    settle()
    const watch = new MutationObserver((records) => {
      // The current item moved (another page) while the group is not in use:
      // the Tab stop follows it.
      if (records.some((r) => r.attributeName === 'aria-current') && !root.contains(document.activeElement)) current = null
      settle()
    })
    watch.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'disabled'] })
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('focusout', onFocusOut)
    root.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      watch.disconnect()
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('focusout', onFocusOut)
      root.removeEventListener('keydown', onKeyDown)
    }
  }, [ref, selector, orientation, typeahead])
}
