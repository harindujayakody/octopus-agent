import { expect, test, type Page } from "@playwright/test";
import { openApp, pressCreate } from "./support/app";

const fail = (page: Page, cmds: Record<string, number>) => page.addInitScript((c) => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = c; }, cmds);

test("Profile Peek: a form that fails to load says so, Retry loads it, and the next profile loads", async ({ page }) => {
  // Armed once the page is idle, so only Peek's read of the form fails.
  await openApp(page);
  await page.evaluate(() => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = { profile_get: 1 }; });
  await page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='name']").click();
  const peek = page.locator("aside[data-peek]");
  await expect(peek.getByText("Couldn’t load this profile")).toBeVisible();
  await peek.getByRole("button", { name: "Retry" }).click();
  // Peek only shows: the form it read is its Fingerprint rows.
  const os = peek.locator("[data-peek-section='fingerprint'] [data-property='os']");
  await expect(os).toBeVisible();
  await expect(peek.getByText("Couldn’t load this profile")).toHaveCount(0);
  await page.locator("[role='row'][data-profile-id]", { hasText: "Etsy craft shop" }).locator("[data-cell='name']").click();
  await expect(peek).toHaveAttribute("aria-label", "Peek: Etsy craft shop");
  await expect(os).toBeVisible();
});

test("Settings: a file that can't be read says so, and shows nothing until Retry reads it", async ({ page }) => {
  await fail(page, { settings_get: 1 });
  await openApp(page, { section: "settings" });
  await expect(page.getByText("Couldn’t load settings")).toBeVisible();
  await expect(page.getByRole("switch", { name: /tray/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Couldn’t load settings")).toHaveCount(0);
  // The settings show once read; there is no Save to hold back (O6).
  await expect(page.getByRole("switch", { name: /tray/i })).toBeVisible();
});

test("Settings > API & MCP: API info that can't be read offers Retry", async ({ page }) => {
  // The sidebar's API status reads api_info too: fail every call until Retry.
  await fail(page, { api_info: 99 });
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "API & MCP" }).click();
  await expect(page.getByText("Couldn’t load the API details")).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail.api_info = 0; });
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Couldn’t load the API details")).toHaveCount(0);
  // The base URL is back (it sits in a read-only field under this label).
  await expect(page.getByText("Base URL", { exact: true })).toBeVisible();
});

test("Assign proxies with no proxies points to the Proxies page", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockEmpty: boolean }).__shardxMockEmpty = true; });
  await openApp(page);
  await page.locator("main [data-empty-state]").getByRole("button", { name: "New profile" }).click();
  await pressCreate(page);
  await page.locator("aside[data-peek]").getByRole("button", { name: "Close Peek" }).click();
  await page.locator("[role='row'][data-profile-id]").first().locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: /Change proxy/ }).click();
  await expect(page.getByRole("dialog")).toContainText("No proxies yet");
  await page.getByRole("dialog").getByRole("button", { name: "Go to proxies" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Proxies");
});
