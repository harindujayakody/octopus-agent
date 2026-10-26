import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";

// The sidebar footer's API row: a divider above, a word and the port, a copy
// icon on hover that moves nothing, and a popover with the address.
const row = (page: import("@playwright/test").Page) => page.locator("aside [data-api-status]");

test("a hairline divider sits directly above the API row", async ({ page }) => {
  await openApp(page);
  const r = await row(page).boundingBox();
  const divider = page.locator("aside [data-sidebar-footer] > div[aria-hidden='true']").last();
  const d = await divider.boundingBox();
  expect(d!.y + d!.height).toBeLessThanOrEqual(r!.y);
  expect(r!.y - (d!.y + d!.height)).toBeLessThan(12);
  expect(r!.height).toBeLessThanOrEqual(28);
});

test("the row shows the word and the port; its name leads with the word", async ({ page }) => {
  await openApp(page);
  await expect(row(page)).toContainText("API on");
  await expect(row(page).locator("[data-api-port]")).toHaveText(":40325");
  await expect(row(page)).toHaveAccessibleName("API on, Local API port 40325");
  await expect(row(page)).toHaveAttribute("aria-haspopup", "dialog");
  await expect(row(page)).toHaveAttribute("aria-expanded", "false");
});

test("hover shows the copy icon and moves nothing", async ({ page }) => {
  await openApp(page);
  const copy = page.locator("aside [data-api-copy]");
  await expect(copy).toBeHidden();
  const before = [await row(page).boundingBox(), await page.locator("aside [data-api-port]").boundingBox()];
  await row(page).hover();
  await expect(copy).toBeVisible();
  expect([await row(page).boundingBox(), await page.locator("aside [data-api-port]").boundingBox()]).toEqual(before);
});

test("a click opens the popover with the address, copy and the settings link; Esc closes it and returns focus", async ({ page }) => {
  await openApp(page);
  await row(page).click();
  const pop = page.getByRole("dialog", { name: "Local API" });
  await expect(pop).toBeVisible();
  await expect(row(page)).toHaveAttribute("aria-expanded", "true");
  await expect(pop.locator("[data-api-address]")).toContainText("http://127.0.0.1:40325");
  await expect(pop.getByRole("button", { name: "Copy Address" })).toBeVisible();
  await expect(pop.getByRole("button", { name: "API & MCP settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await expect(row(page)).toBeFocused();
});
