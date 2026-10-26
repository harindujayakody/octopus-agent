import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePresence, type PresenceOptions } from './usePresence'
import type { PresenceGroup } from './presenceGroups'

// jsdom has no Element.getAnimations: the exit ends on its cap unless a test
// stubs it (animations.md S6, "Tests").
type WithAnimations = { getAnimations?: (o?: { subtree?: boolean }) => Animation[] }
const proto = HTMLElement.prototype as unknown as WithAnimations

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete proto.getAnimations
})

function Box({ open, options, log }: { open: boolean; options?: PresenceOptions | number; log?: string[] }) {
  const p = usePresence(open, options)
  log?.push('data-starting-style' in p.attrs ? 'starting' : 'data-ending-style' in p.attrs ? 'ending' : p.state)
  return p.mounted ? <div data-testid="box" {...p.rootProps} /> : null
}

function Member({ id, open, group }: { id: string; open: boolean; group: PresenceGroup }) {
  const p = usePresence(open, { group, maxExitMs: 1000 })
  return p.mounted ? <div data-testid={id} {...p.rootProps} /> : null
}

describe('usePresence', () => {
  it('1. mounted open, the first render has the starting style and it is gone before paint', () => {
    const flush = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    const log: string[] = []
    render(<Box open log={log} />)
    expect(log[0]).toBe('starting')
    expect(log.at(-1)).toBe('open')
    // The forced style flush that replaces the double requestAnimationFrame (PERF-10).
    expect(flush).toHaveBeenCalled()
    const box = screen.getByTestId('box')
    expect(box).not.toHaveAttribute('data-starting-style')
    expect(box).toHaveAttribute('data-state', 'open')
  })

  it('2. closing marks it leaving and inert, then unmounts at the cap', () => {
    const { rerender } = render(<Box open options={{ maxExitMs: 300 }} />)
    rerender(<Box open={false} options={{ maxExitMs: 300 }} />)
    const box = screen.getByTestId('box')
    expect(box).toHaveAttribute('data-ending-style')
    expect(box).toHaveAttribute('data-state', 'closed')
    expect(box).toHaveAttribute('inert')
    act(() => { vi.advanceTimersByTime(299) })
    expect(screen.getByTestId('box')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByTestId('box')).toBeNull()
  })

  it('3. with nothing animating (reduced motion, no exit style) it unmounts at once', () => {
    proto.getAnimations = () => []
    const { rerender } = render(<Box open />)
    rerender(<Box open={false} />)
    expect(screen.queryByTestId('box')).toBeNull()
  })

  it('3b. with a transition running it waits for that transition, not a timer', async () => {
    let end!: () => void
    const finished = new Promise<void>((resolve) => { end = resolve })
    proto.getAnimations = () => [{ finished, effect: { getComputedTiming: () => ({ iterations: 1 }) } } as unknown as Animation]
    const { rerender } = render(<Box open options={{ maxExitMs: 5000 }} />)
    rerender(<Box open={false} options={{ maxExitMs: 5000 }} />)
    expect(screen.getByTestId('box')).toBeInTheDocument()
    await act(async () => { end(); await finished })
    expect(screen.queryByTestId('box')).toBeNull()
  })

  it('4. keeps the last value through the exit', () => {
    const { result, rerender } = renderHook(
      ({ v }: { v: string | null }) => usePresence<string>(v, { maxExitMs: 200 }),
      { initialProps: { v: 'Sandbox' as string | null } },
    )
    rerender({ v: null })
    expect(result.current.mounted).toBe(true)
    expect(result.current.state).toBe('closed')
    expect(result.current.value).toBe('Sandbox')
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current.mounted).toBe(false)
    expect(result.current.value).toBeUndefined()
  })

  it('5. exit "instant" unmounts in the same commit', () => {
    const { rerender } = render(<Box open options={{ exit: 'instant' }} />)
    rerender(<Box open={false} options={{ exit: 'instant' }} />)
    expect(screen.queryByTestId('box')).toBeNull()
  })

  it('6. opening again during the exit cancels the unmount', () => {
    const { rerender } = render(<Box open options={{ maxExitMs: 300 }} />)
    rerender(<Box open={false} options={{ maxExitMs: 300 }} />)
    act(() => { vi.advanceTimersByTime(100) })
    rerender(<Box open options={{ maxExitMs: 300 }} />)
    act(() => { vi.advanceTimersByTime(1000) })
    const box = screen.getByTestId('box')
    expect(box).toHaveAttribute('data-state', 'open')
    expect(box).not.toHaveAttribute('data-ending-style')
    expect(box).not.toHaveAttribute('inert')
  })

  it('6b. opened again on its way out, it turns around: no starting style on the way back', () => {
    const log: string[] = []
    const { rerender } = render(<Box open options={{ maxExitMs: 300 }} log={log} />)
    rerender(<Box open={false} options={{ maxExitMs: 300 }} log={log} />)
    act(() => { vi.advanceTimersByTime(50) })
    const from = log.length
    rerender(<Box open options={{ maxExitMs: 300 }} log={log} />)
    expect(log.slice(from)).not.toContain('starting')
    expect(screen.getByTestId('box')).toHaveAttribute('data-state', 'open')
  })

  it.each([false, true])('7. an overlay that opens ends a leaving one at once (other one first: %s)', (reverse) => {
    const Pair = ({ a, b }: { a: boolean; b: boolean }) => {
      const A = <Member key="a" id="a" open={a} group="overlay" />
      const B = <Member key="b" id="b" open={b} group="overlay" />
      return <>{reverse ? [B, A] : [A, B]}</>
    }
    const { rerender } = render(<Pair a b={false} />)
    rerender(<Pair a={false} b />)
    expect(screen.queryByTestId('a')).toBeNull()
    expect(screen.getByTestId('b')).toBeInTheDocument()
  })

  it('7b. an overlay that opens later ends one that is still leaving', () => {
    const Pair = ({ a, b }: { a: boolean; b: boolean }) => (
      <><Member id="a" open={a} group="overlay" /><Member id="b" open={b} group="overlay" /></>
    )
    const { rerender } = render(<Pair a b={false} />)
    rerender(<Pair a={false} b={false} />)
    expect(screen.getByTestId('a')).toHaveAttribute('data-ending-style')
    rerender(<Pair a={false} b />)
    expect(screen.queryByTestId('a')).toBeNull()
  })

  it('8. an overlay that opens also ends a leaving tooltip', () => {
    const Two = ({ tip, menu }: { tip: boolean; menu: boolean }) => (
      <><Member id="tip" open={tip} group="tooltip" /><Member id="menu" open={menu} group="overlay" /></>
    )
    const { rerender } = render(<Two tip menu={false} />)
    rerender(<Two tip={false} menu={false} />)
    expect(screen.getByTestId('tip')).toHaveAttribute('data-ending-style')
    rerender(<Two tip={false} menu />)
    expect(screen.queryByTestId('tip')).toBeNull()
  })

  it('9. records whether a key or the pointer opened it', () => {
    const { rerender } = render(<Box open={false} options={{ exit: 'instant' }} />)
    fireEvent.keyDown(document.body, { key: 'k' })
    rerender(<Box open options={{ exit: 'instant' }} />)
    expect(screen.getByTestId('box')).toHaveAttribute('data-input', 'keyboard')
    rerender(<Box open={false} options={{ exit: 'instant' }} />)
    fireEvent.pointerDown(document.body)
    rerender(<Box open options={{ exit: 'instant' }} />)
    expect(screen.getByTestId('box')).toHaveAttribute('data-input', 'pointer')
  })

  it('10. the old (open, exitMs) call still works, with exitMs as the cap', () => {
    const { rerender } = render(<Box open options={150} />)
    rerender(<Box open={false} options={150} />)
    act(() => { vi.advanceTimersByTime(149) })
    expect(screen.getByTestId('box')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByTestId('box')).toBeNull()
  })

  it('11. a surface that never opens does no work on mount (PERF-09)', () => {
    window.matchMedia ??= (() => ({ matches: false })) as never
    const timer = vi.spyOn(window, 'setTimeout')
    const media = vi.spyOn(window, 'matchMedia')
    render(<>{Array.from({ length: 50 }, (_, i) => <Box key={i} open={false} />)}</>)
    // The old hook armed an exit timer (150 ms) and read matchMedia for every closed surface.
    expect(timer.mock.calls.filter(([, ms]) => typeof ms === 'number' && ms > 0)).toHaveLength(0)
    expect(media).not.toHaveBeenCalled()
  })
})
