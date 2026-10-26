import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { boxOf } from "./support/geometry";
import { pickOption } from "./support/select";

// "Save as view" has one place (owner, 2026-10-01): first in the header's
// actions group, before Filters, absent when nothing differs from the list's
// View. Display is always neutral; Reset to default lives in its panel.
const save = (page: Page) => page.getByRole("button", { name: "Save as view" });
const listTop = async (page: Page) => (await boxOf(page.locator("[role='row'][data-profile-id]").first())).y;

async function filterIdle(page: Page) {
  await page.locator("main header").getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("option", { name: /^Status/ }).click();
  await page.getByRole("option", { name: /^Idle/ }).click();
}
async function orderZ(page: Page) {
  await page.getByRole("button", { name: /^Display/ }).click();
  await pickOption(page.getByRole("dialog", { name: "Display" }), "Order", "Name, Z to A");
  await page.keyboard.press("Escape");
}

const actions = (page: Page) => page.locator("main header > div").last();
const filtersBtn = (page: Page) => page.locator("main header [data-filter-trigger]");

test("with a filter active, Save as view is in the actions group, right before Filters", async ({ page }) => {
  await openApp(page);
  await filterIdle(page);
  await expect(save(page)).toHaveCount(1);
  await expect(actions(page).getByRole("button", { name: "Save as view" })).toBeVisible();
  // Not in the chip row, not by the title.
  await expect(page.locator("[data-filter-chips]").getByRole("button", { name: "Save as view" })).toHaveCount(0);
  const [s, f] = [await boxOf(save(page)), await boxOf(filtersBtn(page))];
  expect(s.x + s.width).toBeLessThanOrEqual(f.x);
  expect(f.x - (s.x + s.width)).toBeLessThanOrEqual(9);
  expect(s.height).toBe(f.height);
  expect(s.y).toBe(f.y);
  // First of the actions, right after Search (owner, 2026-10-02: Search
  // leads the right cluster): only the search button lies left of it.
  const buttons = actions(page).getByRole("button");
  const searchBtn = await boxOf(buttons.nth(0));
  await expect(buttons.nth(0)).toHaveAccessibleName(/Search/);
  expect(searchBtn.x + searchBtn.width).toBeLessThanOrEqual(s.x);
  expect((await boxOf(buttons.nth(1))).x).toBe(s.x);
});

test("an order change shows it in the header, and the header's buttons and the list stay put", async ({ page }) => {
  await openApp(page);
  await expect(save(page)).toHaveCount(0);
  const before = await listTop(page);
  const f0 = await boxOf(filtersBtn(page));
  await orderZ(page);
  await expect(actions(page).getByRole("button", { name: "Save as view" })).toBeVisible();
  await expect(page.locator("[data-filter-chips]")).toHaveCount(0);
  expect(await listTop(page)).toBe(before);
  const f1 = await boxOf(filtersBtn(page));
  expect(f1.y).toBe(f0.y);
  expect(f1.height).toBe(f0.height);
});

test("with no changes, Save as view is absent", async ({ page }) => {
  await openApp(page);
  await expect(save(page)).toHaveCount(0);
  await filterIdle(page);
  await expect(save(page)).toHaveCount(1);
  await page.locator("[data-filter-chips]").getByRole("button", { name: "Clear filters" }).click();
  await expect(save(page)).toHaveCount(0);
});

test("Display stays neutral after a change, and its panel offers Reset to default", async ({ page }) => {
  await openApp(page);
  const display = page.getByRole("button", { name: /^Display/ });
  await display.click();
  await expect(page.getByRole("button", { name: "Reset to default" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await orderZ(page);
  const colors = (b: ReturnType<Page["locator"]>) => b.evaluate((el) => { const c = getComputedStyle(el); return [c.color, c.borderTopColor]; });
  expect(await colors(display)).toEqual(await colors(filtersBtn(page)));
  await display.click();
  await page.getByRole("button", { name: "Reset to default" }).click();
  await expect(page.getByRole("button", { name: "Reset to default" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(save(page)).toHaveCount(0);
});

test("the stack above the list: no empty chips row, and the list starts under the chips", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("[role='row'][data-profile-id]").first()).toBeVisible();
  // The chips row is not drawn without chips.
  await expect(page.locator("[data-filter-chips]")).toHaveCount(0);
  await filterIdle(page);
  const chips = await boxOf(page.locator("[data-filter-chips]"));
  const list = await boxOf(page.locator("[role='row'][data-profile-id]").first());
  expect(list.y).toBeGreaterThan(chips.y + chips.height);
});
