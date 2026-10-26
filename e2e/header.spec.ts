import { expect, test } from "@playwright/test";
import { SECTIONS, openApp } from "./support/app";
import { openSearch } from "./support/search";

for (const section of SECTIONS) {
  test(`${section}: one page header with the page title, at the top edge of the page panel`, async ({ page }) => {
    await openApp(page, { section });
    const header = page.locator("main header");
    await expect(header).toHaveCount(1);
    await expect(header.locator("h1")).toHaveCount(1);
    // The title lives in the header only: no second page title below it.
    await expect(page.locator("main h1")).toHaveCount(1);
    // The page panel starts 8 px down, on the gray ground (borderless, owner 2026-10-01).
    expect((await header.boundingBox())?.y).toBe(8);
  });
}

test("no page shows the old breadcrumb bar", async ({ page }) => {
  test.slow(); // opens every page in turn: 9 loads
  for (const section of SECTIONS) {
    await openApp(page, { section });
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toHaveCount(0);
  }
});

test("pressing / focuses the filter, and typing narrows the list", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await page.locator("main").click({ position: { x: 400, y: 700 } });
  await page.keyboard.press("/");
  const filter = page.getByRole("searchbox", { name: "Search…" });
  await expect(filter).toBeFocused();
  await page.keyboard.type("Sandbox");
  // The rows, not the page: the action cards above the list may name a
  // profile the filter hides (Live Task 8).
  const rows = page.locator("[role='row'][data-profile-id]");
  await expect(rows.getByText("Sandbox", { exact: true })).toBeVisible();
  await expect(rows.getByText("Amazon US seller")).toHaveCount(0);
});

// Pair 2 (carried from Pair 3): "/" focused the field on the next frame,
// so a key typed right after it could land outside the field. The keyboard
// is in the field when the "/" handler returns, folded or not.
test("/ puts the keyboard in the filter at once, folded or not", async ({ page }) => {
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 700 });
    await openApp(page);
    const role = await page.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
      return document.activeElement?.getAttribute("role");
    });
    expect(role, `${width} px`).toBe("searchbox");
  }
});

test("/ typed inside a field is just a slash", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  const filter = await openSearch(page);
  await page.keyboard.type("a/b");
  await expect(filter).toHaveValue("a/b");
});

test("/ does nothing while a dialog is open", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='status']").click();
  await page.keyboard.press("m");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search…" })).toBeHidden();
});

test("the header shows how many items the page lists", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await expect(page.locator("main header")).toContainText("All profiles");
  await expect(page.locator("main header [data-count]")).toHaveText("8");
});

test("Import lives in the Profiles header's More actions menu", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await page.evaluate(() => {
    (window as unknown as { __shardxMockClipboard: string }).__shardxMockClipboard =
      JSON.stringify([{ name: "Imported one" }]);
  });
  await expect(page.locator("main header").getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
  await page.locator("main header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Import profiles from clipboard" }).click();
  await expect(page.locator("[role='row'][data-profile-id]", { hasText: "Imported one" })).toHaveCount(1);
});
