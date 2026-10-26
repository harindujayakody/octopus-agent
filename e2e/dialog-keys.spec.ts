import { expect, test, type Page } from "@playwright/test";
import { openApp, seedATag } from "./support/app";

// The list's tag picker and folder picker are siblings. When one opened while
// the other was still leaving, both got the same key and copies of the tag
// picker stayed in <body> until a reload.
const rows = (page: Page) => page.locator("[role='row'][data-profile-id]");
const tagInputs = (page: Page) => page.getByPlaceholder("Find or create a tag…");
const overlays = (page: Page) => page.locator("[role='dialog'], [role='alertdialog']");
// A closed picker stays mounted up to 400 ms: past that, a second copy has shown up.
const pastExit = (page: Page) => page.waitForTimeout(600);

async function clickTagsPencil(page: Page, index: number) {
  const cell = rows(page).nth(index).locator("[data-cell='tags']");
  await cell.hover({ position: { x: 4, y: 18 } });
  await cell.getByRole("button", { name: /^(Edit|Add) tags for / }).click();
}

const sameKeyWarnings = (page: Page) => {
  const seen: string[] = [];
  page.on("console", (m) => { if (m.text().includes("same key")) seen.push(m.text()); });
  return seen;
};

test("a Tags pencil clicked while Move to folder leaves opens one tag picker, and closing it leaves nothing behind", async ({ page }) => {
  const warnings = sameKeyWarnings(page);
  await seedATag(page);
  await openApp(page);
  // Twice: the n-th folder opening and the n-th tag opening once got the same key.
  for (let round = 0; round < 2; round++) {
    await rows(page).nth(1).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to folder" }).click();
    await expect(page.getByRole("dialog", { name: "Move to folder" })).toBeVisible();
    // The pencil's press closes the folder picker, its click opens the tag picker.
    await clickTagsPencil(page, 0);
    await expect(page.getByRole("dialog", { name: "Move to folder" })).toHaveCount(0);
    await pastExit(page);
    await expect(tagInputs(page)).toHaveCount(1);
    await expect(tagInputs(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(overlays(page)).toHaveCount(0);
  }
  // The next opening shows one picker, not one over leftovers.
  await clickTagsPencil(page, 0);
  await pastExit(page);
  await expect(tagInputs(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(overlays(page)).toHaveCount(0);
  expect(warnings).toEqual([]);
});

test("M pressed while the tag picker leaves opens Move to folder, and no closed tag picker stays behind", async ({ page }) => {
  const warnings = sameKeyWarnings(page);
  await seedATag(page);
  await openApp(page);
  await clickTagsPencil(page, 1);
  await expect(tagInputs(page)).toHaveCount(1);
  // Escape and M with no pause: the folder picker opens inside the tag picker's exit.
  await page.keyboard.press("Escape");
  await page.keyboard.press("m");
  await expect(page.getByRole("dialog", { name: "Move to folder" })).toBeVisible();
  await pastExit(page);
  await expect(tagInputs(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(overlays(page)).toHaveCount(0);
  await clickTagsPencil(page, 0);
  await pastExit(page);
  await expect(tagInputs(page)).toHaveCount(1);
  expect(warnings).toEqual([]);
});
