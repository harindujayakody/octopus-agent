import { expect, test, type Page } from "@playwright/test";
import { expectScrollsInCard, openApp, seedATag, row, seed, titles, toggleDisplayColumns } from "./support/app";

// Five new Profiles columns (owner feature 2026-09-26): hidden until chosen,
// placed before Notes, reading the profile's own data. Times read like the
// Status cell, with the exact date in the tooltip and for screen readers.
const cell = (page: Page, name: string, id: string) => row(page, name).locator(`[data-cell='${id}']`);
const NEW = ["Last run", "Created", "Run time", "Device", "Extensions"];

// A tag exists, so the Tags column shows (it waits for the first tag, CRAFT-14).
test.beforeEach(async ({ page }) => { await seedATag(page); });

test("the five new columns start hidden and show from Display, in their place before Notes", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openApp(page);
  expect(await titles(page)).toEqual(["Name", "Status", "Folder", "Tags", "Proxy", "Notes"]);
  await toggleDisplayColumns(page, NEW);
  expect(await titles(page)).toEqual(["Name", "Status", "Folder", "Tags", "Proxy", ...NEW, "Notes"]);
});

test("each new cell reads the profile's own data", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openApp(page);
  await toggleDisplayColumns(page, NEW);
  await expect(cell(page, "Etsy craft shop", "lastRun")).toContainText("2 days ago");
  // The exact time, for a screen reader (and the tooltip).
  await expect(cell(page, "Etsy craft shop", "lastRun")).toContainText("August 30, 2026");
  await expect(cell(page, "Sandbox", "lastRun")).toHaveText("Never");
  await expect(cell(page, "Etsy craft shop", "created")).toContainText("Aug 2");
  await expect(cell(page, "Sandbox", "created")).toContainText("3 days ago");
  // 212 h stored, plus the 2 h 14 min session still running.
  await expect(cell(page, "Amazon US seller", "runTime")).toHaveText("8 d 22 h");
  await expect(cell(page, "Etsy craft shop", "runTime")).toHaveText("40 h 0 min");
  await expect(cell(page, "Sandbox", "runTime")).toHaveText("—");
  await expect(cell(page, "TikTok creator", "device")).toHaveText("Phone");
  await expect(cell(page, "Etsy craft shop", "device")).toHaveText("Desktop");
  await expect(cell(page, "FB Ads acc-01", "extensions")).toHaveText("2");
  await expect(cell(page, "Sandbox", "extensions")).toHaveText("0");
});

test("a View saved before the new columns opens without them and not Modified (Review Focus 2)", async ({ page }) => {
  await seed(page, "shardx.views", { version: 1, views: [{
    id: "v-before", name: "Before", pinned: true,
    query: { folder: "all", filters: { status: "all", country: "", proxy: "all", tag: "", lastRun: "any" }, sort: "added",
      columns: { order: ["name", "status", "folder", "tags", "proxy", "notes"], hidden: [] } },
  }] });
  await openApp(page);
  await page.locator("aside nav").getByText("Before", { exact: true }).click();
  expect(await titles(page)).toEqual(["Name", "Status", "Folder", "Tags", "Proxy", "Notes"]);
  await expect(page.getByText("Modified", { exact: true })).toHaveCount(0);
});

test("the retired Last run flag does not turn on the new Last run column (Review Focus 1)", async ({ page }) => {
  await seed(page, "shardx.profiles.columns", { folder: true, tags: true, notes: true, lastRun: true });
  await openApp(page);
  expect(await titles(page)).toEqual(["Name", "Status", "Folder", "Tags", "Proxy", "Notes"]);
});

test("at the smallest window every chosen column stays: the list scrolls inside its card, Name and the row actions pinned, never the page (Review Focus 5)", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page);
  await toggleDisplayColumns(page, NEW);
  expect(await titles(page)).toEqual(["Name", "Status", "Folder", "Tags", "Proxy", ...NEW, "Notes"]);
  await expectScrollsInCard(page, page.getByRole("treegrid", { name: "Profiles" }), row(page, "Sandbox"), "Pin");
});

test("in Chinese the new headers and cells read in Chinese", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
  await seed(page, "shardx.profiles.layout", {
    v: 2,
    order: ["name", "status", "folder", "tags", "proxy", "lastRun", "created", "runTime", "device", "extensions", "notes"],
    hidden: ["folder", "tags", "created", "extensions", "notes"],
    widths: {},
  });
  await openApp(page);
  expect(await titles(page)).toEqual(["名称", "状态", "代理", "上次运行", "运行时长", "设备"]);
  await expect(cell(page, "Sandbox", "lastRun")).toHaveText("从未");
  await expect(cell(page, "TikTok creator", "device")).toHaveText("手机");
});
