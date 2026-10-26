import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DismissButton from '.'
import { LabelsProvider } from '@/lib/labels'

describe('DismissButton', () => {
  it('is named by the kit close word unless given a label, and closes', () => {
    const onClick = vi.fn()
    const { rerender } = render(
      <LabelsProvider labels={{ close: '关闭' }}>
        <DismissButton onClick={onClick} />
      </LabelsProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClick).toHaveBeenCalledOnce()
    rerender(<DismissButton onClick={onClick} label="Close Peek" />)
    expect(screen.getByRole('button', { name: 'Close Peek' })).toBeInTheDocument()
  })

  it('draws at 21 px with a 24 px hit area (owner) and the kit focus ring', () => {
    render(<DismissButton onClick={() => {}} />)
    const b = screen.getByRole('button', { name: 'Close' })
    expect(b.className).toContain('size-[21px]')
    expect(b.className).toContain("before:-inset-[1.5px]")
    expect(b.className).toContain('focus-ring')
  })
})
