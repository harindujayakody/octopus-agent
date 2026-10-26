import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Toast from '.'

afterEach(() => {
  delete (HTMLElement.prototype as unknown as { scrollHeight?: number }).scrollHeight
})

describe('Toast', () => {
  it('is a neutral raised surface; the status color is on the icon only', () => {
    const { container } = render(<Toast status="error" title="Couldn’t start “Sandbox”" />)
    const surface = container.firstElementChild as HTMLElement
    expect(surface.className).toContain('bg-bg-raised')
    expect(surface.className).not.toMatch(/bg-error/)
    expect(surface.querySelector('[aria-hidden="true"]')!.className).toContain('text-error-base')
    expect(surface).not.toHaveAttribute('role')
  })

  it('clamps a long detail and offers to copy it', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return this.classList.contains('line-clamp-4') ? 200 : 0 } })
    const onCopyDetail = vi.fn()
    render(<Toast status="error" title="Couldn’t import" detail={'C:\\Users\\x\\'.repeat(40)} onCopyDetail={onCopyDetail} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    expect(onCopyDetail).toHaveBeenCalledOnce()
  })

  it('a progress toast names its bar', () => {
    render(<Toast status="progress" title="Starting 2 of 5 profiles" progress={{ done: 2, total: 5 }} />)
    expect(screen.getByRole('progressbar', { name: 'Starting 2 of 5 profiles' })).toHaveAttribute('aria-valuenow', '40')
  })

  it('dismisses with the one dismiss button, named by the kit labels', () => {
    const onDismiss = vi.fn()
    render(<Toast status="information" title="Saved" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
