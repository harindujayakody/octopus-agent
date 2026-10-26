import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Card, { cardClass, cardLiftClass } from '.'

describe('Card', () => {
  it('padding sm is 12 px at the sides and 10 at top and bottom (nothing grows, owner)', () => {
    render(<Card padding="sm">x</Card>)
    const c = screen.getByText('x').className.split(' ')
    expect(c).toContain('px-cell')
    expect(c).toContain('py-[10px]')
  })

  it('is a tile by default: no border and no ring, its fill and shadow from the tile tokens (borderless, owner)', () => {
    render(<Card>x</Card>)
    const c = screen.getByText('x').className.split(' ')
    expect(c).toContain('tile')
    expect(c.join(' ')).not.toMatch(/(^| )(border|shadow-|ring-)/)
  })

  it('interactive shows it can be pressed: a tile steps up, never to the ground color (white with a lifted shadow in light, the active fill in dark)', () => {
    render(<Card interactive>x</Card>)
    const c = screen.getByText('x').className
    expect(c).toContain('cursor-pointer')
    expect(c).toContain('focus-ring')
    expect(c).toContain('hover:bg-[var(--bg-tile-hover)]')
    expect(c).toContain('hover:shadow-[var(--shadow-tile-hover)]')
  })

  it('the lift lives in one place: an interactive surface card carries every class of cardLiftClass', () => {
    const c = cardClass({ variant: 'surface', interactive: true }).split(' ')
    for (const k of cardLiftClass.split(' ')) expect(c).toContain(k)
    expect(c).toContain('hover:border-stroke-sub-300')
    expect(cardLiftClass).toContain('hover:shadow-[var(--shadow-sm)]')
  })

  it('selected keeps its own surface and colors and adds one ring, the focus ring, never a stripe (owner)', () => {
    render(<Card interactive selected>x</Card>)
    const c = screen.getByText('x')
    expect(c.className).toContain('selected-ring')
    expect(c.className).toContain('tile')
    expect(c.className).not.toMatch(/bg-bg-selected|border-primary|ring-primary/)
    expect(c.className).not.toMatch(/border-[lrtb]-/)
    expect(c).toHaveAttribute('data-selected')
  })

  it('the same recipe dresses a card that must be another element (a button)', () => {
    render(<button type="button" className={cardClass({ padding: 'sm', interactive: true, selected: true })}>x</button>)
    const Rendered = () => <Card padding="sm" interactive selected>y</Card>
    render(<Rendered />)
    expect(screen.getByRole('button').className).toBe(screen.getByText('y').className)
  })
})
