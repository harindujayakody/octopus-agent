import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Owner item 10: in dark, a popover, menu or select list blended into the
// list behind it (both were #222222). The popover has its own surface token.

const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')

/** Every `--name: #rrggbb` declaration of that name, in file order (light block first, then dark). */
const hexes = (name: string) => [...css.matchAll(new RegExp(`(?<![\\w-])${name}:\\s*(#[0-9a-fA-F]{6})\\b`, 'g'))].map((m) => m[1])

/** OKLab lightness of an sRGB hex. */
function lightness(hex: string): number {
  const lin = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [lin(0), lin(1), lin(2)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
}

describe('popover surface (clarity fixes, item 10)', () => {
  it('has one value per theme: white in light, a lighter step than the list tile in dark', () => {
    expect(hexes('--bg-popover')).toHaveLength(2)
    const [light] = hexes('--bg-popover')
    expect(light.toLowerCase()).toBe('#ffffff')
  })

  it('dark: the popover is at least 0.04 OKLCH lighter than the list tile', () => {
    const [, popover] = hexes('--bg-popover')
    const [, tile] = hexes('--bg-tile')
    expect(tile.toLowerCase()).toBe('#222222')
    expect(lightness(popover) - lightness(tile)).toBeGreaterThanOrEqual(0.04)
  })

  it('dark: the popover is lighter than the hovered row on a tile, not equal to it', () => {
    const [, popover] = hexes('--bg-popover')
    const [, hover] = hexes('--bg-row-hover-tile')
    expect(lightness(popover) - lightness(hover)).toBeGreaterThanOrEqual(0.02)
  })

  it('is available as a utility (bg-bg-popover)', () => {
    expect(css).toMatch(/--color-bg-popover:\s*var\(--bg-popover\)/)
  })
})
