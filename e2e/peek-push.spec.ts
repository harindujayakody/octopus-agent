import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { boxOf, type Box } from "./support/geometry";

// Clarity fixes, Task 1: the details panel (Peek) always pushes the list; it
// never lies over it. It is 420 px wide, or 360 px under 1280 layout px
// (Interface size counts). The list scrolls sideways inside its card when it
// is short of room; the page never does.

const peek = (page: Page) => page.locator("aside[data-peek]");
const head = (grid: Locator, id: string) => grid.locator("[role='row'][aria-rowindex='1']").locator(`[data-col='${id}']`);
const atSize = (page: Page, n: number) => page.addInitScript((v) => localStorage.setItem("shardx.interfaceSize", String(v)), n);
const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** Whole inside the card, on screen (Playwright's `toBeVisible` also passes for a cell scrolled out of its card). */
const within = (b: Box, card: Box) => b.x >= card.x - 1 && b.x + b.width <= card.x + card.width + 1;

/** Peek's left edge less the list card's right edge: 0 or more when the list is pushed, negative when Peek lies over it. */
const clearance = async (grid: Locator, panel: Locator) => {
  const card = await boxOf(grid);
  return (await boxOf(panel)).x - (card.x + card.width);
};

for (const [w, h, panelWidth] of [[1440, 900, 420], [1024, 680, 360]] as const) {
  test(`Profiles at ${w} x ${h}: the panel is ${panelWidth} px beside the list, which keeps Name, Status and Proxy`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openApp(page);
    await page.locator("[role='row'][data-profile-id]", { hasText: "Etsy craft shop" }).locator("[data-cell='name']").click();
    await expect(peek(page)).toBeVisible();
    const grid = page.getByRole("treegrid", { name: "Profiles" });
    // Pushed: the list's card ends where the panel starts.
    await expect.poll(() => clearance(grid, peek(page))).toBeGreaterThanOrEqual(-1);
    await expect.poll(async () => Math.round((await boxOf(peek(page))).width)).toBe(panelWidth);
    const card = await boxOf(grid);
    for (const id of ["name", "status", "proxy"]) {
      await expect(head(grid, id), id).toBeVisible();
      expect(within(await boxOf(head(grid, id)), card), `${id} header lies in the card`).toBe(true);
    }
    expect(await noPageScroll(page)).toBe(true);
  });
}

test("Profiles at 1024 x 680 and Interface size 125%: the panel still pushes the list, which keeps Name and Status and scrolls sideways inside its card, never the page (Review Focus 1)", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await atSize(page, 125);
  await openApp(page);
  await page.locator("[role='row'][data-profile-id]", { hasText: "Etsy craft shop" }).locator("[data-cell='name']").click();
  await expect(peek(page)).toBeVisible();
  const grid = page.getByRole("treegrid", { name: "Profiles" });
  await expect.poll(() => clearance(grid, peek(page))).toBeGreaterThanOrEqual(-1);
  // 819 layout px is under 1280: 360 layout px, 450 on the screen at 125%.
  await expect.poll(async () => Math.round((await boxOf(peek(page))).width)).toBe(450);
  const card = await boxOf(grid);
  // Name and Status stay in the card; Proxy is in the list, which scrolls
  // sideways inside the card to reach it (a card this narrow cannot show it
  // beside Name and Status).
  for (const id of ["name", "status"]) {
    expect(within(await boxOf(head(grid, id)), card), `${id} header lies in the card`).toBe(true);
  }
  await expect(head(grid, "proxy")).toBeVisible();
  expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await head(grid, "proxy").evaluate((el) => el.scrollIntoView({ inline: "nearest", block: "nearest" }));
  expect(await grid.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  // The list scrolled, never the page, and Peek stays beside the card.
  expect(await noPageScroll(page)).toBe(true);
  expect(await clearance(grid, peek(page))).toBeGreaterThanOrEqual(-1);
});

test("Proxies at 1024 x 680: the panel is 360 px beside the list, which keeps Name, Type and Host and port", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id]").first().locator("[data-cell='name']").click();
  await expect(peek(page)).toBeVisible();
  const grid = page.getByRole("treegrid", { name: "Proxies" });
  await expect.poll(() => clearance(grid, peek(page))).toBeGreaterThanOrEqual(-1);
  await expect.poll(async () => Math.round((await boxOf(peek(page))).width)).toBe(360);
  const card = await boxOf(grid);
  for (const id of ["name", "type", "address"]) {
    await expect(head(grid, id), id).toBeVisible();
    expect(within(await boxOf(head(grid, id)), card), `${id} header lies in the card`).toBe(true);
  }
  expect(await noPageScroll(page)).toBe(true);
});

test("Fingerprints at 1024 x 680: the panel is beside the grid too", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page, { section: "fingerprints" });
  await page.locator("[data-fingerprint-id]", { hasText: "Windows 11, Intel Arc A770" }).click();
  await expect(peek(page)).toBeVisible();
  await expect.poll(async () => Math.round((await boxOf(peek(page))).width)).toBe(360);
  // The grid ends where the panel starts: nothing of it lies under the panel.
  const panel = await boxOf(peek(page));
  const cards = await page.locator("[data-fingerprint-id]").evaluateAll(
    (els) => els.map((el) => el.getBoundingClientRect().right),
  );
  expect(Math.max(...cards)).toBeLessThanOrEqual(panel.x + 1);
  expect(await noPageScroll(page)).toBe(true);
});
