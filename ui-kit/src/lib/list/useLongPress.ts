import { useLayoutEffect, useMemo, useRef } from 'react'

/** How long a touch is held before it is a long press, ms: the platforms' own hold. */
export const LONG_PRESS_MS = 500
/** How far a held touch may drift, px, before it is a scroll or a drag instead. */
const SLOP = 10
/** A long press's own click and menu come right after it; later ones are not its. */
const FOLLOW_MS = 1000

type Press = { key: string; x: number; y: number; timer: number; firedAt: number | null }

export type LongPress = {
  /** The pointer handlers for one item (a row's id): spread them on it. */
  bind: (key: string) => {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: () => void
    onPointerCancel: () => void
  }
  /** True, once, when this item's press was a long one: the click after it
   *  is the press's own, and does nothing more. */
  took: (key: string) => boolean
  /** A context menu on an item while its touch is held, or right after a long
   *  press: the press's own (the platform opens one on a hold). It fires the
   *  long press if it has not yet, keeps the platform's menu shut, and says so. */
  claimMenu: (e: React.MouseEvent, key: string) => boolean
}

/// A long press on touch (selection mode, owner 2026-10-01): with no hover on
/// a touch screen, holding a row about 500 ms selects it, with a light
/// haptic where the platform has one. A mouse or a pen never long-presses;
/// a touch that drifts (a scroll, a drag) or lifts early is an ordinary tap.
/// One press at a time for a whole list, keyed by item, so a list that draws
/// its rows inline needs one hook, not one per row.
export function useLongPress(onLongPress: (key: string) => void): LongPress {
  const press = useRef<Press | null>(null)
  const latest = useRef(onLongPress)
  useLayoutEffect(() => {
    latest.current = onLongPress
  })
  useLayoutEffect(() => () => {
    if (press.current) window.clearTimeout(press.current.timer)
  }, [])

  return useMemo(() => {
    const clear = () => {
      if (press.current) window.clearTimeout(press.current.timer)
      press.current = null
    }
    const fire = () => {
      const p = press.current
      if (!p || p.firedAt !== null) return
      window.clearTimeout(p.timer)
      p.firedAt = performance.now()
      haptic()
      latest.current(p.key)
    }
    // A fired press counts only for what follows it at once.
    const firedFor = (key: string) => {
      const p = press.current
      return !!p && p.key === key && p.firedAt !== null && performance.now() - p.firedAt < FOLLOW_MS
    }
    return {
      bind: (key: string) => ({
        onPointerDown: (e: React.PointerEvent) => {
          clear()
          if (e.pointerType !== 'touch' || !e.isPrimary) return
          press.current = { key, x: e.clientX, y: e.clientY, timer: window.setTimeout(fire, LONG_PRESS_MS), firedAt: null }
        },
        onPointerMove: (e: React.PointerEvent) => {
          const p = press.current
          if (p && p.firedAt === null && p.key === key && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) clear()
        },
        onPointerUp: () => {
          if (press.current?.firedAt === null) clear()
        },
        onPointerCancel: () => {
          if (press.current?.firedAt === null) clear()
        },
      }),
      took: (key: string) => {
        if (!firedFor(key)) return false
        press.current = null
        return true
      },
      claimMenu: (e: React.MouseEvent, key: string) => {
        const p = press.current
        if (!p || p.key !== key || (p.firedAt !== null && !firedFor(key))) return false
        e.preventDefault()
        fire()
        return true
      },
    }
  }, [])
}

/** A light tap of the vibration motor, where there is one. Chrome refuses it,
 *  with a console warning, before the page has had a tap. */
function haptic() {
  const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
  if (typeof nav.vibrate !== 'function' || nav.userActivation?.hasBeenActive === false) return
  nav.vibrate(10)
}
