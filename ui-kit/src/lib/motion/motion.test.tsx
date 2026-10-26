import { act, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CountRoll } from './countRoll'
import { animateFrom, FALLBACK_EASING, FALLBACK_MS, springAt, springLinear, SPRING_MS } from './spring'

// jsdom has no Web Animations API: each element's animate() records a fake
// that can be finished, cancelled and reversed like a real one.
class FakeAnimation extends EventTarget {
  playState: AnimationPlayState = 'running'
  playbackRate = 1
  readonly target: Element
  readonly keyframes: Keyframe[]
  readonly options: KeyframeAnimationOptions
  effect = {
    updateTiming: (t: OptionalEffectTiming) => Object.assign(this.options, t),
    getKeyframes: () => this.keyframes,
  }
  constructor(target: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    super()
    this.target = target
    this.keyframes = keyframes
    this.options = options
  }
  finish() {
    this.playState = 'finished'
    this.dispatchEvent(new Event('finish'))
  }
  cancel() {
    this.playState = 'idle'
    this.dispatchEvent(new Event('cancel'))
  }
  reverse() {
    this.playbackRate *= -1
  }
}

type Animatable = { animate?: unknown; getAnimations?: unknown }
const proto = Element.prototype as unknown as Animatable
let made: FakeAnimation[] = []
const runningOn = (el: Element) => made.filter((a) => a.target === el && a.playState === 'running')

beforeEach(() => {
  made = []
  proto.animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const a = new FakeAnimation(this, keyframes, options)
    made.push(a)
    return a
  }
  proto.getAnimations = function (this: Element) {
    return runningOn(this)
  }
})
afterEach(() => {
  delete proto.animate
  delete proto.getAnimations
  delete document.documentElement.dataset.reduceMotion
})

const running = () => made.filter((a) => a.playState === 'running')
/** The count as the page reads it: the number in the flow, not the copy rolling out. */
const shownNumber = (container: HTMLElement) =>
  container.querySelector('[data-count-roll] > span')!.lastChild!.textContent

describe('CountRoll', () => {
  it('renders the number in tabular figures, unannounced, with nothing rolling', () => {
    const { container } = render(<CountRoll value={2} />)
    const root = container.querySelector('[data-count-roll]')!
    expect(root).toHaveTextContent(/^2$/)
    expect(root).toHaveAttribute('aria-live', 'off')
    expect(root).toHaveClass('tabular-nums')
    expect(made).toHaveLength(0)
  })

  it('a change during a roll never queues a second roll: it ends on the newest number', () => {
    const { container, rerender } = render(<CountRoll value={2} />)
    rerender(<CountRoll value={3} />)
    rerender(<CountRoll value={4} />)
    expect(running()).toHaveLength(1)
    expect(shownNumber(container)).toBe('4')
    // Late in a roll (jsdom has no layout: the 3 is in place) the 3 is what
    // you read, so the roll goes on from it. It leaves as a hidden copy,
    // gone when the roll ends.
    expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true')
    act(() => running()[0].finish())
    expect(container.querySelector('[data-count-roll]')).toHaveTextContent(/^4$/)
  })

  it('a count that goes up rolls the new number in from below, a count that goes down from above', () => {
    const { rerender } = render(<CountRoll value={2} />)
    rerender(<CountRoll value={3} />)
    expect(made[0].keyframes[0].transform).toBe('translateY(calc(0px + 100%))')
    act(() => made[0].finish())
    rerender(<CountRoll value={1} />)
    expect(made[1].keyframes[0].transform).toBe('translateY(calc(0px - 100%))')
    expect(made[1].keyframes.at(-1)!.transform).toBe('translateY(0)')
  })

  describe('mid-roll: every number on screen stays where it is', () => {
    // A 20 px line whose track is 16 px down: the new number is 80 % below
    // the clip, the old one 4 px above its place.
    const line = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    beforeEach(() => {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 20 })
      ;(globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly = class {
        m42: number
        constructor(t: string) {
          this.m42 = Number.parseFloat(/translateY\(([-\d.]+)px\)/.exec(t)?.[1] ?? '0')
        }
      }
    })
    afterEach(() => {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', line)
      delete (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly
    })
    const early = (container: HTMLElement) => {
      container.querySelector<HTMLElement>('[data-count-roll] > span')!.style.transform = 'translateY(16px)'
    }

    it('a further change the same way: the numbers on screen roll on from where they are, the newest from under them', () => {
      const { container, rerender } = render(<CountRoll value={2} />)
      rerender(<CountRoll value={3} />)
      early(container)
      rerender(<CountRoll value={4} />)
      expect(running()).toHaveLength(1)
      expect(made[0].playState).toBe('idle')
      // The 3 stays 16 px down and the 2 4 px up; the 4 comes in a line under the 3.
      expect(made[1].keyframes[0].transform).toBe('translateY(calc(16px + 100%))')
      expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByText('2')).toHaveAttribute('aria-hidden', 'true')
      expect(shownNumber(container)).toBe('4')
      act(() => made[1].finish())
      expect(container.querySelector('[data-count-roll]')).toHaveTextContent(/^4$/)
    })

    it('back to the number on its way out: it rolls back onto its line from where it is, the other rolls out', () => {
      const { container, rerender } = render(<CountRoll value={2} />)
      rerender(<CountRoll value={3} />)
      early(container)
      rerender(<CountRoll value={2} />)
      expect(running()).toHaveLength(1)
      // The 2 (in the flow) starts 4 px up, where it is; the 3 stays 16 px down.
      expect(made[1].keyframes[0].transform).toBe('translateY(calc(16px - 100%))')
      expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true')
      act(() => made[1].finish())
      expect(container.querySelector('[data-count-roll]')).toHaveTextContent(/^2$/)
    })

    it('back to a number whose roll began off its line: a new roll from where both numbers are, never a turn-around', () => {
      // 2 to 3; late in that roll 4 arrives (the 3 is 6 px under its line),
      // so the second roll starts off rest; early in it the count goes back
      // to 3. Turning that roll around would carry the 3 back to 6 px under
      // its line and snap it up at the end.
      const { container, rerender } = render(<CountRoll value={2} />)
      rerender(<CountRoll value={3} />)
      const track = container.querySelector<HTMLElement>('[data-count-roll] > span')!
      track.style.transform = 'translateY(6px)'
      rerender(<CountRoll value={4} />)
      expect(made[1].keyframes[0].transform).toBe('translateY(calc(6px + 100%))')
      // Early in the second roll: the 3 is 3 px above its line, the 4 is 17 px below.
      track.style.transform = 'translateY(17px)'
      rerender(<CountRoll value={3} />)
      expect(made).toHaveLength(3)
      expect(made[1].playState).toBe('idle')
      expect(made[1].playbackRate).toBe(1)
      // The 3 (in the flow) starts at -3 px, where it is; the 4 rolls out
      // below it from 17 px, where it is.
      expect(made[2].keyframes[0].transform).toBe('translateY(calc(17px - 100%))')
      expect(made[2].keyframes.at(-1)!.transform).toBe('translateY(0)')
      expect(screen.getByText('4')).toHaveAttribute('aria-hidden', 'true')
      expect(shownNumber(container)).toBe('3')
      act(() => made[2].finish())
      expect(container.querySelector('[data-count-roll]')).toHaveTextContent(/^3$/)
    })

    it('the other way past them: the newest comes in above, every number rolling on from where it is', () => {
      const { rerender, container } = render(<CountRoll value={5} />)
      rerender(<CountRoll value={6} />)
      early(container)
      rerender(<CountRoll value={3} />)
      expect(running()).toHaveLength(1)
      // The 5 stays 4 px up and the 6 16 px down; the 3 comes in a line above the 5.
      expect(running()[0].keyframes[0].transform).toBe('translateY(calc(16px - 200%))')
      expect(screen.getByText('5')).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByText('6')).toHaveAttribute('aria-hidden', 'true')
    })
  })

  it('under Reduce motion it swaps at once, with no animation', () => {
    document.documentElement.dataset.reduceMotion = 'true'
    const { container, rerender } = render(<CountRoll value={2} />)
    rerender(<CountRoll value={3} />)
    expect(made).toHaveLength(0)
    expect(container.querySelector('[data-count-roll]')).toHaveTextContent(/^3$/)
  })

  it('Reduce motion switched on mid-roll ends the roll on the latest number at once', async () => {
    const { container, rerender } = render(<CountRoll value={2} />)
    rerender(<CountRoll value={3} />)
    rerender(<CountRoll value={4} />)
    expect(running()).toHaveLength(1)
    // Settings writes the switch onto <html>; the kit hears it.
    await act(async () => {
      document.documentElement.dataset.reduceMotion = 'true'
      await Promise.resolve()
    })
    expect(running()).toHaveLength(0)
    expect(container.querySelector('[data-count-roll]')).toHaveTextContent(/^4$/)
    const rolls = made.length
    rerender(<CountRoll value={5} />)
    expect(made).toHaveLength(rolls)
    expect(container.querySelector('[data-count-roll]')).toHaveTextContent(/^5$/)
  })
})

describe('animateFrom', () => {
  it('starts from where the element is now, on the spring, and cancels what ran on it', () => {
    const el = document.createElement('div')
    el.style.transform = 'translateY(8px)'
    document.body.append(el)
    const before = el.animate([{ opacity: 0 }], { duration: 100 }) as unknown as FakeAnimation
    // A flash of its fill is not a move: it plays on.
    const flash = el.animate([{ backgroundColor: 'green' }], { duration: 400 }) as unknown as FakeAnimation
    const a = animateFrom(el, { transform: 'none', opacity: '1' }) as unknown as FakeAnimation
    expect(a.keyframes[0].transform).toBe('translateY(8px)')
    expect(a.keyframes.at(-1)).toMatchObject({ transform: 'none', opacity: '1' })
    expect(before.playState).toBe('idle')
    expect(flash.playState).toBe('running')
    expect(a.options.duration).toBe(SPRING_MS)
    // `to` stays when it ends, and nothing else is written.
    el.style.transform = ''
    a.finish()
    expect(el.style.transform).toBe('none')
    expect(el.style.opacity).toBe('1')
    // Held no longer: a later class change shows.
    expect(a.options.fill).toBe('none')
    el.remove()
  })

  it('under Reduce motion it applies the end state at once', () => {
    document.documentElement.dataset.reduceMotion = 'true'
    const el = document.createElement('div')
    const a = animateFrom(el, { opacity: '0' }) as unknown as FakeAnimation
    expect(a.options.duration).toBe(0)
    a.finish()
    expect(el.style.opacity).toBe('0')
    expect(el.style.transform).toBe('')
  })
})

describe('the spring', () => {
  it('never overshoots and settles within 0.1 % over --motion-spring', () => {
    const stops = springLinear().slice('linear('.length, -1).split(', ').map(Number)
    expect(stops).toHaveLength(20)
    stops.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(stops[i]))
    expect(Math.max(...stops)).toBe(1)
    expect(1 - springAt(SPRING_MS / 1000)).toBeLessThan(0.001)
  })

  it('tokens.css carries the curve springLinear() computes, over the same time', () => {
    // Vitest runs from the kit's root (its config is there).
    const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')
    expect(tokens).toContain(`--ease-spring: ${springLinear()};`)
    expect(tokens).toContain(`--motion-spring: ${SPRING_MS}ms;`)
    // The stand-ins where the CSS is not loaded are the tokens' own values.
    expect(tokens).toContain(`--ease-out: ${FALLBACK_EASING};`)
    expect(tokens).toContain(`--motion-count: ${FALLBACK_MS['--motion-count']}ms;`)
    expect(tokens).toContain(`--motion-spring: ${FALLBACK_MS['--motion-spring']}ms;`)
  })
})
