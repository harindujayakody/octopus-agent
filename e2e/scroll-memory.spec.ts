import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";
import { openSearch } from "./support/search";

// E22a (WIG-06): a page switch keeps each list's place and the Settings tab.
const many = () => { (window as unknown as { __shardxMockProfiles: number }).__shardxMockProfiles = 300; };

test("the list comes back where it was after a visit to Proxies; a new search starts at the top (WIG-06)", async ({ page }) => {
  await page.addInitScript(many);
  await openApp(page);
  const list = page.getByRole("treegrid", { name: "Profiles" });
  await list.evaluate((el) => { el.scrollTop = 3000; });
  await page.waitForTimeout(100);
  await page.locator("aside [data-nav='proxies']").click();
  await page.locator("aside [data-nav='profiles']").click();
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(2900);
  await (await openSearch(page)).fill("profile 0");
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
});

test("each Folder keeps its own place in the list", async ({ page }) => {
  await page.addInitScript(many);
  await openApp(page);
  const list = page.getByRole("treegrid", { name: "Profiles" });
  await list.evaluate((el) => { el.scrollTop = 1500; });
  await page.waitForTimeout(100);
  await page.locator("aside [data-folder='Ads']").click();
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
  await page.locator("aside [data-nav='profiles']").click();
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(1400);
});

test("Settings keeps its tab in the address: a reload opens it again (WIG-06)", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Storage" }).click();
  expect(page.url()).toContain("tab=storage");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Storage" })).toHaveAttribute("aria-selected", "true");
  // Another page drops it; coming back keeps the tab.
  await page.locator("aside [data-nav='proxies']").click();
  expect(page.url()).not.toContain("tab=");
  await page.locator("aside [data-nav='settings']").click();
  expect(page.url()).toContain("tab=storage");
});
