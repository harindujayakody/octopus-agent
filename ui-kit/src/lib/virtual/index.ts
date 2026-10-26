import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export type VirtualRange = { start: number; end: number }
export type TallRow = { index: number; height: number }

/** Top of row `index`; rows after the tall one move down by its extra height. */
export function rowOffset(index: number, rowHeight: number, tall?: TallRow | null): number {
  return index * rowHeight + (tall && index > tall.index ? tall.height - rowHeight : 0)
}

/** Height of all rows together. */
export function listHeight(count: number, rowHeight: number, tall?: TallRow | null): number {
  return count * rowHeight + (tall && tall.index < count ? tall.height - rowHeight : 0)
}

/** Rows that meet the viewport, plus `overscan` either side. `end` is exclusive. */
export function visibleRange({ scrollTop, viewport, count, rowHeight, overscan = 6, tall }: {
  scrollTop: number; viewport: number; count: number; rowHeight: number; overscan?: number; tall?: TallRow | null
}): VirtualRange {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0 }
  const indexAt = (y: number) => {
    if (tall) {
      const tallTop = tall.index * rowHeight
      if (y >= tallTop + tall.height) return Math.floor((y - (tall.height - rowHeight)) / rowHeight)
      if (y >= tallTop) return tall.index
    }
    return Math.floor(y / rowHeight)
  }
  const top = Math.max(0, scrollTop)
  const bottom = top + Math.max(1, viewport) - 1
  const first = Math.min(count - 1, indexAt(top))
  const last = Math.min(count - 1, indexAt(bottom))
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + 1 + overscan) }
}

/// Windowing for a list of fixed-height rows inside `scrollRef` (which must be
/// mounted with the component). `headerHeight` is the space above the first
/// row inside the scroller; `stickyHeight` is the part of it that stays pinned
/// over the rows (a sticky header), which `scrollToIndex` keeps rows clear of.
export function useVirtualList({ count, rowHeight, overscan = 6, tall = null, scrollRef, headerHeight = 0, stickyHeight = headerHeight, bottomInset = 0 }: {
  count: number; rowHeight: number; overscan?: number; tall?: TallRow | null
  scrollRef: React.RefObject<HTMLElement | null>; headerHeight?: number; stickyHeight?: number
  /** Space at the bottom of the scroller that something floats over (a bulk bar); `scrollToIndex` keeps rows clear of it. */
  bottomInset?: number
}) {
  // The scroller's latest position lives in a ref; React state follows it
  // only when the rows in view (or the viewport) change, so a scroll inside
  // one row costs the list no render (PERF-03).
  const [view, setView] = useState({ scrollTop: 0, viewport: 0 })
  const latest = useRef(view)
  const tallIndex = tall?.index ?? -1
  const tallHeight = tall?.height ?? rowHeight
  const rangeAt = useCallback(
    (v: { scrollTop: number; viewport: number }) =>
      visibleRange({
        scrollTop: v.scrollTop - headerHeight, viewport: v.viewport, count, rowHeight, overscan,
        tall: tallIndex < 0 ? null : { index: tallIndex, height: tallHeight },
      }),
    [headerHeight, count, rowHeight, overscan, tallIndex, tallHeight],
  )
  const rangeAtRef = useRef(rangeAt)
  useLayoutEffect(() => { rangeAtRef.current = rangeAt })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const read = () => {
      const next = { scrollTop: el.scrollTop, viewport: el.clientHeight }
      const prev = latest.current
      if (next.scrollTop === prev.scrollTop && next.viewport === prev.viewport) return
      latest.current = next
      const a = rangeAtRef.current(prev)
      const b = rangeAtRef.current(next)
      if (next.viewport !== prev.viewport || a.start !== b.start || a.end !== b.end) setView(next)
    }
    read()
    el.addEventListener('scroll', read, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read)
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', read); ro?.disconnect() }
  }, [scrollRef])

  // New rows (count, height, overscan, the tall row, the header): render from
  // where the scroller really is, not from the last position that moved the range.
  useLayoutEffect(() => {
    if (latest.current !== view) setView(latest.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the rows change
  }, [count, rowHeight, overscan, tallIndex, tallHeight, headerHeight])

  const range = rangeAt(view)
  const offsetOf = useCallback(
    (index: number) => rowOffset(index, rowHeight, tallIndex < 0 ? null : { index: tallIndex, height: tallHeight }),
    [rowHeight, tallIndex, tallHeight],
  )
  const scrollToIndex = useCallback((index: number) => {
    const el = scrollRef.current
    if (!el) return
    const top = headerHeight + offsetOf(index)
    const height = index === tallIndex ? tallHeight : rowHeight
    if (top - stickyHeight < el.scrollTop) el.scrollTop = top - stickyHeight
    else if (top + height > el.scrollTop + el.clientHeight - bottomInset) el.scrollTop = top + height - (el.clientHeight - bottomInset)
  }, [scrollRef, headerHeight, stickyHeight, bottomInset, offsetOf, tallIndex, tallHeight, rowHeight])

  return { range, totalHeight: listHeight(count, rowHeight, tall), offsetOf, scrollToIndex }
}
