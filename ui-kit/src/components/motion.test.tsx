import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from '../theme/ThemeProvider'
import Button from './Button'
import Menu from './Menu'
import ProgressBar from './ProgressBar'

const classesOf = (el: Element) => el.getAttribute('class')?.split(/\s+/) ?? []

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('motion (audit Phase B, B5)', () => {
  it('a button fades its colors, never everything', () => {
    render(<Button>Save</Button>)
    const c = classesOf(screen.getByRole('button', { name: 'Save' }))
    expect(c).toContain('transition-hover')
    expect(c).not.toContain('transition')
  })

  it('a menu names what moves and uses the motion tokens', () => {
    render(<Menu open onOpenChange={() => {}} anchor={{ current: document.body }} items={[{ label: 'Rename', onSelect: () => {} }]} />)
    expect(classesOf(screen.getByRole('menu'))).toEqual(expect.arrayContaining([
      'transition-[opacity,scale]', 'duration-(--motion-fast)', 'data-ending-style:duration-(--motion-exit-fast)', 'data-starting-style:scale-(--motion-scale-in)',
    ]))
  })

  it('progress moves by translate, not width (PERF-06)', () => {
    render(<ProgressBar value={42} />)
    const fill = screen.getByRole('progressbar').firstElementChild as HTMLElement
    expect(fill.style.translate).toBe('-58% 0')
    expect(fill.style.width).toBe('')
    expect(classesOf(fill)).toContain('transition-[translate]')
  })

  it('a theme change suspends transitions for two frames (PERF-07)', () => {
    // jsdom has no matchMedia; ThemeProvider reads the system theme through it.
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
    let flip: () => void = () => {}
    function Flip() {
      const { toggleTheme } = useTheme()
      flip = toggleTheme
      return null
    }
    render(<ThemeProvider><Flip /></ThemeProvider>)
    act(() => { vi.advanceTimersToNextFrame(); vi.advanceTimersToNextFrame() })
    expect(document.documentElement.hasAttribute('data-theme-switching')).toBe(false)
    act(() => flip())
    expect(document.documentElement.hasAttribute('data-theme-switching')).toBe(true)
    act(() => { vi.advanceTimersToNextFrame(); vi.advanceTimersToNextFrame() })
    expect(document.documentElement.hasAttribute('data-theme-switching')).toBe(false)
  })
})
