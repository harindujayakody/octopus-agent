import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { composite, contrast, parseColor } from "./support/color";

// Owner item 10 (2026-10-07): in dark, the proxy picker "blends into" the
// list behind it. A popover, menu or select list has its own surface token
// (`--bg-popover`): white in light, at least 0.04 OKLCH lighter than the list
// tile in dark. No border is added; the surface and the shadow do the work.

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const cellOf = (page: Page, name: string, id: string) => row(page, name).locator(`[data-cell='${id}']`);

/** OKLab lightness of an sRGB color in 0-255. */
function lightness([r, g, b]: number[]): number {
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/** The list tile as it paints: its fill over the page behind it. */
const tileColor = (page: Page) => page.evaluate(() => {
  const tile = document.querySelector(".list-tile")!;
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const x = c.getContext("2d")!;
  for (const l of [getComputedStyle(document.querySelector("main")!).backgroundColor, getComputedStyle(tile).backgroundColor]) {
    x.fillStyle = l;
    x.fillRect(0, 0, 1, 1);
  }
  return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3);
});
const surfaceColor = async (el: Locator) => parseColor(await el.evaluate((node) => getComputedStyle(node).backgroundColor)).slice(0, 3);

const openProxyPicker = async (page: Page) => {
  const proxy = cellOf(page, "Sandbox", "proxy");
  await proxy.hover({ position: { x: 4, y: 18 } });
  await proxy.getByRole("button", { name: "Edit proxy for Sandbox" }).click();
  const picker = page.getByRole("dialog", { name: "Proxy" });
  await expect(picker).toBeVisible();
  return picker;
};

test("dark: the proxy picker's surface is a lighter step than the list tile", async ({ page }) => {
  await openApp(page, { theme: "dark" });
  const tile = await tileColor(page);
  const picker = await openProxyPicker(page);
  const surface = await surfaceColor(picker);
  expect(surface).not.toEqual(tile);
  expect(lightness(surface) - lightness(tile)).toBeGreaterThanOrEqual(0.04);
  // No border is added to get there.
  expect(await picker.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");
});

test("dark: a menu opened from a cell has the same lighter surface", async ({ page }) => {
  await openApp(page, { theme: "dark" });
  const tile = await tileColor(page);
  const folder = cellOf(page, "Sandbox", "folder");
  await folder.hover({ position: { x: 4, y: 18 } });
  await folder.getByRole("button", { name: "Add folder for Sandbox" }).click();
  const menu = page.getByRole("menu", { name: "Folder for Sandbox" });
  await expect(menu).toBeVisible();
  expect(lightness(await surfaceColor(menu)) - lightness(tile)).toBeGreaterThanOrEqual(0.04);
});

test("light: the picker stays white", async ({ page }) => {
  await openApp(page, { theme: "light" });
  const picker = await openProxyPicker(page);
  expect(await surfaceColor(picker)).toEqual([255, 255, 255]);
});

// Review I1: the highlight (white 5%) lies under a chip's tint on the lighter
// popover, so the chip's text takes more ink there (--label-chip-text-highlight).
test("dark: a Folder chip on the highlighted menu row keeps 4.5:1 text", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.folderMeta", JSON.stringify({ Ads: { color: "blue", icon: "folder" } })));
  await openApp(page, { theme: "dark" });
  const folder = cellOf(page, "Sandbox", "folder");
  await folder.hover({ position: { x: 4, y: 18 } });
  await folder.getByRole("button", { name: "Add folder for Sandbox" }).click();
  const menu = page.getByRole("menu", { name: "Folder for Sandbox" });
  const item = menu.getByRole("menuitemradio", { name: "Ads" });
  await item.hover();
  await expect.poll(() => item.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  const chip = item.locator(".label-chip");
  await expect(chip).toBeVisible();
  const { popover, row, tint, text } = await item.evaluate((el) => {
    const chip = el.querySelector(".label-chip")!;
    return {
      popover: getComputedStyle(el.closest("[role='menu']")!).backgroundColor,
      row: getComputedStyle(el).backgroundColor,
      tint: getComputedStyle(chip).backgroundColor,
      text: getComputedStyle(chip).color,
    };
  });
  const popoverRgb = parseColor(popover).slice(0, 3) as [number, number, number];
  const onRow = composite(parseColor(row), popoverRgb);
  const onTint = composite(parseColor(tint), onRow);
  expect(contrast(parseColor(text).slice(0, 3) as [number, number, number], onTint)).toBeGreaterThanOrEqual(4.5);
});
