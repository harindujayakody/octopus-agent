/** What the person used last. A surface opened from the keyboard fades
 *  only; one opened by the pointer also grows from its trigger (ANIM-07). */
export type InputKind = 'keyboard' | 'pointer'

let last: InputKind = 'pointer'
let lastKey = ''

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => { last = 'keyboard'; lastKey = e.key }, true)
  document.addEventListener('pointerdown', () => { last = 'pointer'; lastKey = '' }, true)
}

/** What the user used last; a surface reads it when it opens. */
export const lastInput = (): InputKind => last

const NAVIGATION = /^(Tab|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|F6)$/
/** The last key moved focus on purpose (Tab, an arrow, Home, End, PageUp,
 *  PageDown, F6), not a key that opened or closed something. */
export const lastKeyNavigated = (): boolean => last === 'keyboard' && NAVIGATION.test(lastKey)

// Where the pointer was at its last move (client px), or null before one.
// Only moves count: a press lands where the last move left the pointer.
let pointerAt: { x: number; y: number } | null = null
// The move before it: a move handler reads it, the listener having run first.
let pointerBefore: { x: number; y: number } | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('pointermove', (e) => { pointerBefore = pointerAt; pointerAt = { x: e.clientX, y: e.clientY } }, { capture: true, passive: true })
}

/** Whether two points lie within a px of each other (layout rounding). */
export const samePoint = (a: { x: number; y: number }, b: { clientX: number; clientY: number }): boolean =>
  Math.abs(b.clientX - a.x) < 1 && Math.abs(b.clientY - a.y) < 1

/** A pointer arriving (`pointerenter`) where the pointer already was: the
 *  layout moved under a still pointer, or something mounted there. A real
 *  move arrives before the move event that records it, so it reads the
 *  place the pointer came from. Before any move, every arrival is real. */
export const pointerStill = (e: { clientX: number; clientY: number }): boolean =>
  pointerAt !== null && Number.isFinite(e.clientX) && Number.isFinite(e.clientY) && samePoint(pointerAt, e)

/** A `pointermove` at the exact place of the move before it: no move. WebKit
 *  sends one when a list scrolls under a still pointer (the keys scrolled it). */
export const pointerMoveStill = (e: { clientX: number; clientY: number }): boolean =>
  pointerBefore !== null && pointerBefore.x === e.clientX && pointerBefore.y === e.clientY
