import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientScale, layoutRect, layoutToPointer, layoutViewport, pageZoom, pointerToLayout, pointToLayout, rectToLayout } from './zoom'

afterEach(() => vi.restoreAllMocks())

describe('zoom helpers (Interface size, O15)', () => {
  it('with no zoom everything is already layout px', () => {
    expect(pageZoom()).toBe(1)
    expect(clientScale()).toBe(1)
  })

  it('client rects and pointers divide by the client scale', () => {
    expect(rectToLayout({ left: 125, top: 250, right: 250, bottom: 275, width: 125, height: 25 }, 1.25))
      .toEqual({ left: 100, top: 200, right: 200, bottom: 220, width: 100, height: 20 })
    expect(pointToLayout({ x: 150, y: 75 }, 1.5)).toEqual({ x: 100, y: 50 })
  })

  it('the viewport in layout px shrinks by the zoom', () => {
    expect(layoutViewport(1.25, { width: 1280, height: 800 })).toEqual({ width: 1024, height: 640 })
  })

  it('reads the zoom of <html> and the scale of its client rect', () => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ zoom: '1.25' } as CSSStyleDeclaration)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1024)
    vi.spyOn(document.documentElement, 'getBoundingClientRect').mockReturnValue({ width: 1280 } as DOMRect)
    expect(pageZoom()).toBe(1.25)
    expect(clientScale()).toBe(1.25)
  })
})

// Task 14 review, Important 2: pointers and rects can sit in different spaces.
// Pointers (clientX/Y) are viewport px on every engine. Rects are viewport px
// on standardized CSS zoom (Chromium 128+), but an engine from before it
// (older WKWebView) hands them back zoom-adjusted, already in layout px. So a
// pointer divides by the page zoom, a rect by the rect scale, and a pointer
// compared with a rect lands in the same layout px either way.
describe('pointer and rect in the same layout px (Important 2)', () => {
  // An element at layout x 100 to 200, zoom 1.25; the pointer over its middle
  // (layout 150) is at viewport x 187.5 on both engines.
  const setup = (rectsScaled: boolean) => {
    const k = rectsScaled ? 1.25 : 1
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ zoom: '1.25' } as CSSStyleDeclaration)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1024)
    vi.spyOn(document.documentElement, 'getBoundingClientRect').mockReturnValue({ width: 1024 * k } as DOMRect)
    const el = document.createElement('div')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
      { left: 100 * k, top: 40 * k, right: 200 * k, bottom: 60 * k, width: 100 * k, height: 20 * k } as DOMRect,
    )
    return el
  }

  it('pre-standardized zoom (older WebKit): rects zoom-adjusted, the pointer not', () => {
    const el = setup(false)
    expect(clientScale()).toBe(1)
    const p = pointerToLayout({ x: 187.5, y: 62.5 })
    const r = layoutRect(el)
    expect(p).toEqual({ x: 150, y: 50 })
    expect(r).toEqual({ left: 100, top: 40, right: 200, bottom: 60, width: 100, height: 20 })
    expect(p.x - r.left).toBe(r.width / 2)
  })

  it('standardized zoom: rects and the pointer both in viewport px', () => {
    const el = setup(true)
    expect(clientScale()).toBe(1.25)
    const p = pointerToLayout({ x: 187.5, y: 62.5 })
    const r = layoutRect(el)
    expect(p).toEqual({ x: 150, y: 50 })
    expect(r).toEqual({ left: 100, top: 40, right: 200, bottom: 60, width: 100, height: 20 })
  })

  it('a layout point goes back to viewport px for a point anchor, like a pointer', () => {
    setup(false)
    expect(layoutToPointer({ x: 100, y: 60 })).toEqual({ x: 125, y: 75 })
    expect(pointerToLayout(layoutToPointer({ x: 100, y: 60 }))).toEqual({ x: 100, y: 60 })
  })
})
