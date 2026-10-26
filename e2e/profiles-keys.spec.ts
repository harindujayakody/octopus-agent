import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { openSearch } from "./support/search";

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const active = (page: Page) => page.locator("[role='row'][data-active]");
const names = (page: Page) => page.locator("[role='row'][data-profile-id] [data-cell='name']").allTextContents();

test("arrow keys move the active row, which has focus", async ({ page }) => {
  await openApp(page);
  const order = await names(page);
  await page.keyboard.press("ArrowDown");
  await expect(active(page)).toContainText(order[0]);
  await expect(active(page)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(active(page)).toContainText(order[2]);
  await page.keyboard.press("ArrowUp");
  await expect(active(page)).toContainText(order[1]);
  await page.keyboard.press("End");
  await expect(active(page)).toContainText(order[order.length - 1]);
});

test("X selects the active row; Mod+A selects every row; Esc clears", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ArrowDown");
  // Task 15 (A6): X belongs to the grid, so it only fires once the active
  // row actually has the keyboard (see the Enter test above).
  await expect(active(page)).toBeFocused();
  await page.keyboard.press("x");
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(8);
  await page.keyboard.press("Escape");
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(0);
});

test("keys do nothing while typing in the filter", async ({ page }) => {
  await openApp(page);
  await (await openSearch(page)).click();
  await page.keyboard.type("x");
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search…" })).toHaveValue("x");
});

test("Enter opens Peek on the active row and Esc closes it", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ArrowDown");
  // Task 15 (A6): Enter belongs to the grid, so it only fires once the
  // active row actually has the keyboard (its focus lands a frame after the
  // page-wide ArrowDown that moved it).
  await expect(active(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("aside[data-peek]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("aside[data-peek]")).toHaveCount(0);
});

test("S starts the active row; M opens its picker; Delete moves it to the Trash", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").locator("[data-cell='status']").click();
  await page.keyboard.press("s");
  await expect(row(page, "Etsy craft shop").getByRole("button", { name: "Stop" })).toBeVisible();
  await page.keyboard.press("m");
  // The folder picker (E17): a popover with its search field focused.
  const picker = page.getByRole("dialog", { name: "Move to folder" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("combobox", { name: "Find or create a folder" })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Delete");
  await expect(row(page, "Etsy craft shop")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the active row keeps focus after scrolling far away and back", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockProfiles: number }).__shardxMockProfiles = 300; });
  await openApp(page);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await expect(active(page)).toContainText("Profile 0300");
  await expect(active(page)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(active(page)).toBeFocused();
});
