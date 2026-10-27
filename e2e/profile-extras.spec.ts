import { expect, test } from "@playwright/test";
import { openApp, row } from "./support/app";

// A profile's site icon (before its name), its cache (size and Clear), the
// Browser column in Display, and a tag's own color.

test("an icon picked in the editor shows before the name in the list", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  await page.locator("aside[data-peek] [data-peek-edit]").click();
  const dialog = page.getByRole("dialog", { name: /Edit Sandbox/ });
  await dialog.locator("[data-property='icon'] button").click();
  await page.locator("[data-icon-option='pinterest']").click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(row(page, "Sandbox").locator("[data-cell='name'] [data-profile-icon='pinterest']")).toBeVisible();
});

test("a new profile starts with no notes", async ({ page }) => {
  await openApp(page);
  await page.locator("[data-tour='new-profile']").click();
  const dialog = page.getByRole("dialog", { name: "New profile" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByPlaceholder("Add notes…")).toHaveValue("");
});

test("Clear cache empties a closed profile's cache and the editor shows its size", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Clear cache" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: /Cache cleared for “Sandbox”: .+ freed/ })).toBeVisible();

  await row(page, "TikTok creator").locator("[data-cell='name']").click();
  await page.locator("aside[data-peek] [data-peek-edit]").click();
  await expect(page.locator("[data-cache-size]")).toHaveText(/MB$/);
  await page.locator("[data-cache-clear]").click();
  await expect(page.locator("[data-cache-size]")).toHaveText(/^0\sB$/);
});

test("the Browser column is in Display and shows each profile's browser", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("dialog", { name: "Display" }).getByRole("checkbox", { name: "Browser" }).check();
  await page.keyboard.press("Escape");
  await expect(row(page, "Sandbox").locator("[data-cell='engine']")).toHaveText("Octopus Agent");
  await expect(row(page, "Sandbox").locator("[data-cell='engine'] [data-engine-icon='shardx']")).toBeVisible();
});
