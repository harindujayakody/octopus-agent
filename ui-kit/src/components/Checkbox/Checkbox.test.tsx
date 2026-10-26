import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Checkbox from '.'

describe('Checkbox', () => {
  it('tells assistive tech about the mixed state, not only the eye', () => {
    const { rerender } = render(<Checkbox aria-label="VIP" indeterminate checked={false} onChange={() => {}} />)
    expect((screen.getByRole('checkbox', { name: 'VIP' }) as HTMLInputElement).indeterminate).toBe(true)
    rerender(<Checkbox aria-label="VIP" checked onChange={() => {}} />)
    expect((screen.getByRole('checkbox', { name: 'VIP' }) as HTMLInputElement).indeterminate).toBe(false)
  })
})

describe('Checkbox details', () => {
  it('has a hit area larger than its box', () => {
    const { container } = render(<Checkbox aria-label="Select Sandbox" />)
    expect(container.querySelector('input')!.parentElement!.className).toContain("before:-inset-[6px]")
  })

  it('drops the hit area where the whole row is the label (Pair 12 review)', () => {
    const { container } = render(<Checkbox aria-label="uBlock" hitArea={false} />)
    expect(container.querySelector('input')!.parentElement!.className).not.toContain('before:')
  })

  it('stays mixed after a click when the prop stays mixed (PC-090)', () => {
    render(<Checkbox aria-label="All" indeterminate onChange={() => {}} />)
    const box = screen.getByRole('checkbox', { name: 'All' }) as HTMLInputElement
    expect(box.indeterminate).toBe(true)
    fireEvent.click(box)
    expect(box.indeterminate).toBe(true)
  })
})

describe('Checkbox onCheckedChange', () => {
  it('reports the new state like Switch does (EMIL-21)', () => {
    const onCheckedChange = vi.fn()
    render(<Checkbox aria-label="Select" onCheckedChange={onCheckedChange} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })
})
