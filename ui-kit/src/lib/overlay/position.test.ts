import { describe, expect, it } from 'vitest'
import { computePosition, originFor } from './position'

const vp = { width: 1000, height: 800 }
const anchor = (left: number, top: number, width = 100, height = 30) => ({
  left, top, width, height, right: left + width, bottom: top + height,
})

describe('computePosition', () => {
  it('places below the anchor, aligned to its start', () => {
    expect(computePosition(anchor(100, 100), { width: 200, height: 150 }, vp, 'bottom', 'start', 6))
      .toEqual({ x: 100, y: 136, side: 'bottom' })
  })

  it('flips to the top when there is no room below', () => {
    expect(computePosition(anchor(100, 700), { width: 200, height: 150 }, vp, 'bottom', 'start', 6))
      .toEqual({ x: 100, y: 544, side: 'top' })
  })

  it('keeps the requested side when neither side fits', () => {
    const r = computePosition(anchor(100, 300), { width: 200, height: 700 }, vp, 'bottom', 'start', 6)
    expect(r.side).toBe('bottom')
  })

  it('clamps into the viewport with an 8px margin', () => {
    const r = computePosition(anchor(950, 100), { width: 200, height: 100 }, vp, 'bottom', 'start', 6)
    expect(r.x).toBe(1000 - 200 - 8)
    const l = computePosition(anchor(-50, 100), { width: 200, height: 100 }, vp, 'bottom', 'start', 6)
    expect(l.x).toBe(8)
  })

  it('centers on the anchor', () => {
    expect(computePosition(anchor(400, 100), { width: 60, height: 20 }, vp, 'top', 'center', 6))
      .toEqual({ x: 420, y: 74, side: 'top' })
  })
})

describe('originFor', () => {
  it('grows from the trigger corner the box opened at', () => {
    expect(originFor('bottom', 'start')).toBe('top left')
    expect(originFor('bottom', 'end')).toBe('top right')
    expect(originFor('top', 'start')).toBe('bottom left')
    expect(originFor('top', 'center')).toBe('bottom center')
    expect(originFor('right', 'start')).toBe('left top')
    expect(originFor('left', 'center')).toBe('right center')
    expect(originFor(undefined, 'start')).toBe('top left')
  })
})
