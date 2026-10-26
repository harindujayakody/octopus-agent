import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { openSearch } from "./support/search";

// Owner bug (2026-10-01), shown on the Profiles list (its Proxy column):
// "hovering the row dont need to make bottom border thicker", and "when
// mouse not hovering anymore it stuck like its hovering". The line under a
// row reads the same over every fill, and the target the pointer picked is
// drawn only while the pointer is on it (the keys still act on it, and draw
// it once they drive). Every list that shares the rows: Profiles, Proxies
// and the kit DataList (Bookmarks here).

/** The row's look: its own fill and its pinned cells' fills. */
const look = (r: Locator) => r.evaluate((el) => {
  const cs = getComputedStyle(el);
  const pins = [...el.querySelectorAll(":scope > .list-pin-check, :scope > .list-pin-end")]
    .map((c) => getComputedStyle(c, "::before").backgroundImage);
  return [cs.backgroundColor, cs.backgroundImage, ...pins].join(" | ");
});

/** The line under the row as it paints: the card, the row's fill, then the line's own layers. */
const line = (r: Locator) => r.evaluate((el) => {
  const card = getComputedStyle(el.closest("[class*='rounded-surface']") ?? document.body).backgroundColor;
  const row = getComputedStyle(el);
  const after = getComputedStyle(el, "::after");
  const first = (image: string) => image.match(/(?:rgba?|oklch|oklab|color)\([^)]*\)/)?.slice(0, 1) ?? [];
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const x = c.getContext("2d")!;
  for (const layer of [card, row.backgroundColor, ...first(row.backgroundImage), after.backgroundColor, ...first(after.backgroundImage)]) {
    x.fillStyle = layer;
    x.fillRect(0, 0, 1, 1);
  }
  return [...x.getImageData(0, 0, 1, 1).data].join(",");
});

async function pointerPicksThenLeaves(page: Page, r: Locator, cell: string) {
  const rest = await look(r);
  const restLine = await line(r);
  await r.locator(`[data-cell='${cell}']`).hover();
  await expect(r).toHaveAttribute("data-active", "true");
  // Under the pointer the target is drawn, and its line reads as at rest.
  expect(await look(r)).not.toBe(rest);
  expect(await line(r)).toBe(restLine);
  await page.mouse.move(1, 1);
  // Still the keys' target, but it looks like a row at rest.
  await expect(r).toHaveAttribute("data-active", "true");
  expect(await look(r)).toBe(rest);
  expect(await line(r)).toBe(restLine);
  return rest;
}

test("Profiles: a hovered row's line reads as at rest; once the pointer leaves, the row looks as at rest, and the keys draw their target", async ({ page }) => {
  await openApp(page, { theme: "light" });
  const r = page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" });
  const rest = await pointerPicksThenLeaves(page, r, "status");
  // The keys drive: their target is drawn where the pointer is not.
  await page.keyboard.press("ArrowDown");
  const target = page.locator("[role='row'][data-profile-id][data-active]");
  await expect(target).toBeFocused();
  expect(await look(target)).not.toBe(rest);
  // A click's focus leaves with the pointer too: no hover actions left behind.
  await r.locator("[data-cell='status']").click();
  await page.mouse.move(1, 1);
  await expect(r.locator("[data-hover-strip]")).toBeHidden();
});

test("Proxies: a hovered row's line reads as at rest; once the pointer leaves, the row looks as at rest", async ({ page }) => {
  await openApp(page, { section: "proxies", theme: "light" });
  await pointerPicksThenLeaves(page, page.locator("[role='row'][data-proxy-id]").nth(1), "type");
});

test("the kit DataList (Bookmarks): a hovered row's line reads as at rest; a row the pointer pressed looks as at rest once it leaves", async ({ page }) => {
  await openApp(page, { section: "bookmarks", theme: "light" });
  const r = page.locator("main [role='row'][data-row-id]").nth(1);
  await expect(r).toBeVisible();
  const rest = await look(r);
  const restLine = await line(r);
  await r.hover();
  expect(await look(r)).not.toBe(rest);
  expect(await line(r)).toBe(restLine);
  // A press picks it as the target; let go elsewhere, so nothing opens.
  const b = (await r.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(r).toHaveAttribute("data-active", "true");
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await expect(r).toHaveAttribute("data-active", "true");
  expect(await look(r)).toBe(rest);
  expect(await line(r)).toBe(restLine);
});

test("Profiles: after a mouse click in the search box, Tab into the list gives the focused row its fill and hover actions with no other key", async ({ page }) => {
  await openApp(page, { theme: "light" });
  const rest = await look(page.locator("[role='row'][data-profile-id]").nth(1));
  await (await openSearch(page)).click();
  await expect(page.locator("html")).toHaveAttribute("data-input", "pointer");
  const focused = page.locator("[role='row'][data-profile-id]:focus-within");
  for (let i = 0; i < 80 && (await focused.count()) === 0; i++) await page.keyboard.press("Tab");
  await expect(focused).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-input", "keys");
  expect(await look(focused)).not.toBe(rest);
  await expect(focused.locator("[data-hover-strip]")).toBeVisible();
});
