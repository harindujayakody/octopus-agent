import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useListNavigation } from './useListNavigation'

type Item = { id: string; label: string; disabled?: boolean }
const ITEMS: Item[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo', disabled: true },
  { id: 'c', label: 'Charlie' },
  { id: 'd', label: 'Delta' },
  { id: 'e', label: 'Echo' },
]

function List({ items = ITEMS, onPick = () => {}, typeahead = false, defaultActiveId = null, loop = true, scrollToIndex }: {
  items?: Item[]
  onPick?: (item: Item, how: { alt: boolean; pointer: boolean }) => void
  typeahead?: boolean
  defaultActiveId?: string | null
  loop?: boolean
  scrollToIndex?: (i: number) => void
}) {
  const nav = useListNavigation({
    items, getId: (i) => i.id, isDisabled: (i) => !!i.disabled, getText: (i) => i.label,
    typeahead, onPick, defaultActiveId, loop, pageSize: 2, scrollToIndex,
  })
  return (
    <div>
      <input
        aria-label="field"
        role="combobox"
        aria-expanded
        aria-controls="lb"
        aria-activedescendant={nav.activeId ? nav.optionId(nav.activeId) : undefined}
        onKeyDown={nav.onKeyDown}
      />
      <div role="listbox" id="lb" aria-label="Items">
        {items.map((item, i) => (
          <div key={item.id} {...nav.getOptionProps(item, i)} aria-selected={nav.activeIndex === i}>{item.label}</div>
        ))}
      </div>
    </div>
  )
}

const field = () => screen.getByRole('combobox')
const active = () => document.getElementById(field().getAttribute('aria-activedescendant') ?? '')?.textContent
const press = (key: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(field(), { key, ...init })

describe('useListNavigation', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }) })
  afterEach(() => vi.useRealTimers())

  it('starts on the first enabled item; the arrows skip disabled ones and wrap', () => {
    render(<List />)
    expect(active()).toBe('Alpha')
    press('ArrowDown'); expect(active()).toBe('Charlie')
    press('ArrowDown'); press('ArrowDown'); expect(active()).toBe('Echo')
    press('ArrowDown'); expect(active()).toBe('Alpha')
    press('ArrowUp'); expect(active()).toBe('Echo')
  })

  it('without loop it stops at the ends', () => {
    render(<List loop={false} />)
    press('ArrowUp'); expect(active()).toBe('Alpha')
    press('End'); press('ArrowDown'); expect(active()).toBe('Echo')
  })

  it('Home, End, PageDown and PageUp', () => {
    render(<List />)
    press('End'); expect(active()).toBe('Echo')
    press('Home'); expect(active()).toBe('Alpha')
    press('PageDown'); expect(active()).toBe('Delta')
    press('PageUp'); expect(active()).toBe('Alpha')
  })

  it('Enter picks the highlighted item; with Cmd or Ctrl it is the alternative', () => {
    const onPick = vi.fn()
    render(<List onPick={onPick} />)
    press('ArrowDown'); press('Enter')
    expect(onPick).toHaveBeenLastCalledWith(ITEMS[2], { alt: false, pointer: false })
    press('Enter', { metaKey: true })
    expect(onPick).toHaveBeenLastCalledWith(ITEMS[2], { alt: true, pointer: false })
  })

  it('typeahead jumps by the first letters; a pause starts a new word', () => {
    render(<List typeahead />)
    press('d'); expect(active()).toBe('Delta')
    press('e'); expect(active()).toBe('Delta') // "de" is still Delta
    vi.advanceTimersByTime(600)
    press('e'); expect(active()).toBe('Echo')
    vi.advanceTimersByTime(600)
    press('b'); expect(active()).toBe('Echo') // Bravo is disabled
  })

  it('the pointer moves the same highlight; a click picks; a disabled item does neither', () => {
    const onPick = vi.fn()
    render(<List onPick={onPick} />)
    fireEvent.pointerMove(screen.getByRole('option', { name: 'Delta' }))
    expect(active()).toBe('Delta')
    fireEvent.pointerMove(screen.getByRole('option', { name: 'Bravo' }))
    expect(active()).toBe('Delta')
    fireEvent.click(screen.getByRole('option', { name: 'Bravo' }))
    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('option', { name: 'Echo' }))
    expect(onPick).toHaveBeenCalledWith(ITEMS[4], { alt: false, pointer: true })
  })

  it('a press on an option keeps focus in the field', () => {
    render(<List />)
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    screen.getByRole('option', { name: 'Echo' }).dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
  })

  it('starts on the default item, and falls back when the highlighted one leaves', () => {
    const { rerender } = render(<List defaultActiveId="d" />)
    expect(active()).toBe('Delta')
    press('ArrowDown'); expect(active()).toBe('Echo')
    rerender(<List defaultActiveId="d" items={ITEMS.filter((i) => i.id !== 'e')} />)
    expect(active()).toBe('Delta')
  })

  it('ignores keys while an input method composes', () => {
    render(<List />)
    press('ArrowDown', { isComposing: true } as Partial<KeyboardEventInit>)
    expect(active()).toBe('Alpha')
  })

  // Pair 19 review: a hook that outlives its list (a Select trigger keeps it)
  // would otherwise scroll only when it mounts, not when the list opens.
  it('reset: a list that opens under a hook that stayed mounted starts on the default item, in view', () => {
    const scrollToIndex = vi.fn()
    function Trigger() {
      const [open, setOpen] = useState(false)
      const nav = useListNavigation({
        items: ITEMS, getId: (i) => i.id, isDisabled: (i) => !!i.disabled, onPick: () => {}, defaultActiveId: 'd', scrollToIndex,
      })
      return (
        <div>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls="lb"
            aria-activedescendant={open && nav.activeId ? nav.optionId(nav.activeId) : undefined}
            onKeyDown={nav.onKeyDown}
            onClick={() => { setOpen((o) => !o); nav.reset() }}
          >
            Pick
          </button>
          {open && (
            <div role="listbox" id="lb" aria-label="Items">
              {ITEMS.map((item, i) => <div key={item.id} {...nav.getOptionProps(item, i)}>{item.label}</div>)}
            </div>
          )}
        </div>
      )
    }
    render(<Trigger />)
    fireEvent.click(field())
    press('ArrowDown')
    expect(active()).toBe('Echo')
    fireEvent.click(field()) // close
    scrollToIndex.mockClear()
    fireEvent.click(field()) // open again: back on Delta, brought into view
    expect(active()).toBe('Delta')
    expect(scrollToIndex).toHaveBeenLastCalledWith(3)
    fireEvent.click(field())
    scrollToIndex.mockClear()
    fireEvent.click(field()) // the highlight did not move, and it still scrolls
    expect(scrollToIndex).toHaveBeenLastCalledWith(3)
  })

  it('a move event where the pointer already was keeps the keys\' highlight (WebKit, after a scroll)', () => {
    render(<List />)
    fireEvent.pointerMove(screen.getByRole('option', { name: 'Charlie' }), { clientX: 30, clientY: 40 })
    expect(active()).toBe('Charlie')
    press('End')
    expect(active()).toBe('Echo')
    // The list scrolled under the still pointer: Delta is under it now.
    fireEvent.pointerMove(screen.getByRole('option', { name: 'Delta' }), { clientX: 30, clientY: 40 })
    expect(active()).toBe('Echo')
    // A real move does move it.
    fireEvent.pointerMove(screen.getByRole('option', { name: 'Delta' }), { clientX: 31, clientY: 44 })
    expect(active()).toBe('Delta')
  })

  it('scrolls what the keys reach into view, not what the pointer reaches', () => {
    const scrollToIndex = vi.fn()
    render(<List scrollToIndex={scrollToIndex} />)
    scrollToIndex.mockClear()
    press('End')
    expect(scrollToIndex).toHaveBeenLastCalledWith(4)
    scrollToIndex.mockClear()
    fireEvent.pointerMove(screen.getByRole('option', { name: 'Charlie' }))
    expect(scrollToIndex).not.toHaveBeenCalled()
  })
})
