import { expect, test, type Page } from "@playwright/test";
import { openApp, openDisplay } from "./support/app";

// O8: Proxies gets Filters and Display (IFACE-13).
const rows = (page: Page) => page.locator("[role='row'][data-proxy-id]");
const chips = (page: Page) => page.locator("[data-filter-chips] [data-chip]");
async function filter(page: Page, field: RegExp, value: RegExp) {
  await page.locator("main header").getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("option", { name: field }).click();
  await page.getByRole("option", { name: value }).click();
}

test("Failed shows the proxies whose last test failed", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await filter(page, /^Status/, /^Failed/);
  await expect(chips(page)).toHaveText(["Status: Failed"]);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute("data-proxy-id", "px-dead");
});

test("Unused shows the proxies no profile uses", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await filter(page, /^Used by/, /^Unused/);
  await expect(rows(page).first()).toBeVisible();
  for (const r of await rows(page).all()) await expect(r.locator("[data-cell='profiles']")).toHaveText("0");
});

test("Display: order by latency, and hide a column; both come back after a reload", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const display = await openDisplay(page);
  await display.getByRole("combobox", { name: "Order" }).click();
  await page.getByRole("option", { name: "Fastest first" }).click();
  await display.getByRole("checkbox", { name: "Type", exact: true }).click();
  await page.keyboard.press("Escape");
  const type = page.locator("[role='columnheader']").filter({ hasText: "Type" });
  await expect(type).toHaveCount(0);
  await page.reload();
  await expect(page.locator("[role='columnheader']").filter({ hasText: "Name" })).toBeVisible();
  await expect(type).toHaveCount(0);
  const again = await openDisplay(page);
  await expect(again.getByRole("combobox", { name: "Order" })).toContainText("Fastest first");
});

test("a filtered list says how many of how many", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await filter(page, /^Status/, /^Failed/);
  await expect(page.locator("main header [data-count]")).toHaveText(/^1 of \d+$/);
});
