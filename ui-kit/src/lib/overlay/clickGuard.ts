/** Wider than any system's double-click box (Windows 4 px, GTK 5 px), in CSS px. */
const SAME_SPOT = 8

export type FollowUpOptions = {
  /** How long the guard waits for the second click, ms. */
  ms?: number
  /** Runs once, on the second press itself, in place of whatever it lands
   *  on: a list row's double-click edits the cell the first click named,
   *  even when the first click moved the layout under the pointer. */
  onFollow?: () => void
}

/**
 * After a pointer click that closed its surface at once (a menu item, a list
 * option) or moved the layout under the pointer (a list row that opened a
 * side panel), the second click of a double click is not a new choice: for
 * `ms` it reaches nothing (EMIL-01), and `onFollow` runs instead. Pass the
 * first click: the second press is the mouse press the system counts as
 * click 2, near that point. Its pointer events go too, not only its mouse
 * events, or an outside-press dismissal (which listens to `pointerdown`)
 * closes what the first click opened. A fresh click (count 1) passes and
 * ends the guard: the double click did not happen.
 */
export function swallowFollowUpClick(first: { clientX: number; clientY: number }, options: number | FollowUpOptions = 500): void {
  if (typeof window === 'undefined') return
  const { ms = 500, onFollow } = typeof options === 'number' ? { ms: options } : options
  let followed = false
  const types = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick'] as const
  function stop(event: Event) {
    const e = event as PointerEvent
    const pointer = e.type === 'pointerdown' || e.type === 'pointerup'
    // Pointer events carry no click count: the place tells.
    const follow = pointer
      ? e.pointerType === 'mouse' && Math.hypot(e.clientX - first.clientX, e.clientY - first.clientY) <= SAME_SPOT
      : e.detail >= 2
    if (!follow) {
      if (e.type === 'mousedown') end()
      return
    }
    // A cancelled pointerdown would hold back the mousedown that carries the
    // click count (and `onFollow`): the pointer events are only stopped.
    if (!pointer) e.preventDefault()
    e.stopPropagation()
    if (e.type === 'mousedown' && !followed) {
      followed = true
      onFollow?.()
    }
  }
  function end() { for (const t of types) window.removeEventListener(t, stop, true) }
  // On window, in capture: before any listener on the document or below it,
  // whenever that listener was added (the opened surface adds its own later).
  for (const t of types) window.addEventListener(t, stop, true)
  setTimeout(end, ms)
}
