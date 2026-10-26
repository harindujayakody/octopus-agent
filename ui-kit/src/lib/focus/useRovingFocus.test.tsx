import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useRovingFocus } from './useRovingFocus'

function List({ current = 'b' }: { current?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useRovingFocus(ref, { selector: 'button', typeahead: true, initial: (items) => items.find((i) => i.getAttribute('aria-current')) })
  return (
    <div ref={ref}>
      {['Alpha', 'Bravo', 'Charlie', 'Delta'].map((n) => (
        <button key={n} aria-current={n[0].toLowerCase() === current ? 'page' : undefined}>{n}</button>
      ))}
    </div>
  )
}

describe('useRovingFocus', () => {
  it('leaves one Tab stop: the current item', () => {
    render(<List />)
    expect(screen.getByText('Bravo').tabIndex).toBe(0)
    for (const n of ['Alpha', 'Charlie', 'Delta']) expect(screen.getByText(n).tabIndex).toBe(-1)
  })

  it('arrows, Home and End move focus and the Tab stop', () => {
    render(<List />)
    screen.getByText('Bravo').focus()
    fireEvent.keyDown(screen.getByText('Bravo'), { key: 'ArrowDown' })
    expect(screen.getByText('Charlie')).toHaveFocus()
    expect(screen.getByText('Charlie').tabIndex).toBe(0)
    expect(screen.getByText('Bravo').tabIndex).toBe(-1)
    fireEvent.keyDown(screen.getByText('Charlie'), { key: 'End' })
    expect(screen.getByText('Delta')).toHaveFocus()
    fireEvent.keyDown(screen.getByText('Delta'), { key: 'Home' })
    expect(screen.getByText('Alpha')).toHaveFocus()
    fireEvent.keyDown(screen.getByText('Alpha'), { key: 'ArrowUp' })
    expect(screen.getByText('Delta')).toHaveFocus()
  })

  it('a typed letter jumps to the next item that starts with it', () => {
    render(<List />)
    screen.getByText('Bravo').focus()
    fireEvent.keyDown(screen.getByText('Bravo'), { key: 'd' })
    expect(screen.getByText('Delta')).toHaveFocus()
  })

  it('a key another handler already took does nothing', () => {
    render(<List />)
    const b = screen.getByText('Bravo')
    b.focus()
    b.addEventListener('keydown', (e) => e.preventDefault(), { capture: true })
    fireEvent.keyDown(b, { key: 'ArrowDown' })
    expect(b).toHaveFocus()
  })

  it('the stop follows the current item while the group does not hold the keyboard', async () => {
    const { rerender } = render(<List />)
    rerender(<List current="d" />)
    // The observer reports after the change.
    await act(async () => {})
    expect(screen.getByText('Delta').tabIndex).toBe(0)
    expect(screen.getByText('Bravo').tabIndex).toBe(-1)
  })

  it('in a grid, Up and Down move by a row of the layout', () => {
    function Grid() {
      const ref = useRef<HTMLDivElement>(null)
      useRovingFocus(ref, { selector: 'button', orientation: 'grid' })
      return <div ref={ref}>{[0, 1, 2, 3, 4, 5].map((i) => <button key={i}>{`card ${i}`}</button>)}</div>
    }
    render(<Grid />)
    // Three columns: cards 0 to 2 on the first row, 3 to 5 on the second.
    screen.getAllByRole('button').forEach((b, i) => {
      vi.spyOn(b, 'getBoundingClientRect').mockReturnValue({ left: (i % 3) * 100, top: Math.floor(i / 3) * 50, width: 90, height: 40, right: (i % 3) * 100 + 90, bottom: Math.floor(i / 3) * 50 + 40, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    })
    screen.getByText('card 1').focus()
    fireEvent.keyDown(screen.getByText('card 1'), { key: 'ArrowDown' })
    expect(screen.getByText('card 4')).toHaveFocus()
    fireEvent.keyDown(screen.getByText('card 4'), { key: 'ArrowRight' })
    expect(screen.getByText('card 5')).toHaveFocus()
    fireEvent.keyDown(screen.getByText('card 5'), { key: 'ArrowUp' })
    expect(screen.getByText('card 2')).toHaveFocus()
  })
})
