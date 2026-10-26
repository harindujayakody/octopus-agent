import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Button from '.'

describe('Button', () => {
  it('renders a text link without height or padding', () => {
    render(<Button mode="link" variant="error" size="small">remove cookies</Button>)
    const b = screen.getByRole('button', { name: 'remove cookies' })
    expect(b.className).toContain('h-auto')
    expect(b.className).toContain('px-0')
    expect(b.className).toContain('text-error-text')
    expect(b.className).not.toContain('h-9')
  })

  it('can align its content to the start, for select-like triggers', () => {
    render(<Button contentAlign="start" rightIcon={<svg />}>Any flow</Button>)
    const b = screen.getByRole('button', { name: 'Any flow' })
    expect(b.className).toContain('justify-start')
    expect(b.className).not.toContain('justify-center')
    expect(screen.getByText('Any flow').className).toContain('flex-1')
  })

  // Fix round 1 (I2): `pointer-events-none` made the pointer hit-test
  // whatever sat under a disabled button instead of the button itself, so
  // the base rule's `cursor: not-allowed` never reached the user.
  it('a disabled button keeps pointer-events, so a hit-test lands on it (not-allowed shows)', () => {
    render(<Button disabled>Delete</Button>)
    const b = screen.getByRole('button', { name: 'Delete' })
    expect(b.className).not.toContain('pointer-events-none')
  })
})

describe('Button states', () => {
  it('disabled keeps its look and its focus, and ignores clicks', () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button variant="neutral" onClick={onClick}>Save</Button>)
    const on = screen.getByRole('button', { name: 'Save' }).className.split(' ')
    rerender(<Button variant="neutral" onClick={onClick} disabled>Save</Button>)
    const b = screen.getByRole('button', { name: 'Save' })
    expect(b).not.toHaveAttribute('disabled')
    expect(b).toHaveAttribute('aria-disabled', 'true')
    expect(b).toHaveAttribute('data-disabled')
    for (const c of on) if (!c.startsWith('not-aria-disabled:')) expect(b.className.split(' ')).toContain(c)
    b.focus()
    expect(b).toHaveFocus()
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('a disabled accent button shows the neutral disabled look, with no accent at all', () => {
    for (const mode of ['filled', 'stroke', 'lighter', 'ghost', 'link'] as const) {
      const { unmount } = render(<Button mode={mode} disabled>Create</Button>)
      const cls = screen.getByRole('button').className
      expect(cls, mode).not.toMatch(/primary/)
      expect(cls, mode).toContain('text-text-soft-400')
      if (mode === 'filled' || mode === 'lighter') expect(cls, mode).toContain('bg-bg-weak-50')
      unmount()
    }
    // A busy button is not disabled: it keeps its accent look.
    render(<Button isLoading>Create</Button>)
    expect(screen.getByRole('button').className).toContain('bg-primary-base')
  })

  it('a disabled or busy submit button does not submit its form', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    const { rerender } = render(<form onSubmit={onSubmit}><Button type="submit" disabled>Save</Button></form>)
    const b = screen.getByRole('button', { name: 'Save' })
    // The click guard stops the submit, not the `disabled` attribute (which
    // would also take the button out of focus).
    expect(b).not.toHaveAttribute('disabled')
    fireEvent.click(b)
    rerender(<form onSubmit={onSubmit}><Button type="submit" isLoading>Save</Button></form>)
    expect(b).not.toHaveAttribute('disabled')
    fireEvent.click(b)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('loading keeps the label and the name, says it is busy, keeps focus, and shows the spinner in the icon slot', () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick} leftIcon={<svg data-testid="icon" />}>Restore</Button>)
    const b = screen.getByRole('button', { name: 'Restore' })
    b.focus()
    rerender(<Button onClick={onClick} isLoading leftIcon={<svg data-testid="icon" />}>Restore</Button>)
    expect(screen.getByRole('button', { name: 'Restore' })).toBe(b)
    expect(b).toHaveFocus()
    expect(b).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByTestId('icon')).toBeNull()
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('loading without an icon lays the spinner over a label that keeps its width', () => {
    render(<Button isLoading>Restore</Button>)
    expect(screen.getByText('Restore').className).toContain('invisible')
    expect(screen.getByRole('button', { name: 'Restore' })).toHaveAttribute('aria-busy', 'true')
  })

  it('presses by scale unless static or a link', () => {
    const { rerender } = render(<Button>Go</Button>)
    expect(screen.getByRole('button').className).toContain('not-aria-disabled:active:scale-(--motion-press)')
    rerender(<Button static>Go</Button>)
    expect(screen.getByRole('button').className).not.toContain('active:scale')
    rerender(<Button mode="link">Go</Button>)
    expect(screen.getByRole('button').className).not.toContain('active:scale')
  })

  it('an open trigger shows it, in the hover gray (active equals hover, owner 2026-10-01); pressed is a step darker', () => {
    render(<Button variant="neutral" mode="ghost" aria-expanded>Filters</Button>)
    expect(screen.getByRole('button').className).toContain('aria-expanded:bg-bg-hover')
    expect(screen.getByRole('button').className).toContain('not-aria-disabled:active:bg-bg-active')
  })

  it('a disabled or busy button answers no hover: every hover class has an aria-disabled twin (Pair 4 carry-in)', () => {
    const modes = ['filled', 'stroke', 'lighter', 'ghost', 'link'] as const
    const variants = ['primary', 'neutral', 'error'] as const
    const missing: string[] = []
    for (const mode of modes) {
      for (const variant of variants) {
        const { unmount } = render(<Button mode={mode} variant={variant} disabled>Save</Button>)
        const cls = screen.getByRole('button').className.split(' ')
        for (const c of cls.filter((x) => x.startsWith('hover:'))) {
          const family = c.slice('hover:'.length).replace(/^(bg|text)-.*/, '$1-').replace(/^underline$/, 'no-underline')
          if (!cls.some((d) => d.startsWith(`aria-disabled:hover:${family}`))) missing.push(`${mode} ${variant}: ${c}`)
        }
        unmount()
      }
    }
    expect(missing).toEqual([])
  })

  it('an open primary stroke trigger (a filter is on) shows it too', () => {
    render(<Button variant="primary" mode="stroke" aria-expanded>Filters</Button>)
    expect(screen.getByRole('button').className).toContain('aria-expanded:bg-primary-tint-hover')
  })

  it('a stroke neutral button has no shadow', () => {
    render(<Button variant="neutral" mode="stroke">Cancel</Button>)
    expect(screen.getByRole('button').className).not.toContain('shadow-')
  })
})
