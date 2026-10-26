import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Alert from '.'

describe('Alert', () => {
  it('shows an action before the close button', () => {
    const run = vi.fn()
    render(<Alert onClose={() => {}} action={<button onClick={run}>Undo</button>}>Moved 2 to the trash</Alert>)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['Undo', 'Dismiss'])
    fireEvent.click(screen.getByText('Undo'))
    expect(run).toHaveBeenCalledOnce()
  })
})

describe('Alert dismiss', () => {
  it('uses the one dismiss button: 21 px drawn with a 24 px hit area and a focus ring', () => {
    render(<Alert onClose={() => {}}>Saved</Alert>)
    const b = screen.getByRole('button', { name: 'Dismiss' })
    expect(b.className).toContain('size-[21px]')
    expect(b.className).toContain("before:-inset-[1.5px]")
    expect(b.className).toContain('focus-ring')
  })
})

describe('Alert roles and long text', () => {
  it('a success informs politely; an error alerts', () => {
    const { rerender } = render(<Alert status="success">Saved</Alert>)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    rerender(<Alert status="error">Failed</Alert>)
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')
  })

  it('wraps a long unbroken path instead of cutting it (WIG-07)', () => {
    render(<Alert status="error">{'C:\\very\\long\\path\\'.repeat(20)}</Alert>)
    expect(screen.getByRole('alert').querySelector('[class*="overflow-wrap:anywhere"]')).not.toBeNull()
  })
})
