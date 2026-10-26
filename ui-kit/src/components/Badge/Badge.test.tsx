import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Badge from '.'

const classesOf = (el: Element) => el.getAttribute('class')?.split(/\s+/) ?? []

// Live layer, Task 1 (spec 4.2): the Badge gains a pill shape and a 14 px
// leading slot; every existing size, variant and color draws as before.
describe('Badge shape and lead', () => {
  it("keeps today's chip look by default", () => {
    render(<Badge color="success">Running</Badge>)
    const badge = screen.getByText('Running')
    expect(classesOf(badge)).toContain('rounded-chip')
    expect(classesOf(badge)).not.toContain('rounded-full')
    // The exact class list the Badge drew before the pill existed.
    expect(badge.getAttribute('class')).toBe(
      'inline-flex items-center justify-center gap-[3px] whitespace-nowrap rounded-chip text-center font-medium px-[7px] py-[1px] text-secondary bg-success-tint text-success-text',
    )
  })

  // Spec 4.2: a pill is as tall as the row's Tag and Folder chips (12/16 text
  // and 1 px above and below, 18 px), so a row's chips and pills line up.
  // Written in px, as every kit spacing is: the app's `py-0.5` is 1 px and
  // the kit's own is 2 px, so a step would draw two heights.
  it('draws a pill as tall as the row chips', () => {
    render(<Badge shape="pill" color="success">Running</Badge>)
    const pill = screen.getByText('Running')
    expect(classesOf(pill)).toEqual(expect.arrayContaining(['rounded-full', 'py-[1px]', 'text-secondary', 'bg-success-tint', 'text-success-text']))
    expect(classesOf(pill)).not.toContain('rounded-chip')
  })

  // Spec 4.4: in forced colors the tint falls away, so the pill draws a 1 px
  // system edge and keeps its word.
  it('gives a pill a system edge in forced colors', () => {
    render(<Badge shape="pill">Idle</Badge>)
    expect(classesOf(screen.getByText('Idle'))).toContain('forced-edge')
  })

  it('puts lead in a 14 px slot', () => {
    render(<Badge shape="pill" color="success" lead={<span data-testid="d" />}>Running</Badge>)
    const slot = screen.getByTestId('d').parentElement!
    expect(classesOf(slot)).toEqual(expect.arrayContaining(['size-3.5', 'shrink-0']))
    // Decoration: the word carries the state (owner: no dot-only status).
    expect(slot.getAttribute('aria-hidden')).toBe('true')
    // Before the text.
    const text = [...screen.getByText('Running').childNodes].find((n) => n.nodeType === Node.TEXT_NODE)!
    expect(slot.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // A lead's own slot is mostly air around a 7 px dot, so the lead side takes
  // 3 px less padding and the dot sits as far in as the text on the other side.
  it('takes 3 px off the lead side only', () => {
    render(
      <>
        <Badge shape="pill" lead={<span />}>Medium</Badge>
        <Badge shape="pill" size="small" lead={<span />}>Small</Badge>
      </>,
    )
    expect(classesOf(screen.getByText('Medium'))).toEqual(expect.arrayContaining(['pl-[4px]', 'pr-[7px]']))
    expect(classesOf(screen.getByText('Medium'))).not.toContain('px-[7px]')
    expect(classesOf(screen.getByText('Small'))).toEqual(expect.arrayContaining(['pl-[2px]', 'pr-[5px]']))
  })

  it('draws no slot without a lead', () => {
    const { container } = render(<Badge shape="pill">Idle</Badge>)
    expect(container.querySelector('.size-3\\.5')).toBeNull()
  })
})
