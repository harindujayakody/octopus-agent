import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, reloadApp, type Theme } from "./support/app";

// Owner feedback 5p (2026-09-26): a hovered Fingerprint card must never go
// page-gray ("on hover it goes grey like the background"). Borderless, step 2
// (owner, 2026-10-01): a card is a tile, the weak fill with no border, no
// shadow and no lift; the grid item is the tile, and its hover is one fill
// step (the active fill). Every comparison composites a translucent color
// over its real backdrop first (a translucent fill is never string-equal to an
// opaque one), and compares the composited color.

/** OKLab -> linear sRGB -> sRGB (Björn Ottosson's matrices, CSS Color 4). */
function oklabToSrgb255(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const toSrgb = (c: number) => { const cc = Math.min(Math.max(c, 0), 1); return cc <= 0.0031308 ? 12.92 * cc : 1.055 * Math.pow(cc, 1 / 2.4) - 0.055; };
  return [toSrgb(r) * 255, toSrgb(g) * 255, toSrgb(bl) * 255];
}
/** Chromium can serialize a translucent color-mix/opacity-modifier result
 *  (e.g. Tailwind's `white/5`) as `oklab(L a b / A)`, not `rgb()` — parse
 *  whichever form the browser hands back. */
function parseColor(s: string): [number, number, number, number] {
  const oklab = s.match(/oklab\(([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
  if (oklab) {
    const [L, a, b] = [parseFloat(oklab[1]), parseFloat(oklab[2]), parseFloat(oklab[3])];
    const alpha = oklab[4] !== undefined ? parseFloat(oklab[4]) : 1;
    return [...oklabToSrgb255(L, a, b), alpha];
  }
  const m = s.match(/[\d.]+/g)!.map(Number);
  return [m[0], m[1], m[2], m[3] ?? 1];
}
/** Composites `fg` (possibly translucent) over an opaque `bg`. */
function composite(fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] {
  const [r, g, b, a] = fg;
  return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
}
const same = (a: [number, number, number], b: [number, number, number]) =>
  Math.round(a[0]) === Math.round(b[0]) && Math.round(a[1]) === Math.round(b[1]) && Math.round(a[2]) === Math.round(b[2]);

async function bgOf(locator: Locator): Promise<[number, number, number, number]> {
  return parseColor(await locator.evaluate((el) => getComputedStyle(el).backgroundColor));
}
/** The first fully-opaque background actually painted behind `el`, climbing its ancestors. */
async function backdropOf(locator: Locator): Promise<[number, number, number]> {
  const rgb = await locator.evaluate((el) => {
    const alphaOf = (c: string) => { const a = c.match(/[\d.]+/g)?.[3]; return a === undefined ? 1 : Number(a); };
    let node: Element | null = el.parentElement;
    while (node) {
      const c = getComputedStyle(node).backgroundColor;
      if (alphaOf(c) >= 1) return c;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  });
  return parseColor(rgb).slice(0, 3) as [number, number, number];
}

async function runFingerprintCard(page: Page, theme: Theme) {
  await openApp(page, { theme, section: "fingerprints" });
  // F27 (CRAFT-30): a card names its Chrome only when it is not the engine's
  // own. Every fingerprint here gets another one, so the gray badge shows.
  await page.evaluate(() => {
    const m = (window as unknown as { __shardxMock: { state: { fingerprints: { chrome: string }[] }; save: () => void } }).__shardxMock;
    for (const f of m.state.fingerprints) f.chrome = "151.0.7922.34";
    m.save();
  });
  await reloadApp(page);
  const card = page.locator("[data-fingerprint-id]").first();
  // The grid item round the card is the tile.
  const tile = page.locator("main [role='listitem']").first();
  const panel = await backdropOf(tile);
  const at = async () => composite(await bgOf(tile), panel);
  const rest = await at();
  const restEdge = await tile.evaluate((el) => { const cs = getComputedStyle(el); return { borders: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth], shadow: cs.boxShadow, transform: cs.transform }; });
  // Borderless: no border, no transform at rest, and only the tile's resting
  // shadow (vf-c's light flip, merge point 12: the softest one in light, none in dark).
  const tileShadow = await tile.evaluate((el) => {
    const probe = document.createElement("div");
    probe.style.boxShadow = "var(--tile-shadow, var(--shadow-tile))";
    el.parentElement!.appendChild(probe);
    const v = getComputedStyle(probe).boxShadow;
    probe.remove();
    return v;
  });
  expect(restEdge.borders, `${theme}: tile border widths`).toEqual(["0px", "0px", "0px", "0px"]);
  expect(restEdge.shadow, `${theme}: tile shadow`).toBe(tileShadow);
  // The card inside is content only: no border and no fill of its own.
  expect(await card.evaluate((el) => [getComputedStyle(el).borderTopWidth, getComputedStyle(el).backgroundColor]), `${theme}: the card inside has no frame or fill`).toEqual(["0px", "rgba(0, 0, 0, 0)"]);

  await tile.hover();
  await page.waitForTimeout(250); // the fill transition settles
  const hovered = await at();
  const hoveredEdge = await tile.evaluate((el) => { const cs = getComputedStyle(el); return { shadow: cs.boxShadow, transform: cs.transform, border: cs.borderTopWidth }; });

  // One fill step: never the page color, composited, in either theme.
  expect(same(hovered, panel), `${theme}: hovered card vs the panel`).toBe(false);
  expect(same(hovered, rest), `${theme}: the hover steps the fill`).toBe(false);
  // No lift: the same resting shadow, no movement, no border.
  expect(hoveredEdge, `${theme}: no lift on hover`).toEqual({ shadow: tileShadow, transform: "none", border: "0px" });

  // A card with a "Chrome ..." badge: the first macOS card always has one,
  // asserted directly, not behind an `if`. It must not melt into the hovered fill.
  const badge = card.getByText(/^Chrome /);
  await expect(badge).toBeVisible();
  expect(same(composite(await bgOf(badge), hovered), hovered), `${theme}: badge bg vs hovered card bg`).toBe(false);
}

test("Fingerprint cards step their fill on hover with no lift, border or shadow, light theme", async ({ page }) => { await runFingerprintCard(page, "light"); });
test("Fingerprint cards step their fill on hover with no lift, border or shadow, dark theme", async ({ page }) => { await runFingerprintCard(page, "dark"); });
