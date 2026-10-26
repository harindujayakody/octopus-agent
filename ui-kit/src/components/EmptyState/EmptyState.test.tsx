import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EmptyState from '.'

describe('EmptyState', () => {
  it('shows a heading, the hint and the actions', () => {
    render(<EmptyState title="No profiles yet" hint="Create one to start." actions={<button>New profile</button>} />)
    expect(screen.getByRole('heading', { name: 'No profiles yet' })).toBeInTheDocument()
    expect(screen.getByText('Create one to start.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New profile' })).toBeInTheDocument()
  })

  // Owner feedback 5o (2026-09-26): "remove border from those empty states
  // icons." The icon tile is the neutral weak fill with its radius, no ring.
  it('the icon tile has no ring class', () => {
    render(<EmptyState icon={<svg />} title="No profiles yet" />)
    const tile = screen.getByText('No profiles yet').previousElementSibling as HTMLElement
    expect(tile.className).not.toMatch(/\bring-/)
  })
})

// Audit Phase F, Task 2 (TYPE-10): a page's empty state sits under the page
// h1, so its title is an h2; inside a panel with its own h2 it is an h3.
describe('EmptyState heading level', () => {
  it('is an h2 by default: a page state sits under the page title', () => {
    render(<EmptyState title="No proxies yet" />)
    expect(screen.getByRole('heading', { level: 2, name: 'No proxies yet' })).toBeInTheDocument()
  })

  it('is an h3 inside a panel that has its own h2', () => {
    render(<EmptyState title="Couldn't load this profile" headingLevel={3} />)
    expect(screen.getByRole('heading', { level: 3, name: "Couldn't load this profile" })).toBeInTheDocument()
  })
})

describe('EmptyState tone', () => {
  it('is neutral by default: no brand tint on a decoration (COLOR-10)', () => {
    const { container } = render(<EmptyState icon={<svg />} title="No proxies" />)
    expect(container.querySelector('svg')!.parentElement!.className).not.toMatch(/primary/)
  })
  it('can take the brand tint where the state invites an action', () => {
    const { container } = render(<EmptyState tone="brand" icon={<svg />} title="Add a proxy" />)
    expect(container.querySelector('svg')!.parentElement!.className).toContain('bg-primary-tint')
  })
})

// Clarity fixes, item 17: one first-run page everywhere. The state keeps its
// icon, title and hint, and its way in is a filled primary button (no 64 px
// tile), with an optional quieter second one.
describe('EmptyState action', () => {
  it('renders the action as a filled primary button and runs it', () => {
    const onClick = vi.fn()
    render(<EmptyState icon={<svg />} title="No bookmarks yet" hint="Add one." action={{ label: 'Add a bookmark', icon: <svg data-testid="add" />, onClick }} />)
    const button = screen.getByRole('button', { name: 'Add a bookmark' })
    expect(button).toHaveClass('bg-primary-base')
    expect(button).toHaveClass('h-[30px]')
    // The icon sits in the button's 14 px slot.
    expect(screen.getByTestId('add').parentElement).toHaveClass('size-3.5')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps the visible title, the icon tile and the hint with an action', () => {
    const { container } = render(<EmptyState icon={<svg />} title="No bookmarks yet" hint="Add one." action={{ label: 'Add a bookmark', onClick: () => {} }} />)
    const heading = screen.getByRole('heading', { name: 'No bookmarks yet' })
    expect(heading.className).not.toContain('sr-only')
    expect(screen.getByText('Add one.')).toBeInTheDocument()
    expect(container.querySelector('[data-empty-state] > div')!.className).toContain('size-12')
  })

  it('puts the secondary after the primary, as a stroke button', () => {
    const onSecondary = vi.fn()
    render(<EmptyState title="No profiles yet" action={{ label: 'New profile', onClick: () => {} }} secondary={{ label: 'Import profiles', onClick: onSecondary }} />)
    const [first, second] = screen.getAllByRole('button')
    expect(first).toHaveTextContent('New profile')
    expect(first).toHaveClass('bg-primary-base')
    expect(second).toHaveTextContent('Import profiles')
    expect(second).not.toHaveClass('bg-primary-base')
    fireEvent.click(second)
    expect(onSecondary).toHaveBeenCalledTimes(1)
  })

  it('has no primary button without an action', () => {
    render(<EmptyState title="Trash is empty" hint="Deleted profiles stay here." />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('still takes a custom actions slot (a Clear button on a no-match state)', () => {
    render(<EmptyState title="No match" actions={<button>Clear search</button>} />)
    expect(screen.getByRole('button', { name: 'Clear search' })).not.toHaveClass('bg-primary-base')
  })
})
