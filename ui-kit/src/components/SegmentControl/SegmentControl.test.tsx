import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import SegmentControl from '.'

function Harness() {
  const [value, setValue] = useState('row')
  return (
    <SegmentControl
      value={value}
      onChange={setValue}
      items={[{ label: 'Row', value: 'row' }, { label: 'Grid', value: 'grid' }, { label: 'Cascade', value: 'cascade' }]}
    />
  )
}

describe('SegmentControl', () => {
  it('has one tabbable segment and changes with the arrow keys', () => {
    render(<Harness />)
    const row = screen.getByRole('radio', { name: 'Row' })
    expect(row).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Grid' })).toHaveAttribute('tabindex', '-1')
    row.focus()
    fireEvent.keyDown(row, { key: 'ArrowLeft' })
    const cascade = screen.getByRole('radio', { name: 'Cascade' })
    expect(cascade).toHaveFocus()
    expect(cascade).toHaveAttribute('aria-checked', 'true')
  })
})

describe('SegmentControl names', () => {
  it('can be named by a caption elsewhere on the page', () => {
    render(
      <>
        <span id="cap">Operating system</span>
        <SegmentControl aria-labelledby="cap" value="a" items={[{ label: 'A', value: 'a' }]} />
      </>,
    )
    expect(screen.getByRole('radiogroup', { name: 'Operating system' })).toBeInTheDocument()
  })
})

describe('SegmentControl as a choice', () => {
  const items = [{ label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }, { label: 'System', value: 'system' }]
  it('is a radio group by default, with Home and End', () => {
    const onChange = vi.fn()
    render(<SegmentControl aria-label="Theme" items={items} value="light" onChange={onChange} />)
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith('system')
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith('light')
  })

  it('is a tab list only where it switches a panel', () => {
    render(<SegmentControl semantics="tabs" aria-label="Mode" items={items} value="dark" onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Dark' })).toHaveAttribute('aria-selected', 'true')
  })

  it('is safe when every item is disabled', () => {
    render(<SegmentControl aria-label="Theme" items={[{ label: 'A', value: 'a', disabled: true }]} value="a" onChange={() => {}} />)
    expect(() => fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' })).not.toThrow()
  })
})

describe('SegmentControl fit', () => {
  const items = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }]
  it('fills its row by default; with fit it takes its own width (CRAFT-05)', () => {
    const { rerender } = render(<SegmentControl aria-label="X" items={items} value="a" onChange={() => {}} />)
    expect(screen.getByRole('radiogroup').className).toContain('w-full')
    rerender(<SegmentControl fit aria-label="X" items={items} value="a" onChange={() => {}} />)
    expect(screen.getByRole('radiogroup').className).toContain('w-fit')
    expect(screen.getByRole('radiogroup').className).not.toContain('w-full')
  })
})
