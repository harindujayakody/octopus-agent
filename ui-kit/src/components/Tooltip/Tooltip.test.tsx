import { useRef } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Popover from '@/components/Popover'
import Tooltip from '.'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
})
afterEach(() => vi.useRealTimers())

const setup = () =>
  render(
    <Tooltip content="Copy URL">
      <button>copy</button>
    </Tooltip>,
  )

describe('Tooltip', () => {
  it('opens after the hover delay and describes its trigger', () => {
    setup()
    fireEvent.pointerEnter(screen.getByText('copy').parentElement!)
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { vi.advanceTimersByTime(400) })
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Copy URL')
    expect(screen.getByText('copy')).toHaveAttribute('aria-describedby', tip.id)
  })

  it('opens at once on keyboard focus and closes on Escape', () => {
    setup()
    act(() => { vi.advanceTimersByTime(1000) })
    fireEvent.keyDown(document.body, { key: 'Tab' })
    act(() => screen.getByText('copy').focus())
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveAttribute('data-ending-style')
    // jsdom runs no transitions, so the exit ends on the presence cap (400 ms).
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull()
  })

  it('closes when the pointer leaves or presses', () => {
    setup()
    const wrap = screen.getByText('copy').parentElement!
    fireEvent.pointerEnter(wrap)
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.pointerLeave(wrap)
    act(() => { vi.advanceTimersByTime(99) })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('whenTruncated: opens only while its child\'s text is cut off', () => {
    render(
      <Tooltip content="Etsy craft shop for the summer sale" whenTruncated>
        <span>Etsy craft shop</span>
      </Tooltip>,
    )
    const text = screen.getByText('Etsy craft shop')
    const sized = (scroll: number, client: number) => {
      Object.defineProperty(text, 'scrollWidth', { configurable: true, value: scroll })
      Object.defineProperty(text, 'clientWidth', { configurable: true, value: client })
    }
    sized(100, 100)
    fireEvent.pointerEnter(text.parentElement!)
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerLeave(text.parentElement!)
    sized(240, 100)
    fireEvent.pointerEnter(text.parentElement!)
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Etsy craft shop for the summer sale')
  })

  it('renders nothing when disabled or empty', () => {
    render(<Tooltip content=""><button>x</button></Tooltip>)
    act(() => screen.getByText('x').focus())
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('keeps the child\'s own aria-describedby and adds its id while open', () => {
    render(
      <Tooltip content="More info">
        <input aria-label="port" aria-describedby="port-hint" />
      </Tooltip>,
    )
    const input = screen.getByLabelText('port')
    expect(input).toHaveAttribute('aria-describedby', 'port-hint')
    fireEvent.pointerEnter(input.parentElement!)
    act(() => { vi.advanceTimersByTime(400) })
    const tip = screen.getByRole('tooltip')
    expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual(['port-hint', tip.id])
  })
})

describe('Tooltip v2', () => {
  const hoverOpen = (wrap: HTMLElement) => {
    fireEvent.pointerEnter(wrap)
    act(() => { vi.advanceTimersByTime(400) })
  }

  it('can be hovered: the pointer may cross from the trigger onto it (WCAG 1.4.13)', () => {
    setup()
    const wrap = screen.getByText('copy').parentElement!
    hoverOpen(wrap)
    fireEvent.pointerLeave(wrap)
    act(() => { vi.advanceTimersByTime(60) })
    fireEvent.pointerEnter(screen.getByRole('tooltip'))
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.pointerLeave(screen.getByRole('tooltip'))
    act(() => { vi.advanceTimersByTime(600) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('a press closes it at once', () => {
    setup()
    const wrap = screen.getByText('copy').parentElement!
    hoverOpen(wrap)
    fireEvent.pointerDown(wrap)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('Esc hides only the tooltip; the layer under it does not hear it', () => {
    const under = vi.fn()
    document.addEventListener('keydown', under)
    setup()
    hoverOpen(screen.getByText('copy').parentElement!)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(under).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(under).toHaveBeenCalledOnce()
    document.removeEventListener('keydown', under)
  })

  it('with passEscape, Esc hides it and still reaches the layer under it (a dialog close button)', () => {
    const under = vi.fn()
    document.addEventListener('keydown', under)
    render(
      <Tooltip content="Close" passEscape>
        <button>x</button>
      </Tooltip>,
    )
    hoverOpen(screen.getByText('x').parentElement!)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(under).toHaveBeenCalledOnce()
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    document.removeEventListener('keydown', under)
  })

  it('opens on focus from Tab, not on focus moved by code', () => {
    setup()
    act(() => { vi.advanceTimersByTime(1000) })
    fireEvent.keyDown(document.body, { key: 'Enter' })
    act(() => screen.getByText('copy').focus())
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => screen.getByText('copy').blur())
    fireEvent.keyDown(document.body, { key: 'Tab' })
    act(() => screen.getByText('copy').focus())
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })

  it('warm={false} waits its delay even right after another tooltip closed', () => {
    render(
      <>
        <Tooltip content="A"><button>a</button></Tooltip>
        <Tooltip content="B" warm={false} delay={700}><button>b</button></Tooltip>
      </>,
    )
    const a = screen.getByText('a').parentElement!
    hoverOpen(a)
    fireEvent.pointerDown(a)
    const b = screen.getByText('b').parentElement!
    fireEvent.pointerEnter(b)
    act(() => { vi.advanceTimersByTime(699) })
    expect(screen.queryByRole('tooltip', { name: 'B' })).toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('B')
  })

  it('does not describe a trigger with its own name', () => {
    render(<Tooltip content="More actions"><button aria-label="More actions">⋮</button></Tooltip>)
    const b = screen.getByRole('button', { name: 'More actions' })
    hoverOpen(b.parentElement!)
    expect(b).not.toHaveAttribute('aria-describedby')
  })

  it('shows a key and declares it on the trigger', () => {
    render(<Tooltip content="New profile" shortcut="C"><button>new</button></Tooltip>)
    const b = screen.getByText('new')
    expect(b).toHaveAttribute('aria-keyshortcuts', 'C')
    hoverOpen(b.parentElement!)
    expect(screen.getByRole('tooltip').querySelector('kbd')).toHaveTextContent('C')
  })

  it('moving from an open tooltip to its neighbour within the grace shows the neighbour at once (Pair 36 review, Important 2)', () => {
    // Clear of any tooltip an earlier test closed (the warm window is module-wide).
    act(() => { vi.advanceTimersByTime(10_000) })
    render(
      <>
        <Tooltip content="A"><button>a</button></Tooltip>
        <Tooltip content="B"><button>b</button></Tooltip>
      </>,
    )
    const a = screen.getByText('a').parentElement!
    hoverOpen(a)
    expect(screen.getByRole('tooltip')).toHaveTextContent('A')
    fireEvent.pointerLeave(a)
    act(() => { vi.advanceTimersByTime(30) })
    fireEvent.pointerEnter(screen.getByText('b').parentElement!)
    // No 400 ms wait (FEEL-18), and A goes at once: one tooltip at a time.
    expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    expect(screen.getByRole('tooltip')).toHaveTextContent('B')
  })

  it('a pressed trigger stays quiet until the pointer leaves it, even when the pointer arrives after the press', () => {
    setup()
    const wrap = screen.getByText('copy').parentElement!
    fireEvent.pointerDown(wrap)
    fireEvent.pointerEnter(wrap)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerLeave(wrap)
    hoverOpen(wrap)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })

  it('opens only after the pointer really moves over its trigger, never from a layout move under a still pointer (merge point 5)', () => {
    act(() => { vi.advanceTimersByTime(10_000) })
    setup()
    const button = screen.getByText('copy')
    // The pointer rests at (50, 20), and the trigger slides under it (a list
    // narrowing as Peek opens): it arrives without moving.
    fireEvent.pointerMove(document.body, { clientX: 50, clientY: 20 })
    fireEvent.pointerEnter(button, { clientX: 50, clientY: 20 })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    // A move event at the same point is no move.
    fireEvent.pointerMove(button, { clientX: 50.4, clientY: 20 })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    // A real move over it opens it, after the delay.
    fireEvent.pointerMove(button, { clientX: 54, clientY: 21 })
    act(() => { vi.advanceTimersByTime(399) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Copy URL')
    // A pointer that moves in from elsewhere opens it as before.
    fireEvent.pointerLeave(button)
    act(() => { vi.advanceTimersByTime(10_000) })
    fireEvent.pointerMove(document.body, { clientX: 200, clientY: 200 })
    fireEvent.pointerEnter(button, { clientX: 52, clientY: 20 })
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Copy URL')
  })

  it('never opens while a menu, picker, popover or dialog is open, unless its trigger is inside that layer (merge point 5)', () => {
    act(() => { vi.advanceTimersByTime(10_000) })
    function Picker({ open }: { open: boolean }) {
      const anchor = useRef<HTMLButtonElement>(null)
      return (
        <>
          <Tooltip content="Clone"><button ref={anchor}>clone</button></Tooltip>
          <Popover open={open} onOpenChange={() => {}} anchorRef={anchor} aria-label="Tags">
            <Tooltip content="Remove tag"><button>remove</button></Tooltip>
          </Popover>
        </>
      )
    }
    const { rerender } = render(<Picker open />)
    const outside = screen.getByText('clone').parentElement!
    // A row button under the open picker: no tooltip, so the first Esc
    // still reaches the picker.
    hoverOpen(outside)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.pointerLeave(outside)
    // A button inside the picker shows its own.
    hoverOpen(screen.getByText('remove').parentElement!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Remove tag')
    fireEvent.pointerLeave(screen.getByText('remove').parentElement!)
    act(() => { vi.advanceTimersByTime(10_000) })
    // A layer that opens during the delay keeps it shut.
    rerender(<Picker open={false} />)
    act(() => { vi.advanceTimersByTime(1000) })
    fireEvent.pointerEnter(outside)
    act(() => { vi.advanceTimersByTime(200) })
    rerender(<Picker open />)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByRole('tooltip')).toBeNull()
    // With the picker closed, it opens again.
    fireEvent.pointerLeave(outside)
    rerender(<Picker open={false} />)
    act(() => { vi.advanceTimersByTime(10_000) })
    hoverOpen(outside)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Clone')
  })

  it('a tooltip that never opens mounts nothing that floats', () => {
    const { container } = render(<>{Array.from({ length: 20 }, (_, i) => <Tooltip key={i} content={`t${i}`}><button>{i}</button></Tooltip>)}</>)
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-state]')).toHaveLength(0)
  })
})
