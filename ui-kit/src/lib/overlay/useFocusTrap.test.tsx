import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useFocusTrap } from './useFocusTrap'

function Trap({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, active)
  return (
    <div ref={ref} tabIndex={-1}>
      <button data-autofocus-skip>close</button>
      <button>first</button>
      <button>last</button>
    </div>
  )
}

function Harness() {
  const [active, setActive] = useState(false)
  return (
    <>
      <button onClick={() => setActive(true)}>opener</button>
      <input aria-label="elsewhere" />
      <button onClick={() => setActive(false)}>deactivate</button>
      {active && <Trap active={active} />}
    </>
  )
}

describe('useFocusTrap', () => {
  it('focuses the first focusable that is not marked skip', () => {
    render(<Trap active />)
    expect(screen.getByText('first')).toHaveFocus()
  })

  it('wraps Tab and Shift+Tab inside', () => {
    render(<Trap active />)
    screen.getByText('last').focus()
    fireEvent.keyDown(screen.getByText('last'), { key: 'Tab' })
    expect(screen.getByText('close')).toHaveFocus()
    fireEvent.keyDown(screen.getByText('close'), { key: 'Tab', shiftKey: true })
    expect(screen.getByText('last')).toHaveFocus()
  })

  it('returns focus to the element that had it', () => {
    function Toggle() {
      const [on, setOn] = useState(true)
      const ref = useRef<HTMLDivElement>(null)
      useFocusTrap(ref, on)
      return <div ref={ref}><button onClick={() => setOn(false)}>inside</button></div>
    }
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    render(<Toggle />)
    expect(screen.getByText('inside')).toHaveFocus()
    fireEvent.click(screen.getByText('inside'))
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('does not steal focus from an element clicked outside', () => {
    render(<Harness />)
    screen.getByText('opener').focus()
    fireEvent.click(screen.getByText('opener'))
    expect(screen.getByText('first')).toHaveFocus()
    const elsewhere = screen.getByLabelText('elsewhere')
    elsewhere.focus()
    fireEvent.click(screen.getByText('deactivate'))
    expect(elsewhere).toHaveFocus()
    expect(screen.getByText('opener')).not.toHaveFocus()
  })

  it('Shift+Tab from the panel itself goes to the last control, not out', () => {
    render(<Trap active />)
    const panel = screen.getByText('first').parentElement!
    panel.focus()
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true })
    expect(screen.getByText('last')).toHaveFocus()
  })
})
