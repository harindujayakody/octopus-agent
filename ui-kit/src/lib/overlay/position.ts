import { useLayoutEffect, useState } from 'react'
import { layoutRect, layoutViewport, pageZoom, pointerToLayout } from './zoom'

export type Side = 'top' | 'bottom' | 'left' | 'right'
export type Align = 'start' | 'center' | 'end'
export type Point = { x: number; y: number }
export type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }
export type Position = { x: number; y: number; side: Side }

const MARGIN = 8
const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

/** Where a floating box of `size` goes next to `anchor`, flipped and clamped to the viewport. */
export function computePosition(
  anchor: Rect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  side: Side,
  align: Align,
  offset: number,
): Position {
  const fits = (s: Side) =>
    s === 'bottom' ? anchor.bottom + offset + size.height <= viewport.height - MARGIN
    : s === 'top' ? anchor.top - offset - size.height >= MARGIN
    : s === 'right' ? anchor.right + offset + size.width <= viewport.width - MARGIN
    : anchor.left - offset - size.width >= MARGIN
  const room = (s: Side) =>
    s === 'bottom' ? viewport.height - anchor.bottom
    : s === 'top' ? anchor.top
    : s === 'right' ? viewport.width - anchor.right
    : anchor.left
  // The requested side if it fits, else the opposite if that fits, else
  // whichever side has more room.
  const opposite = OPPOSITE[side]
  const chosen = fits(side) ? side : fits(opposite) ? opposite : room(side) >= room(opposite) ? side : opposite

  let x: number
  let y: number
  if (chosen === 'top' || chosen === 'bottom') {
    y = chosen === 'bottom' ? anchor.bottom + offset : anchor.top - offset - size.height
    x = align === 'start' ? anchor.left
      : align === 'end' ? anchor.right - size.width
      : anchor.left + anchor.width / 2 - size.width / 2
  } else {
    x = chosen === 'right' ? anchor.right + offset : anchor.left - offset - size.width
    y = align === 'start' ? anchor.top
      : align === 'end' ? anchor.bottom - size.height
      : anchor.top + anchor.height / 2 - size.height / 2
  }
  x = Math.max(MARGIN, Math.min(x, viewport.width - size.width - MARGIN))
  y = Math.max(MARGIN, Math.min(y, viewport.height - size.height - MARGIN))
  return { x, y, side: chosen }
}

type Anchor = React.RefObject<HTMLElement | null> | Point

/** Tracks the position of `floatingRef` next to an element or a point while `open`. A point is a pointer position (clientX/Y); one read off a rect goes through `layoutToPointer` first. */
export function useFloatingPosition(
  anchor: Anchor,
  floatingRef: React.RefObject<HTMLElement | null>,
  { open, side = 'bottom', align = 'start', offset = 6 }: { open: boolean; side?: Side; align?: Align; offset?: number },
): Position | null {
  const [pos, setPos] = useState<Position | null>(null)
  const isPoint = !('current' in anchor)
  const px = isPoint ? (anchor as Point).x : null
  const py = isPoint ? (anchor as Point).y : null
  const ref = isPoint ? null : (anchor as React.RefObject<HTMLElement | null>)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const update = () => {
      const el = floatingRef.current
      if (!el) return
      // Layout px throughout, so the box lands at its anchor under CSS zoom.
      // A point is a pointer's (viewport px); a rect is at the rect scale.
      const rect: Rect | undefined =
        px !== null && py !== null
          ? (() => { const p = pointerToLayout({ x: px, y: py }); return { left: p.x, top: p.y, right: p.x, bottom: p.y, width: 0, height: 0 } })()
          : ref?.current
            ? layoutRect(ref.current)
            : undefined
      if (!rect) return
      const next = computePosition(
        rect,
        { width: el.offsetWidth, height: el.offsetHeight },
        layoutViewport(pageZoom()),
        side,
        align,
        offset,
      )
      setPos((prev) => (prev && prev.x === next.x && prev.y === next.y && prev.side === next.side ? prev : next))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    // Content that grows or shrinks (a filtered list) and a trigger that
    // changes size both move the box.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (floatingRef.current) observer?.observe(floatingRef.current)
    if (ref?.current) observer?.observe(ref.current)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer?.disconnect()
    }
  }, [open, px, py, ref, side, align, offset, floatingRef])

  return pos
}

/** The corner a floating box grows from: the side it opened on and its
 *  alignment (FEEL-15). A CSS `transform-origin`. */
export function originFor(side: Side | undefined, align: Align): string {
  const s = side ?? 'bottom'
  if (s === 'top' || s === 'bottom') {
    const x = align === 'start' ? 'left' : align === 'end' ? 'right' : 'center'
    return `${s === 'bottom' ? 'top' : 'bottom'} ${x}`
  }
  const y = align === 'start' ? 'top' : align === 'end' ? 'bottom' : 'center'
  return `${s === 'right' ? 'left' : 'right'} ${y}`
}
