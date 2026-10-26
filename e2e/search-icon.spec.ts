import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";
import { searchButton, searchField } from "./support/search";

// Owner, 2026-10-01: search is an icon on every page. Folded at rest at any
// width; "/", Mod+F and a click open it in place; it stays open while a
// query is set, so a filtered list never hides its search.

const PAGES = ["profiles", "proxies", "bookmarks", "trash", "extensions", "fingerprints"] as const;

test.use({ viewport: { width: 1280, height: 800 } });

for (const section of PAGES) {
  test(`${section}: search is a button at rest, and opens, focuses and folds`, async ({ page }) => {
    await openApp(page, { section });
    await expect(searchField(page)).toBeHidden();
    await expect(searchButton(page)).toBeVisible();

    // A click opens and focuses it; Esc on empty folds it, focus back on the button.
    await searchButton(page).click();
    await expect(searchField(page)).toBeVisible();
    await expect(searchField(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(searchField(page)).toBeHidden();
    await expect(searchButton(page)).toBeFocused();

    // "/" and Mod+F.
    await page.locator("main").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("/");
    await expect(searchField(page)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(searchField(page)).toBeHidden();
    await page.keyboard.press("ControlOrMeta+f");
    await expect(searchField(page)).toBeFocused();

    // Blur with an empty field folds it.
    await page.locator("main").click({ position: { x: 5, y: 300 } });
    await expect(searchField(page)).toBeHidden();
  });
}

test("a query holds the field open; the first Esc clears it, the second folds it", async ({ page }) => {
  await openApp(page);
  await searchButton(page).click();
  await searchField(page).fill("fb");
  await page.locator("main").click({ position: { x: 5, y: 300 } });
  await expect(searchField(page)).toBeVisible();
  await expect(searchField(page)).toHaveValue("fb");
  await expect(page.locator("main header [data-count]")).toHaveText("2 of 8");
  await searchField(page).focus();
  await page.keyboard.press("Escape");
  await expect(searchField(page)).toHaveValue("");
  await expect(searchField(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(searchField(page)).toBeHidden();
  await expect(searchButton(page)).toBeFocused();
});

test("a query that outlives the header (page switch) comes back with the field open", async ({ page }) => {
  await openApp(page);
  await searchButton(page).click();
  await searchField(page).fill("fb");
  await page.locator("aside [data-nav='proxies']").click();
  await expect(searchField(page)).toBeHidden();
  await page.locator("aside [data-nav='profiles']").click();
  await expect(searchField(page)).toBeVisible();
  await expect(searchField(page)).toHaveValue("fb");
});
