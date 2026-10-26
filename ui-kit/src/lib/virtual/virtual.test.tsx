import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { listHeight, rowOffset, useVirtualList, visibleRange } from '.'

describe('visibleRange', () => {
  const base = { rowHeight: 36, count: 1000, overscan: 0 }
  it('covers the rows in the viewport', () => {
    expect(visibleRange({ ...base, scrollTop: 0, viewport: 360 })).toEqual({ start: 0, end: 10 })
    expect(visibleRange({ ...base, scrollTop: 3600, viewport: 360 })).toEqual({ start: 100, end: 110 })
  })
  it('adds overscan on both sides, clamped to the list', () => {
    expect(visibleRange({ ...base, overscan: 5, scrollTop: 0, viewport: 360 })).toEqual({ start: 0, end: 15 })
    expect(visibleRange({ ...base, overscan: 5, scrollTop: 36_000 - 360, viewport: 360 })).toEqual({ start: 985, end: 1000 })
  })
  it('never runs past the end, and an empty list is empty', () => {
    expect(visibleRange({ ...base, scrollTop: 99_999, viewport: 360 }).end).toBe(1000)
    expect(visibleRange({ ...base, count: 0, scrollTop: 0, viewport: 360 })).toEqual({ start: 0, end: 0 })
  })
  it('accounts for one taller row', () => {
    const tall = { index: 2, height: 300 }
    // rows 0-1 (0-72), row 2 (72-372), row 3 (372-408)
    expect(visibleRange({ ...base, tall, scrollTop: 0, viewport: 400 })).toEqual({ start: 0, end: 4 })
    expect(visibleRange({ ...base, tall, scrollTop: 400, viewport: 36 })).toEqual({ start: 3, end: 5 })
    expect(rowOffset(3, 36, tall)).toBe(372)
    expect(rowOffset(2, 36, tall)).toBe(72)
    expect(listHeight(10, 36, tall)).toBe(360 + 264)
  })
})

describe('useVirtualList', () => {
  it('follows the scroller and scrolls a row into view', () => {
    let api: ReturnType<typeof useVirtualList> | null = null
    function List() {
      const ref = useRef<HTMLDivElement>(null)
      api = useVirtualList({ count: 1000, rowHeight: 36, overscan: 0, scrollRef: ref })
      return <div ref={ref} data-testid="s" />
    }
    const { getByTestId } = render(<List />)
    const el = getByTestId('s')
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 360 })
    act(() => { el.scrollTop = 720; el.dispatchEvent(new Event('scroll')) })
    expect(api!.range).toEqual({ start: 20, end: 30 })
    expect(api!.totalHeight).toBe(36_000)
    act(() => api!.scrollToIndex(100))
    expect(el.scrollTop).toBe(100 * 36 + 36 - 360)
  })
})

describe('useVirtualList scrollToIndex', () => {
  it('keeps a row clear of the sticky header, not of everything above the rows', () => {
    let api: ReturnType<typeof useVirtualList> | null = null
    function List() {
      const ref = useRef<HTMLDivElement>(null)
      // 100 px above the first row, of which only the top 32 px stay pinned.
      api = useVirtualList({ count: 1000, rowHeight: 36, overscan: 0, scrollRef: ref, headerHeight: 100, stickyHeight: 32 })
      return <div ref={ref} data-testid="s" />
    }
    const { getByTestId } = render(<List />)
    const el = getByTestId('s')
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 360 })
    act(() => { el.scrollTop = 2000; el.dispatchEvent(new Event('scroll')) })
    act(() => api!.scrollToIndex(10))
    // Row 10 starts at 100 + 360 = 460 in the scroller; it should sit right under the 32 px header.
    expect(el.scrollTop).toBe(428)
    act(() => api!.scrollToIndex(100))
    // Row 100 ends at 100 + 3636 = 3736; it should sit at the bottom edge.
    expect(el.scrollTop).toBe(3736 - 360)
  })
})

describe('useVirtualList renders', () => {
  it('re-renders its list only when the rows in view change', () => {
    let renders = 0
    function List() {
      renders++
      const ref = useRef<HTMLDivElement>(null)
      const { range } = useVirtualList({ count: 1000, rowHeight: 36, overscan: 0, scrollRef: ref })
      return <div ref={ref} data-testid="s" data-start={range.start} />
    }
    const { getByTestId } = render(<List />)
    const el = getByTestId('s')
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 360 })
    // Rows 0 to 10 meet a 360 px viewport scrolled 10 px.
    act(() => { el.scrollTop = 10; el.dispatchEvent(new Event('scroll')) })
    const base = renders
    act(() => { el.scrollTop = 20; el.dispatchEvent(new Event('scroll')) })
    act(() => { el.scrollTop = 30; el.dispatchEvent(new Event('scroll')) })
    expect(renders).toBe(base) // still rows 0 to 10
    act(() => { el.scrollTop = 40; el.dispatchEvent(new Event('scroll')) })
    expect(renders).toBe(base + 1) // row 1 is now the first
    expect(el.dataset.start).toBe('1')
  })

  it('renders from the scroller\'s real position when the rows change', () => {
    let api: ReturnType<typeof useVirtualList> | null = null
    function List({ rowHeight }: { rowHeight: number }) {
      const ref = useRef<HTMLDivElement>(null)
      api = useVirtualList({ count: 1000, rowHeight, overscan: 0, scrollRef: ref })
      return <div ref={ref} data-testid="s" />
    }
    const { getByTestId, rerender } = render(<List rowHeight={36} />)
    const el = getByTestId('s')
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 360 })
    act(() => { el.scrollTop = 721; el.dispatchEvent(new Event('scroll')) })
    // 755 shows the same rows at 36 px (20 to 30), so it may not render ...
    act(() => { el.scrollTop = 755; el.dispatchEvent(new Event('scroll')) })
    // ... but at 30 px rows, 755 shows rows 25 to 37 where 721 showed 24 to 36.
    rerender(<List rowHeight={30} />)
    expect(api!.range).toEqual({ start: 25, end: 38 })
  })
})

describe('useVirtualList bottomInset', () => {
  it('keeps a row clear of a bar floating over the bottom of the scroller', () => {
    let api: ReturnType<typeof useVirtualList> | null = null
    function List() {
      const ref = useRef<HTMLDivElement>(null)
      api = useVirtualList({ count: 1000, rowHeight: 36, overscan: 0, scrollRef: ref, bottomInset: 64 })
      return <div ref={ref} data-testid="s" />
    }
    const { getByTestId } = render(<List />)
    const el = getByTestId('s')
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 360 })
    act(() => api!.scrollToIndex(100))
    // Row 100 ends at 3636; with a 64 px bar it must end 64 px above the bottom edge.
    expect(el.scrollTop).toBe(3636 - (360 - 64))
  })
})
