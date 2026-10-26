import { prefersReducedMotion } from '../overlay/usePresence'

/**
 * The kit's one spring (Live layer, spec 6.3): critically damped, so it never
 * overshoots, with a 0.3 s response. Starting at rest, its position over time
 * is
 *
 *   x(t) = 1 - (1 + ωt) * e^(-ωt),   ω = 2π / response
 *
 * CSS runs it as `--ease-spring`: a `linear()` list of SPRING_STOPS samples of
 * x(t), evenly spaced over SPRING_MS, the time it takes to come within 0.1 %
 * of the end (x(0.45 s) = 0.9991), pasted into tokens.css next to
 * `--motion-spring`. motion.test.tsx checks the paste against springLinear().
 * It is 97 % of the way at 250 ms: the tail is sub-pixel.
 */
export const SPRING_RESPONSE = 0.3
export const SPRING_MS = 450
export const SPRING_STOPS = 20

/** The spring's position (0 to 1) `t` seconds after it starts. */
export function springAt(t: number, response = SPRING_RESPONSE): number {
  const wt = ((2 * Math.PI) / response) * t
  return 1 - (1 + wt) * Math.exp(-wt)
}

/** The spring as a CSS `linear()` easing over SPRING_MS: the source of `--ease-spring`. */
export function springLinear(stops = SPRING_STOPS): string {
  const at = (i: number) => (i === stops - 1 ? 1 : +springAt((SPRING_MS / 1000) * (i / (stops - 1))).toFixed(3))
  return `linear(${Array.from({ length: stops }, (_, i) => at(i)).join(', ')})`
}

// Where the kit's CSS is not loaded (unit tests), the tokens' own values: the
// ease-out curve stands in for the spring, as it does where linear() is not
// supported. motion.test.tsx checks them against tokens.css.
export const FALLBACK_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)'
export const FALLBACK_MS = { '--motion-spring': SPRING_MS, '--motion-count': 200 } as const

function ms(value: string): number | undefined {
  const v = value.trim()
  const n = Number.parseFloat(v)
  if (Number.isNaN(n)) return undefined
  return v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : undefined
}

/** The spring's easing and a duration token as the element resolves them. */
export function springTiming(
  style: CSSStyleDeclaration,
  duration: keyof typeof FALLBACK_MS = '--motion-spring',
): { easing: string; duration: number } {
  return {
    easing: style.getPropertyValue('--ease-spring').trim() || FALLBACK_EASING,
    duration: ms(style.getPropertyValue(duration)) ?? FALLBACK_MS[duration],
  }
}

// Reduce motion switched on (the OS, or Settings writing data-reduce-motion on
// <html>) while something moves: every running kit animation jumps to its end
// at once (Review Focus 4). CSS animations stop through the `reduced` variant.
const running = new Set<Animation>()
let watching = false

function watchReducedMotion() {
  if (watching || typeof document === 'undefined') return
  watching = true
  const settle = () => {
    if (prefersReducedMotion()) for (const a of [...running]) a.finish()
  }
  new MutationObserver(settle).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-reduce-motion'],
  })
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', settle)
}

/** Registers a kit animation so Reduce motion can end it; returns it. */
export function trackMotion(animation: Animation): Animation {
  watchReducedMotion()
  running.add(animation)
  const drop = () => running.delete(animation)
  animation.addEventListener('finish', drop)
  animation.addEventListener('cancel', drop)
  return animation
}

/** Whether an animation's keyframes touch transform or opacity (unknown: yes). */
function movesOrFades(a: Animation): boolean {
  const frames = (a.effect as KeyframeEffect | null)?.getKeyframes?.()
  return !frames || frames.some((k) => 'transform' in k || 'opacity' in k)
}

/**
 * Moves an element with the spring from wherever it is on screen now: reads
 * its current `transform` and `opacity` (mid-animation too), cancels what
 * moves or fades it, and animates from there to `to`, so a second call redirects
 * the motion without a jump. `to` stays on the element when it ends (in its
 * inline style); a property `to` leaves out settles back to its rest value.
 * Under Reduce motion it applies the end state at once. Only `transform` and
 * `opacity` are read back: animate those, which the compositor runs off the
 * main thread.
 */
export function animateFrom(el: HTMLElement, to: Keyframe, opts: { duration?: number } = {}): Animation {
  const style = getComputedStyle(el)
  const from: Keyframe = { transform: style.transform, opacity: style.opacity }
  // Only what moves or fades it: a flash or a fill fade on it plays on.
  for (const a of el.getAnimations?.() ?? []) if (movesOrFades(a)) a.cancel()
  // The live style now reads the rest values.
  const end: Keyframe = { transform: style.transform, opacity: style.opacity, ...to }
  const reduced = prefersReducedMotion()
  const timing = springTiming(style)
  const animation = el.animate([from, end], {
    duration: reduced ? 0 : (opts.duration ?? timing.duration),
    easing: timing.easing,
    fill: 'forwards',
  })
  animation.addEventListener('finish', () => {
    const inline = el.style as unknown as Record<string, string>
    for (const [name, value] of Object.entries(to)) {
      if (name !== 'offset' && name !== 'easing' && name !== 'composite' && value != null) inline[name] = String(value)
    }
    // Held no longer, so a later class or style change shows; it stays
    // finished, so `.finished` stays resolved.
    animation.effect?.updateTiming({ fill: 'none' })
  })
  return reduced ? animation : trackMotion(animation)
}
