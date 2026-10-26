import type { Point, Rect } from './position'

// An app may scale its UI with CSS `zoom` on <html> (the launcher's Interface
// size). Inside a zoomed page, style.left/top and offset sizes are layout px;
// the viewport (innerWidth) and pointer positions (clientX/Y) are viewport px
// on every engine. Client rects are viewport px on engines with standardized
// CSS zoom (Chromium 128+), but come back zoom-adjusted (already layout px) on
// older ones (older WKWebView). So a pointer converts with pageZoom(), a rect
// with clientScale(), and a pointer compared with a rect converts each side on
// its own first. These helpers put everything in layout px, whichever it is.

/** The CSS zoom on <html>; 1 when unset. */
export function pageZoom(): number {
  if (typeof document === 'undefined') return 1
  const z = Number.parseFloat(getComputedStyle(document.documentElement).zoom)
  return Number.isFinite(z) && z > 0 ? z : 1
}

/** How much larger client rects are than layout px. Measured on <html>, which has no transform. Never use it on a pointer: see pointerToLayout. */
export function clientScale(): number {
  if (typeof document === 'undefined') return 1
  const el = document.documentElement
  const layout = el.offsetWidth
  const client = el.getBoundingClientRect().width
  return layout > 0 && client > 0 ? client / layout : 1
}

/** A client rect in layout px. */
export const rectToLayout = (r: Rect, k: number): Rect => ({
  left: r.left / k,
  top: r.top / k,
  right: r.right / k,
  bottom: r.bottom / k,
  width: r.width / k,
  height: r.height / k,
})

/** A client point in layout px, at scale `k`. */
export const pointToLayout = (p: Point, k: number): Point => ({ x: p.x / k, y: p.y / k })

/** A pointer position (clientX/Y) in layout px: viewport px, so it divides by the page zoom, not the rect scale. */
export const pointerToLayout = (p: Point): Point => pointToLayout(p, pageZoom())

/** An element's client rect in layout px, at whatever scale this engine reports rects. */
export const layoutRect = (el: Element): Rect => rectToLayout(el.getBoundingClientRect(), clientScale())

/** A layout point as a pointer position: what a point anchor (a context menu's) takes. */
export const layoutToPointer = (p: Point): Point => {
  const z = pageZoom()
  return { x: p.x * z, y: p.y * z }
}

/** The viewport in layout px. */
export const layoutViewport = (zoom: number, view = { width: window.innerWidth, height: window.innerHeight }) => ({
  width: view.width / zoom,
  height: view.height / zoom,
})
