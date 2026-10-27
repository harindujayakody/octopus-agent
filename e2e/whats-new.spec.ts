import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";

for (const theme of ["dark", "light"] as const) {
  test(`What's new opens by itself on the first run after an update (${theme})`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("shardx-patchlog-seen-version", "0.0.1"));
    await openApp(page, { theme });
    const dialog = page.getByRole("dialog", { name: /What’s new/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/v2\.6\.1/).first()).toBeVisible();
  });

  test(`What's new, ${theme}`, { tag: "@visual" }, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("shardx-patchlog-seen-version", "0.0.1"));
    await openApp(page, { theme });
    await expect(page.getByRole("dialog", { name: /What’s new/ })).toBeVisible();
    await expect(page).toHaveScreenshot(`whats-new-${theme}.png`);
  });
}

test("the version item in the sidebar opens What's new", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: /Octopus Agent v2\.0\.3/ }).click();
  await expect(page.getByRole("dialog", { name: /What’s new/ })).toBeVisible();
});

test("there is no Patch log page any more", async ({ page }) => {
  await openApp(page, { section: "patchlog" });
  await expect(page.locator("main[data-section='profiles']")).toBeVisible();
  await expect(page.locator("[data-nav='patchlog']")).toHaveCount(0);
});
