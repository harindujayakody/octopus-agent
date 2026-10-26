import { useEffect, useLayoutEffect, useRef } from 'react'
import { cn } from '../cn'
import { prefersReducedMotion } from '../overlay/usePresence'
import { springTiming, trackMotion } from './spring'

/** A number on the tape besides the current one: `line` lines below it (+) or above it (-). */
type Copy = { n: number; line: number; el: HTMLSpanElement }

/** The track's vertical offset on screen now, mid-animation too. */
function offsetY(el: HTMLElement): number {
  const t = getComputedStyle(el).transform
  return !t || t === 'none' || typeof DOMMatrixReadOnly === 'undefined' ? 0 : new DOMMatrixReadOnly(t).m42
}

/** `translateY(calc(<px> ± <lines * 100>%))`: `lines` of the track's own height from `px`. */
const offset = (px: number, lines: number) => `translateY(calc(${px}px ${lines < 0 ? '-' : '+'} ${Math.abs(lines) * 100}%))`

/**
 * A live count (Live layer, spec 6.2): on a change the old number rolls out
 * and the new one rolls in, vertically and clipped, over `--motion-count` on
 * the spring. Under Reduce motion it swaps at once.
 *
 * The numbers sit on a short tape, one line apart, and only the tape moves.
 * A change mid-roll never queues a second roll and never turns one around:
 * every number on screen stays exactly where it is, the newest joins the
 * tape (where it already shows, or next to the numbers on screen, on the
 * side the count moved), and the tape rolls from there until the newest sits
 * on its line. So no number jumps, drifts, snaps or swaps its digits in
 * sight, however often the count changes (review I2).
 *
 * The number itself is plain text in the flow, so its width, the text and
 * the accessibility tree always hold the current value; the others are
 * hidden copies beside it for the length of a roll. Changes are not
 * announced (`aria-live="off"`).
 */
export function CountRoll({ value, className }: { value: number; className?: string }) {
  const trackRef = useRef<HTMLSpanElement>(null)
  const tapeRef = useRef<HTMLSpanElement>(null)
  const shown = useRef(value)
  const roll = useRef<Animation | null>(null)
  const copies = useRef<Copy[]>([])

  useLayoutEffect(() => {
    const prev = shown.current
    shown.current = value
    const track = trackRef.current
    const tape = tapeRef.current
    if (prev === value || !track || !tape) return
    const clear = () => {
      for (const c of copies.current) c.el.remove()
      copies.current = []
    }
    // Read before the running roll stops: where the numbers are on screen now.
    const y = roll.current ? offsetY(track) : 0
    roll.current?.cancel()
    roll.current = null
    if (prefersReducedMotion()) {
      clear()
      return
    }

    // The tape as it stands: the number in the flow (line 0, at y) and the
    // copies. A number the clip hides whole goes (no layout, as in a unit
    // test: all stay).
    const h = track.offsetHeight
    const onScreen = (line: number) => h === 0 || Math.abs(y + line * h) < h
    const tapeNow = [{ n: prev, line: 0 }, ...copies.current.map(({ n, line }) => ({ n, line }))].filter((e) => onScreen(e.line))
    // Where the newest sits: where it already shows (the one nearest its
    // line), else one line past the numbers on screen, below them when the
    // count grew and above them when it fell.
    const same = tapeNow.filter((e) => e.n === value).sort((a, b) => Math.abs(y + a.line * h) - Math.abs(y + b.line * h))[0]
    const lines = tapeNow.map((e) => e.line)
    const at = same ? same.line : value > prev ? Math.max(0, ...lines) + 1 : Math.min(0, ...lines) - 1

    // Counted from the newest: it is in the flow now, and every other number
    // on screen is a copy at its own line, so nothing moves this frame.
    clear()
    for (const e of tapeNow) {
      if (e === same) continue
      const el = document.createElement('span')
      el.setAttribute('aria-hidden', 'true')
      el.className = 'absolute right-0'
      el.style.top = `${(e.line - at) * 100}%`
      el.textContent = String(e.n)
      tape.append(el)
      copies.current.push({ n: e.n, line: e.line - at, el })
    }

    const { easing, duration } = springTiming(getComputedStyle(track), '--motion-count')
    const animation = track.animate([{ transform: offset(y, at) }, { transform: 'translateY(0)' }], { duration, easing })
    animation.addEventListener('finish', () => {
      if (roll.current !== animation) return
      roll.current = null
      clear()
    })
    roll.current = animation
    trackMotion(animation)
  }, [value])

  useEffect(() => () => roll.current?.cancel(), [])

  return (
    <span data-count-roll="" aria-live="off" className={cn('inline-flex overflow-y-clip tabular-nums', className)}>
      <span ref={trackRef} className="relative">
        {/* The tape's other numbers, placed by the roll: never React's. */}
        <span ref={tapeRef} className="absolute inset-0" />
        {value}
      </span>
    </span>
  )
}
