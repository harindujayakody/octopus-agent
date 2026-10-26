import { expect, test, type Page } from "@playwright/test";
import { openApp, reloadApp } from "./support/app";
import { openSearch } from "./support/search";

// F5 (F25a): the Trash is a list like the others; many come back at once
// (IFACE-07). Restore shows on the row, Delete for good sits in the menus
// and on the Delete key, and asks first (CRAFT-03).
const grid = (page: Page) => page.getByRole("treegrid", { name: "Trash" });
const rows = (page: Page) => grid(page).locator("[role='row'][data-row-id]");
const bar = (page: Page) => page.locator("[data-bulk-bar]");
/** The DataList's scroll box, around the treegrid. */
const box = (page: Page) => grid(page).locator("xpath=..");

test("select several, Restore selected brings them all back", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __shardxMockTrash: 6 }));
  await openApp(page, { section: "trash" });
  const before = await rows(page).count();
  await rows(page).first().focus();
  await page.keyboard.press("x");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await bar(page).getByRole("button", { name: "Restore 3" }).click();
  await expect(rows(page)).toHaveCount(before - 3);
  await expect(page.locator("[data-toast]").filter({ hasText: "Restored 3 profiles" })).toBeVisible();
});

test("Restore shows on the row; Delete for good sits in its menu and asks first (CRAFT-03)", async ({ page }) => {
  await openApp(page, { section: "trash" });
  const row = rows(page).first();
  await expect(row.getByRole("button", { name: /Delete/ })).toHaveCount(0);
  await row.hover();
  await expect(row.getByRole("button", { name: "Restore" })).toBeVisible();
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete for good" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
});

test("Delete on a row asks to delete it for good", async ({ page }) => {
  await openApp(page, { section: "trash" });
  await rows(page).first().focus();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("alertdialog")).toBeVisible();
});

test("the Trash has a search", async ({ page }) => {
  await openApp(page, { section: "trash" });
  const name = (await rows(page).first().locator("[data-cell='name']").innerText()).trim();
  await (await openSearch(page)).fill(name.slice(0, 5));
  await expect(rows(page).first()).toContainText(name);
});

test("the header is sentence case over 36 px rows with one line under it (UI-36, FEEL-32)", async ({ page }) => {
  await openApp(page, { section: "trash" });
  const header = grid(page).getByRole("row").first();
  await expect(header.getByRole("columnheader").nth(1)).toHaveCSS("text-transform", "none");
  expect((await rows(page).first().boundingBox())!.height).toBe(36);
  await expect(rows(page).first()).toHaveCSS("border-top-width", "0px");
  // A date never wraps.
  await expect(rows(page).first().locator("[data-cell='deleted'] .truncate")).toHaveCSS("white-space", "nowrap");
});

// Owner rules (2026-09-30): a click anywhere on a checkbox row toggles it;
// a bulk action keeps the selection; the confirm names how many.
test("a click on a row picks it; the bar's Delete for good names the count, and Cancel keeps the selection", async ({ page }) => {
  await openApp(page, { section: "trash" });
  await rows(page).nth(0).locator("[data-cell='folder']").click();
  await rows(page).nth(1).locator("[data-cell='size']").click();
  await expect(rows(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(bar(page)).toContainText("2 selected");
  await bar(page).getByRole("button", { name: "More bulk actions" }).click();
  await page.getByRole("menuitem", { name: "Delete for good" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Delete 2 profiles for good?");
  await expect(dialog.getByRole("button", { name: "Delete 2 for good" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(bar(page)).toContainText("2 selected");
  await expect(grid(page).locator("[role='row'][aria-selected='true']")).toHaveCount(2);
});

// Owner (2026-09-30): every list layout choice comes back after a restart.
test("a sort chosen in a column's menu is saved and comes back after a restart", async ({ page }) => {
  await openApp(page, { section: "trash" });
  await grid(page).locator("[data-col='size']").click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Descending" }).click();
  await expect(grid(page).locator("[data-col='size']")).toHaveAttribute("aria-sort", "descending");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("shardx.trash.layout") ?? "null")?.sort)).toEqual({ id: "size", dir: "descending" });
  await reloadApp(page);
  await expect(grid(page).locator("[data-col='size']")).toHaveAttribute("aria-sort", "descending");
});

// The tuned tracks, kept as the columns' floors: the list fits the 1024 px
// card in English, and the last-day badge ends before Size.
test("at the smallest window the Trash fits its card, and a countdown badge never runs into Size", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page, { section: "trash" });
  await expect(rows(page).first()).toBeVisible();
  expect(await box(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const r of await rows(page).all()) {
    const badge = (await r.locator("[data-cell='left'] .truncate").locator("xpath=..").boundingBox())!;
    const size = (await r.locator("[data-cell='size']").boundingBox())!;
    expect(badge.x + badge.width).toBeLessThanOrEqual(size.x + 0.5);
  }
});

test("the palette acts on the Trash's selection, from the registry (F25b)", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __shardxMockTrash: 6 }));
  await openApp(page, { section: "trash" });
  const before = await rows(page).count();
  await rows(page).first().focus();
  await page.keyboard.press("x");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("ControlOrMeta+k");
  const first = page.getByRole("dialog", { name: "Command palette" }).getByRole("group").first();
  await expect(first).toHaveAttribute("aria-label", "2 selected");
  await expect(first.getByRole("option", { name: /^Delete for good/ })).toBeVisible();
  await first.getByRole("option", { name: /^Restore 2/ }).click();
  await expect(rows(page)).toHaveCount(before - 2);
});

test("the palette's Trash commands say why they cannot run; Empty Trash asks when it can (Pair 44 review, I2)", async ({ page }) => {
  await openApp(page);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByRole("combobox", { name: "Search commands" });
  // From another page: the palette read the Trash as it opened, so it runs and asks.
  // That read is held back, so Empty Trash runs while it is still loading:
  // it waits for that read, never sees an empty list (merge point 7 race).
  await page.evaluate(() => Object.assign(window, { __shardxMockSlow: { trash_list: 1500 } }));
  await page.keyboard.press("ControlOrMeta+k");
  await search.fill("empty trash");
  await palette.getByRole("option", { name: /^Empty Trash/ }).click();
  await page.evaluate(() => Object.assign(window, { __shardxMockSlow: {} }));
  await expect(page.getByRole("alertdialog", { name: "Empty Trash?" })).toBeVisible({ timeout: 5000 });
  await page.getByRole("alertdialog", { name: "Empty Trash?" }).getByRole("button", { name: "Empty Trash" }).click();
  await expect(rows(page)).toHaveCount(0);
  // Nothing picked, nothing to empty: each one shows, disabled with why.
  await page.keyboard.press("ControlOrMeta+k");
  const first = palette.getByRole("group").first();
  await expect(first).toHaveAttribute("aria-label", "Trash");
  await expect(first.getByRole("option", { name: /^Restore/ })).toHaveAttribute("aria-disabled", "true");
  await expect(first.getByRole("option", { name: /^Restore/ })).toContainText("Select an item first");
  await expect(first.getByRole("option", { name: /^Delete for good/ })).toHaveAttribute("aria-disabled", "true");
  // The highlight starts on one that runs.
  await expect(first.getByRole("option", { name: /^Restore/ })).toHaveAttribute("aria-selected", "false");
  await search.fill("empty trash");
  await expect(palette.getByRole("option", { name: /^Empty Trash/ })).toContainText("Trash is empty");
  await page.keyboard.press("Enter");
  await expect(palette).toBeVisible();
});

test("the palette reads the Trash again after a profile moved there (Pair 45 review, I2)", async ({ page }) => {
  await openApp(page, { section: "trash" });
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByRole("combobox", { name: "Search commands" });
  const emptyTrash = palette.getByRole("option", { name: /^Empty Trash/ });
  await page.keyboard.press("ControlOrMeta+k");
  await search.fill("empty trash");
  await emptyTrash.click();
  await page.getByRole("alertdialog", { name: "Empty Trash?" }).getByRole("button", { name: "Empty Trash" }).click();
  await expect(rows(page)).toHaveCount(0);
  // The Trash was just read (and the tests' clock stands still): only the
  // move's change event makes the palette read it again.
  await page.keyboard.press("ControlOrMeta+0");
  const sandbox = page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" });
  await sandbox.focus();
  await page.keyboard.press("Delete");
  await expect(sandbox).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");
  await search.fill("empty trash");
  await expect(emptyTrash).toBeVisible();
  await expect(emptyTrash).not.toContainText("Trash is empty");
});

// Merge point 4 visual review, I4 and I5: the Folder is the chip Profiles
// draws (an empty cell for none), and the last day is amber, as the Trash
// card says it: red stays for failures.
test("a Folder shows as its chip, no Folder as an empty cell, and the last day is amber", async ({ page }) => {
  await openApp(page, { section: "trash" });
  const folder = (id: string) => grid(page).locator(`[role='row'][data-row-id='${id}'] [data-cell='folder']`);
  await expect(folder("t-1").locator("[data-folder-chip]")).toHaveText("Shops");
  await expect(folder("t-2")).toHaveText("");
  const left = (id: string) => grid(page).locator(`[role='row'][data-row-id='${id}'] [data-cell='left'] .truncate`).locator("xpath=..");
  await expect(left("t-2")).toHaveClass(/(^|\s)text-warning-text(\s|$)/);
  await expect(left("t-1")).not.toHaveClass(/text-(warning|error)-text/);
});
