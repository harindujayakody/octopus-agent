import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import IconButton from '.'

describe('IconButton', () => {
  it('is named by its label and shows it as a tooltip', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    const onClick = vi.fn()
    render(<IconButton icon={<svg />} label="Delete profile" onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Delete profile' })
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
    fireEvent.pointerEnter(button.parentElement!)
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Delete profile')
    vi.useRealTimers()
  })
})

describe('IconButton disabled', () => {
  it('stays focusable and still shows its tooltip, so the only name it has is never hidden (EMIL-05)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    render(<IconButton icon={<svg />} label="Test proxy" disabled />)
    const button = screen.getByRole('button', { name: 'Test proxy' })
    // `aria-disabled`, never the `disabled` attribute: a browser keeps a
    // `disabled` button out of the Tab order and its tooltip from showing.
    expect(button).not.toHaveAttribute('disabled')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    fireEvent.pointerEnter(button.parentElement!)
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Test proxy')
    act(() => button.focus())
    expect(button).toHaveFocus()
    vi.useRealTimers()
  })
})
