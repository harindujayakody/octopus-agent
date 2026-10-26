import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import NavItem from '.'

describe('NavItem', () => {
  it('marks the current page with aria-current', () => {
    render(
      <>
        <NavItem icon={<svg />} label="Profiles" active />
        <NavItem icon={<svg />} label="Proxies" />
      </>,
    )
    expect(screen.getByRole('button', { name: 'Profiles' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Proxies' })).not.toHaveAttribute('aria-current')
  })

  it('shows the label and badge next to the icon', () => {
    render(<NavItem icon={<svg />} label="Ads" badge={3} />)
    const item = screen.getByRole('button', { name: /Ads/ })
    expect(item).toHaveTextContent('Ads')
    expect(item).toHaveTextContent('3')
  })

  it('collapsed: icon only, still named by its label, which shows as a tooltip', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    render(<NavItem icon={<svg />} label="Proxies" collapsed />)
    const item = screen.getByRole('button', { name: 'Proxies' })
    expect(item).not.toHaveTextContent('Proxies')
    fireEvent.pointerEnter(item.parentElement!)
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Proxies')
    vi.useRealTimers()
  })

  it('highlights while something is dragged over it', () => {
    render(<NavItem icon={<svg />} label="Ads" dropActive />)
    expect(screen.getByRole('button', { name: 'Ads' })).toHaveAttribute('data-drop-active', 'true')
  })
})

describe('NavItem badgeLabel', () => {
  it('speaks the count in words and hides the digits', () => {
    render(<NavItem icon={<svg />} label="All Profiles" badge="28" badgeLabel="28 profiles" />)
    expect(screen.getByRole('button', { name: 'All Profiles 28 profiles' })).toBeInTheDocument()
  })
})

describe('NavItem shortcut', () => {
  it('shows its key in the collapsed tooltip and declares it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
    render(<NavItem icon={<svg />} label="Search" collapsed shortcut="⌘K" />)
    const item = screen.getByRole('button', { name: 'Search' })
    expect(item).toHaveAttribute('aria-keyshortcuts', 'Meta+K')
    fireEvent.pointerEnter(item.parentElement!)
    act(() => { vi.advanceTimersByTime(400) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Search')
    expect(screen.getByRole('tooltip')).toHaveTextContent('⌘K')
    vi.useRealTimers()
  })

  it("keeps the caller's aria-keyshortcuts, and shows no key while expanded", () => {
    render(<NavItem icon={<svg />} label="Search" shortcut="⌘K" aria-keyshortcuts="Control+K" />)
    const item = screen.getByRole('button', { name: 'Search' })
    expect(item).toHaveAttribute('aria-keyshortcuts', 'Control+K')
    expect(item).not.toHaveTextContent('⌘K')
  })
})
