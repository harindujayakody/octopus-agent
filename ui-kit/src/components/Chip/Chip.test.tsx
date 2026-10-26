import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Chip from '.'

describe('Chip', () => {
  it('is a toggle button whose pressed state follows `selected`', () => {
    const onClick = vi.fn()
    const { rerender } = render(<Chip selected={false} onClick={onClick}>Shops</Chip>)
    const chip = screen.getByRole('button', { name: 'Shops' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(chip)
    expect(onClick).toHaveBeenCalledOnce()
    rerender(<Chip selected onClick={onClick}>Shops</Chip>)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Chip size', () => {
  it('xsmall keeps its 21 px look with a 24 px tall target (WCAG 2.5.8; owner: never bigger)', () => {
    render(<Chip size="xsmall">US</Chip>)
    const chip = screen.getByRole('button', { name: 'US' })
    expect(chip.className).toContain('h-[21px]')
    expect(chip.className).toContain("before:-inset-y-[1.5px]")
  })
})
