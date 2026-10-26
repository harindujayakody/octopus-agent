import { expect, test, type Page } from "@playwright/test";
import { openApp, pressCreate } from "./support/app";

// "More air, clearer hierarchy" (owner-approved mock, 2026-10-01), Lane E's
// part: the details cards in Settings, and Peek's stat strip and row rhythm.

test("Settings: About and the API are details cards with copy buttons", async ({ page }) => {
  await openApp(page, { section: "settings" });
  const tab = (name: string) => page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name });
  await tab("API & MCP").click();
  const api = page.locator("[data-details='api']");
  await expect(api.getByRole("heading", { name: "Connection" })).toBeVisible();
  await expect(api.locator("[data-detail='base-url']")).toContainText("http://127.0.0.1:40325");
  await expect(api.locator("[data-detail='status']")).toContainText("Running");
  // Compact rows on the tile (borderless, owner 2026-10-01): at least 34 px, no line between them.
  for (const row of await api.locator("[data-detail]").all()) {
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(34);
    expect(await row.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe("0px");
  }
  await api.locator("[data-detail='base-url']").getByRole("button", { name: "Copy Base URL" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __shardxMockClipboard?: string }).__shardxMockClipboard)).toBe("http://127.0.0.1:40325");

  await tab("About").click();
  const about = page.locator("[data-details='about']");
  await expect(about.locator("[data-detail='version']")).toContainText("2.0.3");
  await expect(about.locator("[data-detail='version']").getByRole("button", { name: "Copy Version" })).toBeVisible();
});

const peek = (page: Page) => page.locator("aside[data-peek='profile']");
async function openPeek(page: Page, name: string) {
  await page.locator("[role='row'][data-profile-id]", { hasText: name }).locator("[data-cell='name']").click();
  await expect(peek(page)).toBeVisible();
}

test("Peek's stat strip shows only the stats that have data", async ({ page }) => {
  await openApp(page);
  await openPeek(page, "Amazon US seller");
  const stats = peek(page).locator("[data-peek-stats] [data-peek-stat]");
  await expect(stats).toHaveCount(3);
  await expect(peek(page).locator("[data-peek-stat='total-time']")).toContainText(/Total time\s*212\s*h/i);
  await expect(peek(page).locator("[data-peek-stat='launches']")).toContainText(/Starts\s*186/i);
  await expect(peek(page).locator("[data-peek-stat='traffic']")).toContainText(/Traffic\s*4\.8\s*GB/i);
  const value = peek(page).locator("[data-peek-stat='launches'] [data-stat-value]");
  expect(await value.evaluate((el) => getComputedStyle(el).fontSize)).toBe("20px");
  // Sandbox never ran: 0 starts and 0 B, known without the backend's counts (B41).
  await openPeek(page, "Sandbox");
  await expect(stats).toHaveCount(3);
  await expect(peek(page).locator("[data-peek-stat='launches']")).toContainText(/Starts\s*0/i);
  await expect(peek(page).locator("[data-peek-stat='traffic']")).toContainText(/Traffic\s*0\s*B/i);
});

test("a profile just created shows its whole stat strip in Peek, not Total time alone (owner, 2026-10-02)", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New profile" }).first().click();
  await pressCreate(page);
  // The created profile's own form, under its real id, once the backend has it.
  await expect(peek(page).locator("[data-peek-section='activity']")).toBeVisible();
  const stats = peek(page).locator("[data-peek-stats] [data-peek-stat]");
  await expect(stats).toHaveCount(3);
  await expect(peek(page).locator("[data-peek-stat='total-time']")).toContainText(/Total time\s*0\s*min/i);
  await expect(peek(page).locator("[data-peek-stat='launches']")).toContainText(/Starts\s*0/i);
  await expect(peek(page).locator("[data-peek-stat='traffic']")).toContainText(/Traffic\s*0\s*B/i);
});

test("Peek's label and value rows: soft 12 px labels, strong 13 px values, 14 px apart", async ({ page }) => {
  await openApp(page);
  await openPeek(page, "Amazon US seller");
  const rows = peek(page).locator("[data-peek-section='profile'] [data-property]");
  const a = (await rows.nth(0).boundingBox())!;
  const b = (await rows.nth(1).boundingBox())!;
  // 32 px rows, 2 px apart: their 20 px lines of text sit 14 px apart.
  expect(Math.round(b.y - (a.y + a.height))).toBe(2);
  const label = rows.nth(0).locator("[data-property-label]");
  expect(await label.evaluate((el) => getComputedStyle(el).fontSize)).toBe("12px");
});
