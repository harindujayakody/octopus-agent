import { expect, test, type Page } from "@playwright/test";
import { openApp, openDisplay, reloadApp } from "./support/app";
import { pickOption } from "./support/select";
import { filterBy } from "./support/filters";

const names = (page: Page) => page.locator("[role='row'][data-profile-id] [data-cell='name']").allTextContents();
/** Opens the Display popover and picks an option of one of its selects. */
async function pick(page: Page, panel: "Display", field: string, option: string) {
  await page.getByRole("button", { name: new RegExp(`^${panel}`) }).click();
  await pickOption(page.getByRole("dialog", { name: panel }), field, option);
  await page.keyboard.press("Escape");
}

test("Display holds the order; the Filters count leaves it out", async ({ page }) => {
  await openApp(page);
  await pick(page, "Display", "Order", "Name, Z to A");
  expect((await names(page)).slice(0, 3)).toEqual(["FB Ads acc-01", "Amazon US seller", "TikTok creator"]);
  await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
});

test("a column hidden in Display stays hidden after a reload", async ({ page }) => {
  await openApp(page);
  // A plain click, never forced: the kit Popover reports `toBeVisible()` a
  // couple of animation frames before its `data-state` flips to "open" and
  // lifts `pointer-events-none`; a forced click in that window passes
  // through to whatever is under the popover.
  const display = await openDisplay(page);
  await display.getByRole("checkbox", { name: "Notes" }).click();
  // Written in the click itself: nothing for a reload to race.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("shardx.profiles.layout") ?? "null")?.hidden)).toContain("notes");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("columnheader", { name: "Notes" })).toHaveCount(0);
  await reloadApp(page);
  // The header is there first, so the missing Notes is a real answer.
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Notes" })).toHaveCount(0);
});

test("Newest first sorts by the backend's @seconds dates", async ({ page }) => {
  await openApp(page);
  await pick(page, "Display", "Order", "Newest first");
  expect(await names(page)).toEqual([
    "FB Ads acc-01", "Amazon US seller",
    "Sandbox", "TikTok creator", "FB Ads acc-02", "Scraper pricing", "Etsy craft shop", "eBay DE buyer",
  ]);
});

test("Last launched puts never-run profiles last", async ({ page }) => {
  await openApp(page);
  await pick(page, "Display", "Order", "Last run");
  expect(await names(page)).toEqual([
    "Amazon US seller", "FB Ads acc-01",
    "eBay DE buyer", "Scraper pricing", "Etsy craft shop", "FB Ads acc-02", "TikTok creator", "Sandbox",
  ]);
});

test("the Last run filter finds never-run and stale profiles", async ({ page }) => {
  await openApp(page);
  await filterBy(page, "Last run", "Never run");
  expect(await names(page)).toEqual(["Sandbox"]);
  await filterBy(page, "Last run", "Last 7 days");
  expect((await names(page)).length).toBe(7);
  await filterBy(page, "Last run", "Not in 30 days");
  expect(await names(page)).toEqual(["Sandbox"]);
});

test("an ISO date from old or imported data sorts with the @seconds ones", async ({ page }) => {
  await openApp(page);
  // Sandbox never ran; give it an ISO date a minute before the frozen clock.
  await page.evaluate(() => {
    type M = { state: { profiles: Record<string, { _meta: Record<string, unknown> }> }; save: () => void; emit: (e: string, p: unknown) => void };
    const m = (window as unknown as { __shardxMock: M }).__shardxMock;
    m.state.profiles["f62a9d43"]._meta.last_launched_at = "2026-09-01T11:59:00Z";
    m.save();
    m.emit("store-changed", "profiles");
  });
  await pick(page, "Display", "Order", "Last run");
  await expect.poll(async () => (await names(page))[2]).toBe("Sandbox");
});

const sidebar = (page: Page) => page.locator("aside nav");

test("a built-in View applies its filter and order, and leaving it gives the list back", async ({ page }) => {
  await openApp(page);
  await pick(page, "Display", "Order", "Name, A to Z");
  await sidebar(page).getByText("Recently used", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recently used");
  expect(await names(page)).toEqual([
    "Amazon US seller", "FB Ads acc-01",
    "eBay DE buyer", "Scraper pricing", "Etsy craft shop", "FB Ads acc-02", "TikTok creator",
  ]);
  await expect(page.locator("[data-view='builtin:recent']")).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-nav='profiles']")).not.toHaveAttribute("aria-current", "page");
  await sidebar(page).getByText("All profiles", { exact: true }).click();
  expect((await names(page)).slice(2)).toEqual(["eBay DE buyer", "Etsy craft shop", "FB Ads acc-02", "Sandbox", "Scraper pricing", "TikTok creator"]);
});

test("changing a View marks it Modified, and Reset brings it back", async ({ page }) => {
  await openApp(page);
  // Task 5f gave the Pinned group's own running profiles a "Running" word
  // too (never a dot alone): the built-in View needs its own selector now
  // that "Running" isn't unique text in the sidebar.
  await sidebar(page).locator("[data-view='builtin:running']").click();
  expect(await names(page)).toEqual(["Amazon US seller", "eBay DE buyer"]);
  // The View's own Status filter is locked (view-lock.spec.ts): a filter added on top marks it.
  await filterBy(page, "Connection", "ISP Frankfurt");
  await expect.poll(() => names(page)).toEqual(["eBay DE buyer"]);
  await expect(page.getByText("Modified", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset" }).click();
  expect(await names(page)).toEqual(["Amazon US seller", "eBay DE buyer"]);
  await expect(page.getByText("Modified", { exact: true })).toHaveCount(0);
});

test("a View drops the rows it hides from the selection", async ({ page }) => {
  await openApp(page);
  for (const n of ["Sandbox", "Etsy craft shop"]) {
    await page.locator("[role='row'][data-profile-id]", { hasText: n }).locator("[data-cell='checkbox'] input").check({ force: true });
  }
  await sidebar(page).getByText("No proxy", { exact: true }).click();
  await expect(page.getByRole("toolbar", { name: /selected/ })).toContainText("1 selected");
});

test("Show in list leaves the View", async ({ page }) => {
  await openApp(page);
  await sidebar(page).getByText("No proxy", { exact: true }).click();
  await page.locator("[data-pinned]").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Show in list" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("All profiles");
  expect(await names(page)).toHaveLength(8);
});

const seedViews = (page: Page, value: unknown) => page.addInitScript((v) => {
  if (localStorage.getItem("shardx.views") === null) localStorage.setItem("shardx.views", JSON.stringify(v));
}, value);
const ALL_COLUMNS = { folder: true, tags: true, lastRun: true, notes: true };

test("Save as view keeps filters, order and columns, and survives a reload", async ({ page }) => {
  await openApp(page);
  await filterBy(page, "Status", "Idle");
  await pick(page, "Display", "Order", "Name, Z to A");
  await page.getByRole("button", { name: "Save as view" }).click();
  await page.getByRole("textbox", { name: "View name" }).fill("Idle Z-A");
  await page.getByRole("dialog", { name: /Save as view/ }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Idle Z-A");
  await page.reload();
  await sidebar(page).getByText("Idle Z-A", { exact: true }).click();
  await expect.poll(() => names(page)).toEqual(["FB Ads acc-01", "TikTok creator", "Scraper pricing", "Sandbox", "FB Ads acc-02", "Etsy craft shop"]);
});

test("Update view saves a change to a custom View; a built-in offers Save as view", async ({ page }) => {
  await seedViews(page, { version: 1, views: [{ id: "v-proxied", name: "Proxied ones", pinned: true, query: { folder: "all", filters: { status: "all", country: "", proxy: "bound", tag: "", lastRun: "any" }, sort: "added", columns: ALL_COLUMNS } }] });
  await openApp(page);
  await sidebar(page).getByText("Proxied ones", { exact: true }).click();
  // The View's own Connection filter is locked; a filter added on top is the change.
  await filterBy(page, "Status", "Running");
  await page.getByRole("button", { name: "Update view" }).click();
  await expect(page.getByText("Modified", { exact: true })).toHaveCount(0);
  // Task 5f: "Running" isn't unique sidebar text any more (a running Pinned
  // profile shows it too, never a dot alone) — target the built-in View.
  await sidebar(page).locator("[data-view='builtin:running']").click();
  await filterBy(page, "Last run", "Last 7 days");
  await expect(page.getByRole("button", { name: "Update view" })).toHaveCount(0);
  await expect(page.locator("header").getByRole("button", { name: "Save as view" })).toBeVisible();
  await sidebar(page).getByText("Proxied ones", { exact: true }).click();
  expect(await names(page)).toEqual(["Amazon US seller", "eBay DE buyer"]);
});

// Pair 24 review, Important 1 (ruling): Save as view shows whenever the list
// is not All, with or without a filter. A Folder, an order or columns alone
// make a View too (Settings > Views says so).
test("outside a View, Save as view shows once the list differs from All: a Folder or an order alone", async ({ page }) => {
  await openApp(page);
  const save = page.getByRole("button", { name: "Save as view" });
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
  await expect(save).toHaveCount(0);
  await sidebar(page).locator("[data-folder='Ads']").click();
  await expect(save).toBeVisible();
  await expect(page.locator("[data-filter-chips]").getByRole("button", { name: "Clear filters" })).toHaveCount(0);
  await openApp(page);
  await pick(page, "Display", "Order", "Name, Z to A");
  await expect(save).toBeVisible();
});

test("a changed custom View can be saved as a copy; the View itself stays as it was", async ({ page }) => {
  await seedViews(page, { version: 1, views: [{ id: "v-proxied", name: "Proxied ones", pinned: true, query: { folder: "all", filters: { status: "all", country: "", proxy: "bound", tag: "", lastRun: "any" }, sort: "added", columns: ALL_COLUMNS } }] });
  await openApp(page);
  await sidebar(page).getByText("Proxied ones", { exact: true }).click();
  await filterBy(page, "Status", "Running");
  await page.locator("main header").first().getByRole("button", { name: "Save as a copy" }).click();
  await page.getByRole("textbox", { name: "View name" }).fill("Running proxied");
  await page.getByRole("dialog", { name: /Save as view/ }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Running proxied");
  await expect(page.getByText("Modified", { exact: true })).toHaveCount(0);
  await expect.poll(() => names(page)).toEqual(["Amazon US seller", "eBay DE buyer"]);
  await sidebar(page).getByText("Proxied ones", { exact: true }).click();
  await expect(page.getByText("Modified", { exact: true })).toHaveCount(0);
  await expect.poll(() => names(page)).toHaveLength(7);
});

test("a View follows its Folder's rename", async ({ page }) => {
  await seedViews(page, { version: 1, views: [{ id: "v-ads", name: "Ads idle", pinned: true, query: { folder: "Ads", filters: { status: "idle", country: "", proxy: "all", tag: "", lastRun: "any" }, sort: "added", columns: ALL_COLUMNS } }] });
  await openApp(page);
  await sidebar(page).locator("[data-folder='Ads']").click({ button: "right" });
  await page.getByRole("menuitem", { name: /Edit/ }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Advertising");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  // The profiles move over once the list reloads.
  await expect(sidebar(page).locator("[data-folder='Ads']")).toHaveCount(0);
  await sidebar(page).getByText("Ads idle", { exact: true }).click();
  await expect(page.getByText("Modified", { exact: true })).toHaveCount(0);
  expect(await names(page)).toHaveLength(3);
});

test("a broken views value means no custom Views; an old View gets the new filters' defaults", async ({ page }) => {
  await seedViews(page, { version: 1, views: [{ id: "v-old", name: "Old one", pinned: true, query: { folder: "all", filters: { status: "running", country: "", proxy: "all" }, sort: "added", columns: ALL_COLUMNS } }, { id: 7 }] });
  await openApp(page);
  await sidebar(page).getByText("Old one", { exact: true }).click();
  expect(await names(page)).toEqual(["Amazon US seller", "eBay DE buyer"]);
  // Tag and Last run, saved before they existed, read as "any": one filter is on.
  await expect(page.getByRole("button", { name: /^Filters/ })).toHaveText("Filters (1)");
  await page.evaluate(() => localStorage.setItem("shardx.views", "{nope"));
  await page.reload();
  await expect(sidebar(page).getByText("Old one", { exact: true })).toHaveCount(0);
  // Task 5f: a running Pinned profile shows its own "Running" word too.
  await expect(sidebar(page).locator("[data-view='builtin:running']")).toBeVisible();
});

test("Settings > Views renames, shows in the sidebar and deletes with Undo", async ({ page }) => {
  await seedViews(page, { version: 1, views: [
    { id: "v-a", name: "Alpha", pinned: false, query: { folder: "all", filters: { status: "all", country: "", proxy: "all", tag: "", lastRun: "any" }, sort: "name-asc", columns: ALL_COLUMNS } },
  ] });
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Views" }).click();
  const alpha = page.locator("[data-view-row='v-a']");
  await alpha.getByRole("textbox", { name: "Name of the view “Alpha”" }).fill("Alphabetical");
  await alpha.getByRole("textbox", { name: "Name of the view “Alpha”" }).press("Enter");
  await alpha.getByRole("switch", { name: /sidebar/ }).click();
  // The rename and the pin wait for Save (manual save).
  await expect(sidebar(page).getByText("Alphabetical", { exact: true })).toHaveCount(0);
  await page.locator("[data-save-bar]").getByRole("button", { name: "Save", exact: true }).click();
  await expect(sidebar(page).getByText("Alphabetical", { exact: true })).toBeVisible();
  await alpha.getByRole("button", { name: /Delete/ }).click();
  await expect(sidebar(page).getByText("Alphabetical", { exact: true })).toHaveCount(0);
  await page.locator("[data-toast]").getByRole("button", { name: "Undo" }).click();
  await expect(sidebar(page).getByText("Alphabetical", { exact: true })).toBeVisible();
});

test("a taken name is refused, and the sidebar menu renames, hides and deletes a View", async ({ page }) => {
  await seedViews(page, { version: 1, views: [
    { id: "v-a", name: "Alpha", pinned: true, query: { folder: "all", filters: { status: "all", country: "", proxy: "all", tag: "", lastRun: "any" }, sort: "name-asc", columns: ALL_COLUMNS } },
  ] });
  await openApp(page);
  await sidebar(page).getByText("Alpha", { exact: true }).click();
  await sidebar(page).locator("[data-view='v-a']").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const dialog = page.getByRole("dialog", { name: /Rename view/ });
  await dialog.getByRole("textbox", { name: "View name" }).fill("running");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toContainText("already");
  await dialog.getByRole("textbox", { name: "View name" }).fill("Beta");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Beta");
  await sidebar(page).locator("[data-view='v-a']").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete" }).click();
  // The View applied is left first: the list is back.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("All profiles");
  await expect(sidebar(page).locator("[data-view='v-a']")).toHaveCount(0);
});

const TAGS = {
  version: 1,
  tags: [{ id: "t-warm", name: "Warm-up", color: "orange" }, { id: "t-vip", name: "VIP", color: "violet" }],
  byProfile: { f62a9d43: ["t-warm"], aed41005: ["t-warm", "t-vip"] },
};
const seedTags = (page: Page) => page.addInitScript((v) => {
  if (localStorage.getItem("shardx.tags") === null) localStorage.setItem("shardx.tags", JSON.stringify(v));
}, TAGS);
async function deleteVip(page: Page) {
  await page.locator("aside").getByText("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Tags" }).click();
  // Behind an Undo toast, nothing asked (ruling 18).
  await page.locator("[data-tag-row='t-vip']").getByRole("button", { name: /Delete/ }).click();
  await expect(page.locator("[data-tag-row='t-vip']")).toHaveCount(0);
}

test("a View on a deleted tag stops filtering by it, applied before or after", async ({ page }) => {
  await seedTags(page);
  await seedViews(page, { version: 1, views: [{ id: "v-vip", name: "VIP ones", pinned: true, query: { folder: "all", filters: { status: "all", country: "", proxy: "all", tag: "t-vip", lastRun: "any" }, sort: "added", columns: ALL_COLUMNS } }] });
  await openApp(page);
  await sidebar(page).getByText("VIP ones", { exact: true }).click();
  expect(await names(page)).toEqual(["Etsy craft shop"]);
  await deleteVip(page);
  await sidebar(page).getByText("VIP ones", { exact: true }).click();
  await expect(page.locator("[role='row'][data-profile-id]")).toHaveCount(8);
  await expect(page.getByText("Modified", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
  await sidebar(page).getByText("All profiles", { exact: true }).click();
  await sidebar(page).getByText("VIP ones", { exact: true }).click();
  await expect(page.locator("[role='row'][data-profile-id]")).toHaveCount(8);
  await expect(sidebar(page).locator("[data-view='v-vip'] [data-count]")).toHaveText("8");
});

test("the list's own Tag filter, kept while a View is applied, goes with a deleted tag", async ({ page }) => {
  await seedTags(page);
  await openApp(page);
  await filterBy(page, "Tag", "VIP");
  await expect(page.locator("[role='row'][data-profile-id]")).toHaveCount(1);
  await sidebar(page).getByText("No proxy", { exact: true }).click();
  await deleteVip(page);
  await sidebar(page).getByText("All profiles", { exact: true }).click();
  await expect(page.locator("[role='row'][data-profile-id]")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
});

test("renaming an empty Folder keeps the list, and a View, on it", async ({ page }) => {
  await page.addInitScript(() => { if (localStorage.getItem("shardx-folders") === null) localStorage.setItem("shardx-folders", JSON.stringify(["Empty1"])); });
  await seedViews(page, { version: 1, views: [{ id: "v-e", name: "Empty view", pinned: true, query: { folder: "Empty1", filters: { status: "all", country: "", proxy: "all", tag: "", lastRun: "any" }, sort: "added", columns: ALL_COLUMNS } }] });
  await openApp(page);
  const rename = async (from: string, to: string) => {
    await sidebar(page).locator(`[data-folder='${from}']`).click({ button: "right" });
    await page.getByRole("menuitem", { name: /Edit/ }).click();
    await page.getByRole("textbox", { name: "Name" }).fill(to);
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(sidebar(page).locator(`[data-folder='${to}']`)).toBeVisible();
  };
  await sidebar(page).locator("[data-folder='Empty1']").click();
  await rename("Empty1", "Empty2");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Empty2");
  await sidebar(page).locator("[data-view='v-e']").click();
  await rename("Empty2", "Empty3");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Empty view");
  await expect(page.getByText("Modified", { exact: true })).toHaveCount(0);
  await expect(page.locator("[role='row'][data-profile-id]")).toHaveCount(0);
});

test("a Folder deleted under a View leaves the View showing every Folder", async ({ page }) => {
  await seedViews(page, { version: 1, views: [{ id: "v-ads", name: "Ads idle", pinned: true, query: { folder: "Ads", filters: { status: "idle", country: "", proxy: "all", tag: "", lastRun: "any" }, sort: "added", columns: ALL_COLUMNS } }] });
  await openApp(page);
  await sidebar(page).getByText("Ads idle", { exact: true }).click();
  expect(await names(page)).toHaveLength(3);
  await sidebar(page).locator("[data-folder='Ads']").click({ button: "right" });
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete folder only" }).click();
  await expect(sidebar(page).locator("[data-folder='Ads']")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ads idle");
  await expect(page.getByText("Modified", { exact: true })).toHaveCount(0);
  await expect(page.locator("[role='row'][data-profile-id]")).toHaveCount(6);
});

test.describe("at the minimum window size", () => {
  test.use({ viewport: { width: 1024, height: 680 } });
  const LONG = { version: 1, views: [{ id: "v-long", name: "Idle profiles in the advertising folder", pinned: true, query: { folder: "Ads", filters: { status: "idle", country: "", proxy: "all", tag: "", lastRun: "any" }, sort: "added", columns: ALL_COLUMNS } }] };
  /** The header's controls stay inside it and never cover one another. */
  async function headerFits(page: Page) {
    const header = page.locator("main header").first();
    expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const newProfile = (await header.getByRole("button", { name: "New profile" }).boundingBox())!;
    const box = (await header.boundingBox())!;
    expect(newProfile.x + newProfile.width).toBeLessThanOrEqual(box.x + box.width);
    // The caption buttons sit in the window's corner, outside the header (F5).
    const minimize = page.locator("[data-captions]").getByRole("button", { name: "Minimize" });
    if (await minimize.count()) expect(newProfile.x + newProfile.width).toBeLessThanOrEqual((await minimize.boundingBox())!.x);
    await expect(header.getByRole("button", { name: "Reset" })).toBeVisible();
  }

  test("a changed custom View with a long name fits the header", async ({ page }) => {
    await seedViews(page, LONG);
    await openApp(page);
    // The sidebar shows icons only at this width.
    await sidebar(page).locator("[data-view='v-long']").click();
    await filterBy(page, "Last run", "Last 7 days");
    await headerFits(page);
    await expect(page.locator("main header").first().getByRole("button", { name: "Update view" })).toBeVisible();
  });

  test.describe("on Windows", () => {
    test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" });
    test("a changed built-in View fits beside the window controls", async ({ page }) => {
      await openApp(page);
      await sidebar(page).locator("[data-view='builtin:running']").click();
      await filterBy(page, "Last run", "Last 7 days");
      await headerFits(page);
      await expect(page.locator("main header").first().getByRole("button", { name: "Save as view" })).toBeVisible();
    });
  });
});

test("Save as view works where crypto.randomUUID is missing (a window that isn't a secure context)", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(Crypto.prototype, "randomUUID", { value: undefined, configurable: true }); });
  await openApp(page);
  // An order alone is enough to save (Pair 24 review, Important 1).
  await pick(page, "Display", "Order", "Name, Z to A");
  await page.getByRole("button", { name: "Save as view" }).click();
  await page.getByRole("textbox", { name: "View name" }).fill("Mine");
  await page.getByRole("dialog", { name: /Save as view/ }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mine");
  await expect(sidebar(page).getByText("Mine", { exact: true })).toBeVisible();
});
