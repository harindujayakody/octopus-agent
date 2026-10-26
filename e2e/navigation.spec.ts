import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";

test("?section= opens that page", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await expect(page.locator("main[data-section='proxies']")).toBeVisible();
});

test("changing page writes ?section= back to the URL", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await page.locator("[data-nav='settings']").click();
  await expect(page).toHaveURL(/[?&]section=settings(&|$)/);
  await expect(page.locator("main[data-section='settings']")).toBeVisible();
});

test("unknown ?section= falls back to the Profiles page", async ({ page }) => {
  await openApp(page, { section: "nonsense" });
  await expect(page.locator("main[data-section='profiles']")).toBeVisible();
});
