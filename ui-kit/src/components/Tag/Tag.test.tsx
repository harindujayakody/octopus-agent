import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Tag from '.'

describe('Tag', () => {
  it('keeps its 14 px remove mark with a 24 px target (PC-092) and the focus ring', () => {
    render(<Tag onRemove={() => {}}>8080</Tag>)
    const b = screen.getByRole('button', { name: 'Remove' })
    expect(b.className).toContain('size-3.5')
    expect(b.className).toContain("after:-inset-[5px]")
    expect(b.className).toContain('focus-ring')
  })
})
