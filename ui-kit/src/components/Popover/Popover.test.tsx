import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import Popover from '.'

function Harness() {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={anchor} onClick={() => setOpen((o) => !o)}>filters</button>
      <button>elsewhere</button>
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchor} aria-label="Filters">
        <input aria-label="country" />
      </Popover>
    </>
  )
}

describe('Popover', () => {
  it('opens as a labelled dialog and focuses its first field', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('filters'))
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('country')).toHaveFocus())
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<Harness />)
    const trigger = screen.getByText('filters')
    trigger.focus()
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByLabelText('country')).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trigger).toHaveFocus()
  })

  it('closes on a press outside; a press on the trigger toggles instead', async () => {
    render(<Harness />)
    const trigger = screen.getByText('filters')
    fireEvent.click(trigger)
    fireEvent.pointerDown(trigger)
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByText('elsewhere'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('can open at a point instead of a trigger and closes on a press outside', async () => {
    const onOpenChange = vi.fn()
    render(
      <>
        <button>elsewhere</button>
        <Popover open onOpenChange={onOpenChange} anchorPoint={{ x: 120, y: 80 }} aria-label="Proxy details">
          <p>203.0.113.7</p>
        </Popover>
      </>,
    )
    expect(screen.getByRole('dialog', { name: 'Proxy details' })).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByText('elsewhere'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not treat a press on its trigger as outside, even when anchored to a point', () => {
    const onOpenChange = vi.fn()
    function PointHarness() {
      const trigger = useRef<HTMLButtonElement>(null)
      return (
        <>
          <button ref={trigger}>details</button>
          <Popover open onOpenChange={onOpenChange} anchorPoint={{ x: 10, y: 10 }} triggerRef={trigger} aria-label="Details">
            <p>x</p>
          </Popover>
        </>
      )
    }
    render(<PointHarness />)
    fireEvent.pointerDown(screen.getByText('details'))
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe('Popover enter and exit', () => {
  it('is inert while it leaves', () => {
    const { rerender } = render(<Popover open onOpenChange={() => {}} anchorPoint={{ x: 10, y: 10 }} aria-label="Panel"><p>x</p></Popover>)
    rerender(<Popover open={false} onOpenChange={() => {}} anchorPoint={{ x: 10, y: 10 }} aria-label="Panel"><p>x</p></Popover>)
    const panel = screen.getByRole('dialog', { name: 'Panel', hidden: true })
    expect(panel).toHaveAttribute('data-ending-style')
    expect(panel).toHaveAttribute('inert')
  })

  it('grows from the point it opened at', async () => {
    render(<Popover open onOpenChange={() => {}} anchorPoint={{ x: 10, y: 10 }} aria-label="Panel"><p>x</p></Popover>)
    const panel = screen.getByRole('dialog', { name: 'Panel' })
    await waitFor(() => expect(panel.style.transformOrigin).toBe('top left'))
  })
})

describe('Popover and Tab', () => {
  it('keeps Tab inside: it is a small form (A11Y-06)', async () => {
    function Form() {
      const [open, setOpen] = useState(true)
      return (
        <Popover open={open} onOpenChange={setOpen} anchorPoint={{ x: 10, y: 10 }} aria-label="Filters">
          <input aria-label="first" /><input aria-label="last" />
        </Popover>
      )
    }
    render(<><button>outside</button><Form /></>)
    const first = await screen.findByLabelText('first')
    await waitFor(() => expect(first).toHaveFocus())
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(screen.getByLabelText('last')).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
  })
})
