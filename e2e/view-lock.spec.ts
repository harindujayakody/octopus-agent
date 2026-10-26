import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { filterBy, unfilter } from "./support/filters";

// A View's own filters are part of the View (owner, 2026-10-07, item 15): the
// Running view must not turn into All profiles by a click on a chip. They show
// as one locked label, "View: Running", before the chips; only the filters a
// person adds on top are chips, and Clear filters takes off only those.

const names = (page: Page) => page.locator("[role='row'][data-profile-id] [data-cell='name']").allTextContents();
const sidebar = (page: Page) => page.locator("aside nav");
const lock = (page: Page) => page.locator("[data-filter-chips] [data-view-lock]");
const chips = (page: Page) => page.locator("[data-filter-chips] [data-chip]");
const clear = (page: Page) => page.locator("[data-filter-chips]").getByRole("button", { name: "Clear filters" });
const modified = (page: Page) => page.getByText("Modified", { exact: true });
const RUNNING = ["Amazon US seller", "eBay DE buyer"];
const ALL_COLUMNS = { folder: true, tags: true, lastRun: true, notes: true };
const NONE = { status: "all", country: "", proxy: "all", tag: "", lastRun: "any" };

const seedViews = (page: Page, views: unknown[]) => page.addInitScript((v) => {
  if (localStorage.getItem("shardx.views") === null) localStorage.setItem("shardx.views", JSON.stringify({ version: 1, views: v }));
}, views);

test("Running view shows \"View: Running\" with no remove button, and its Status filter is out of reach", async ({ page }) => {
  await openApp(page);
  await sidebar(page).locator("[data-view='builtin:running']").click();
  await expect(lock(page)).toHaveText("View: Running");
  expect(await names(page)).toEqual(RUNNING);
  // A label, not a chip: nothing to remove, nothing for the keyboard, and no Clear filters.
  await expect(lock(page).getByRole("button")).toHaveCount(0);
  expect(await lock(page).evaluate((el) => el.tabIndex)).toBe(-1);
  await expect(chips(page)).toHaveCount(0);
  await expect(page.locator("[data-filter-chips]").getByRole("button")).toHaveCount(0);
  await expect(modified(page)).toHaveCount(0);
  // The Filters menu keeps Status in view, greyed, and the other fields open.
  await page.locator("main header").getByRole("button", { name: /^Filters/ }).click();
  await expect(page.getByRole("option", { name: /^Status/ })).toHaveAttribute("aria-disabled", "true");
  // It says why in words; a built-in view cannot be edited, so there is no way out offered.
  await expect(page.getByRole("option", { name: /^Status/ })).toContainText("Set by this view");
  await expect(page.getByRole("button", { name: "Edit view" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /^Connection/ })).not.toHaveAttribute("aria-disabled", "true");
});

test("an added filter is a removable chip; Clear filters removes it and keeps the view", async ({ page }) => {
  await openApp(page);
  await sidebar(page).locator("[data-view='builtin:running']").click();
  await filterBy(page, "Connection", "ISP Frankfurt");
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).first()).toHaveText(/^Connection: ISP Frankfurt$/);
  await expect(lock(page)).toHaveText("View: Running");
  await expect.poll(() => names(page)).toEqual(["eBay DE buyer"]);
  await expect(modified(page)).toBeVisible();
  // The chip's own ✕ takes off that filter and nothing of the view.
  await unfilter(page, "proxy");
  await expect(chips(page)).toHaveCount(0);
  await expect.poll(() => names(page)).toEqual(RUNNING);
  await expect(modified(page)).toHaveCount(0);
  // Two added filters, then Clear filters: both go, the view stays.
  await filterBy(page, "Last run", "Last 7 days");
  await filterBy(page, "Connection", "ISP Frankfurt");
  await expect(chips(page)).toHaveCount(2);
  await clear(page).click();
  await expect(chips(page)).toHaveCount(0);
  await expect(clear(page)).toHaveCount(0);
  await expect(lock(page)).toHaveText("View: Running");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Running");
  await expect.poll(() => names(page)).toEqual(RUNNING);
  await expect(modified(page)).toHaveCount(0);
});

test("Update view saves added filters into the view; they then belong to it, not to the chips", async ({ page }) => {
  await seedViews(page, [{ id: "v-idle", name: "Idle ones", pinned: true, query: { folder: "all", filters: { ...NONE, status: "idle" }, sort: "added", columns: ALL_COLUMNS } }]);
  await openApp(page);
  await sidebar(page).getByText("Idle ones", { exact: true }).click();
  await expect(lock(page)).toHaveText("View: Idle ones");
  expect(await names(page)).toHaveLength(6);
  await filterBy(page, "Connection", "Through a proxy");
  await expect(chips(page)).toHaveCount(1);
  await expect(modified(page)).toBeVisible();
  await page.getByRole("button", { name: "Update view" }).click();
  await expect(modified(page)).toHaveCount(0);
  await expect(chips(page)).toHaveCount(0);
  await expect(lock(page)).toHaveText("View: Idle ones");
  await expect.poll(() => names(page)).toHaveLength(5);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("shardx.views") ?? "null").views[0].query.filters);
  expect(saved).toMatchObject({ status: "idle", proxy: "bound" });
  // Leave and come back: the view still carries both, as one label.
  await sidebar(page).getByText("All profiles", { exact: true }).click();
  await sidebar(page).getByText("Idle ones", { exact: true }).click();
  await expect(chips(page)).toHaveCount(0);
  await expect(lock(page)).toHaveText("View: Idle ones");
  await expect.poll(() => names(page)).toHaveLength(5);
});

test("a view with no own filters shows no label, and Clear filters works", async ({ page }) => {
  await seedViews(page, [{ id: "v-ads", name: "Ads only", pinned: true, query: { folder: "Ads", filters: NONE, sort: "added", columns: ALL_COLUMNS } }]);
  await openApp(page);
  await sidebar(page).getByText("Ads only", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ads only");
  expect(await names(page)).toHaveLength(3);
  await expect(lock(page)).toHaveCount(0);
  await filterBy(page, "Connection", "DC Tokyo");
  await expect(chips(page)).toHaveCount(1);
  await expect.poll(() => names(page)).toEqual(["FB Ads acc-02"]);
  await expect(lock(page)).toHaveCount(0);
  await clear(page).click();
  await expect(chips(page)).toHaveCount(0);
  await expect.poll(() => names(page)).toHaveLength(3);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ads only");
  await expect(modified(page)).toHaveCount(0);
});
