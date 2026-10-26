import { expect, test, type Page } from "@playwright/test";
import { expectScrollsInCard, openApp, seedATag, reloadApp, row, seed, titles, toggleDisplayColumns } from "./support/app";

// The Profiles list's columns on the shared model (owner feature 2026-09-26):
// stored as { v: 2, order, hidden, widths }, migrated from the old booleans;
// Views keep order and visibility, widths stay the list's; a list wider than
// its card scrolls sideways inside it.
const header = (page: Page) => page.locator("[role='row'][aria-rowindex='1']");
const cellsOf = (page: Page, name: string) =>
  row(page, name).locator("[data-cell]").evaluateAll((els) => els.map((e) => e.getAttribute("data-cell")));
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("shardx.profiles.layout") ?? "null"));
const sidebar = (page: Page) => page.locator("aside nav");
const modified = (page: Page) => page.getByText("Modified", { exact: true });
const width = (loc: ReturnType<Page["locator"]>) => loc.evaluate((el) => Math.round(el.getBoundingClientRect().width));
const FILTERS = { status: "all", country: "", proxy: "all", tag: "", lastRun: "any" };
const view = (id: string, name: string, columns: unknown) =>
  ({ id, name, pinned: true, query: { folder: "all", filters: FILTERS, sort: "added", columns } });
const DEFAULT_TITLES = ["Name", "Status", "Folder", "Tags", "Proxy", "Notes"];

// A tag exists, so the Tags column shows (it waits for the first tag, CRAFT-14).
test.beforeEach(async ({ page }) => { await seedATag(page); });

test("a column set saved before the model keeps the person's choices, and only the new key is written (Review Focus 1)", async ({ page }) => {
  await seed(page, "shardx.profiles.columns", { folder: false, tags: true, notes: true, lastRun: true });
  await openApp(page);
  expect(await titles(page)).toEqual(["Name", "Status", "Tags", "Proxy", "Notes"]);
  expect(await stored(page)).toBeNull();
  await toggleDisplayColumns(page, "Notes");
  expect(await stored(page)).toMatchObject({ v: 2, hidden: expect.arrayContaining(["folder", "notes"]) });
  // The old value stays for an older build of the app.
  expect(await page.evaluate(() => localStorage.getItem("shardx.profiles.columns"))).toContain('"folder":false');
});

for (const [label, value] of [
  ["broken", "{"],
  ["newer", JSON.stringify({ v: 3, order: ["notes", "name"], hidden: ["tags"] })],
] as const) {
  test(`a ${label} layout value loads the default columns (Review Focus 1)`, async ({ page }) => {
    await seed(page, "shardx.profiles.layout", value);
    await openApp(page);
    expect(await titles(page)).toEqual(DEFAULT_TITLES);
  });
}

test("a saved order and hidden columns come back, and every row follows its header", async ({ page }) => {
  await seed(page, "shardx.profiles.layout", { v: 2, order: ["name", "notes", "status", "tags", "proxy", "folder"], hidden: ["folder"], widths: {} });
  await openApp(page);
  expect(await titles(page)).toEqual(["Name", "Notes", "Status", "Tags", "Proxy"]);
  expect(await cellsOf(page, "Etsy craft shop")).toEqual(["checkbox", "name", "notes", "status", "tags", "proxy", "actions"]);
});

// The row stretches to the list (owner, 2026-10-23): a set width is the one
// the column stretches from, so the header and rows draw it a little wider.
test("a width is the list's: header and rows take it, and it stays while a View is applied", async ({ page }) => {
  await seed(page, "shardx.profiles.layout", { v: 2, order: ["name", "status", "folder", "tags", "proxy", "notes"], hidden: [], widths: { tags: 200 } });
  await openApp(page);
  const template = () => header(page).evaluate((el) => (el as HTMLElement).style.gridTemplateColumns);
  expect(await template()).toMatch(/--col-tags,(200px|minmax\(200px,)/);
  const drawn = await width(header(page).locator("[data-col='tags']"));
  expect(drawn).toBeGreaterThanOrEqual(200);
  expect(await width(row(page, "Etsy craft shop").locator("[data-cell='tags']"))).toBe(drawn);
  await sidebar(page).locator("[data-view='builtin:running']").click();
  expect(await template()).toMatch(/--col-tags,(200px|minmax\(200px,)/);
});

test("a View keeps its own order and hidden columns; leaving it gives the list's own back", async ({ page }) => {
  await seed(page, "shardx.views", { version: 1, views: [view("v-cols", "Proxy first", { order: ["name", "proxy", "status", "tags", "folder", "notes"], hidden: ["notes"] })] });
  await openApp(page);
  await sidebar(page).getByText("Proxy first", { exact: true }).click();
  expect(await titles(page)).toEqual(["Name", "Proxy", "Status", "Tags", "Folder"]);
  await expect(modified(page)).toHaveCount(0);
  await sidebar(page).getByText("All profiles", { exact: true }).click();
  expect(await titles(page)).toEqual(DEFAULT_TITLES);
});

test("a View that names a column this version lacks, or saved the old way, opens as saved and not Modified (Review Focus 2)", async ({ page }) => {
  await seed(page, "shardx.views", { version: 1, views: [
    view("v-new", "Unknown column", { order: ["name", "status", "bogus", "tags", "folder", "proxy", "notes"], hidden: ["bogus", "notes"] }),
    view("v-old", "Old booleans", { folder: true, tags: false, notes: true, lastRun: true }),
  ] });
  await openApp(page);
  await sidebar(page).getByText("Unknown column", { exact: true }).click();
  expect(await titles(page)).toEqual(["Name", "Status", "Tags", "Folder", "Proxy"]);
  await expect(modified(page)).toHaveCount(0);
  await sidebar(page).getByText("Old booleans", { exact: true }).click();
  expect(await titles(page)).toEqual(["Name", "Status", "Folder", "Proxy", "Notes"]);
  await expect(modified(page)).toHaveCount(0);
});

test("a column hidden inside a View marks it Modified and leaves the list's own columns alone", async ({ page }) => {
  await seed(page, "shardx.views", { version: 1, views: [view("v-cols", "Proxy first", { order: ["name", "proxy", "status", "tags", "folder", "notes"], hidden: [] })] });
  await openApp(page);
  await sidebar(page).getByText("Proxy first", { exact: true }).click();
  await toggleDisplayColumns(page, "Tags");
  await expect(modified(page)).toBeVisible();
  expect(await stored(page)).toBeNull();
  await sidebar(page).getByText("All profiles", { exact: true }).click();
  expect(await titles(page)).toEqual(DEFAULT_TITLES);
});

test("Display lists every column in the list's order; Name and Status are always shown; inside a Folder, Folder says why it is gone", async ({ page }) => {
  await seed(page, "shardx.profiles.layout", { v: 2, order: ["name", "status", "notes", "folder", "tags", "proxy"], hidden: [], widths: {} });
  await openApp(page);
  await page.getByRole("button", { name: "Display" }).click();
  const display = page.getByRole("dialog", { name: "Display" });
  await expect(display).toBeVisible();
  const boxes = display.getByRole("checkbox");
  const names = ["Name", "Status", "Notes", "Folder", "Tags", "Proxy", "Last run", "Created", "Run time", "Device", "Extensions"];
  await expect(boxes).toHaveCount(names.length);
  for (const [i, n] of names.entries()) await expect(boxes.nth(i)).toHaveAccessibleName(n);
  await expect(display.getByRole("checkbox", { name: "Name" })).toBeDisabled();
  await expect(display.getByRole("checkbox", { name: "Name" })).toHaveAccessibleDescription("Always shown");
  await page.keyboard.press("Escape");
  await page.locator("aside [data-folder='Ads']").click();
  await page.getByRole("button", { name: "Display" }).click();
  await expect(page.getByRole("dialog", { name: "Display" }).getByRole("checkbox", { name: "Folder" }))
    .toHaveAccessibleDescription("Hidden inside a folder");
});

test("beside Peek at 1280 every chosen column stays: the list scrolls inside its card, Name and the row actions pinned, never the page (Review Focus 5)", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek]")).toBeVisible();
  expect(await titles(page)).toEqual(DEFAULT_TITLES);
  await expectScrollsInCard(page, page.getByRole("treegrid", { name: "Profiles" }), row(page, "Sandbox"), "Pin");
});
