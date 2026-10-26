import { expect, test, type Page } from "@playwright/test";
import { openApp, reloadApp } from "./support/app";
import { filterBy, unfilter } from "./support/filters";

// Edit view (owner, 2026-10-07, item 15 and ruling 3): a custom View's own
// filters are locked on the list; "Edit view" opens them as normal chips, with
// Cancel and Save view beside the title. Nothing is written to the View until
// Save view (manual save), and leaving with changes asks. Built-in views
// (Running, No proxy, Recently used) cannot be edited.

const names = (page: Page) => page.locator("[role='row'][data-profile-id] [data-cell='name']").allTextContents();
const sidebar = (page: Page) => page.locator("aside nav");
const lock = (page: Page) => page.locator("[data-filter-chips] [data-view-lock]");
const chips = (page: Page) => page.locator("[data-filter-chips] [data-chip]");
const editing = (page: Page) => page.getByText("Editing view", { exact: true });
const saveView = (page: Page) => page.getByRole("button", { name: "Save view" });
const guard = (page: Page) => page.getByRole("alertdialog", { name: "Save changes to Idle ones?" });
const ALL_COLUMNS = { folder: true, tags: true, lastRun: true, notes: true };
const IDLE = { id: "v-idle", name: "Idle ones", pinned: true, query: { folder: "all", filters: { status: "idle", country: "", proxy: "all", tag: "", lastRun: "any" }, sort: "added", columns: ALL_COLUMNS } };

const seedViews = (page: Page) => page.addInitScript((v) => {
  if (localStorage.getItem("shardx.views") === null) localStorage.setItem("shardx.views", JSON.stringify({ version: 1, views: [v] }));
}, IDLE);
const savedStatus = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("shardx.views") ?? "null").views[0].query.filters.status);

/** Opens "Idle ones" and its sidebar menu's Edit view. */
async function editIdle(page: Page) {
  await sidebar(page).getByText("Idle ones", { exact: true }).click();
  await expect(lock(page)).toHaveText("View: Idle ones");
  await sidebar(page).locator("[data-view='v-idle']").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit view" }).click();
  await expect(editing(page)).toBeVisible();
}

test("Edit view opens the view's own filter as a chip; removing it and Save view keeps that after a reload", async ({ page }) => {
  await seedViews(page);
  await openApp(page);
  await editIdle(page);
  // Unlocked: the label is gone and Status is a normal removable chip.
  await expect(lock(page)).toHaveCount(0);
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).first()).toHaveText(/^Status: Idle$/);
  // Nothing to save yet.
  await expect(saveView(page)).toBeDisabled();
  await unfilter(page, "status");
  await expect(chips(page)).toHaveCount(0);
  await expect.poll(() => names(page)).toHaveLength(8);
  // Nothing is written before the press.
  expect(await savedStatus(page)).toBe("idle");
  await saveView(page).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Idle ones saved")).toBeVisible();
  await expect(editing(page)).toHaveCount(0);
  await expect(lock(page)).toHaveCount(0);
  expect(await savedStatus(page)).toBe("all");
  await reloadApp(page);
  await sidebar(page).getByText("Idle ones", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Idle ones");
  await expect(lock(page)).toHaveCount(0);
  await expect.poll(() => names(page)).toHaveLength(8);
});

test("Cancel puts the view's own filter back", async ({ page }) => {
  await seedViews(page);
  await openApp(page);
  await editIdle(page);
  await unfilter(page, "status");
  await expect.poll(() => names(page)).toHaveLength(8);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(editing(page)).toHaveCount(0);
  await expect(lock(page)).toHaveText("View: Idle ones");
  await expect(chips(page)).toHaveCount(0);
  await expect.poll(() => names(page)).toHaveLength(6);
  await expect(page.getByText("Modified", { exact: true })).toHaveCount(0);
  expect(await savedStatus(page)).toBe("idle");
});

test("leaving while editing asks: Cancel stays, Don't save drops the edit, Save keeps it", async ({ page }) => {
  await seedViews(page);
  await openApp(page);
  await editIdle(page);
  // Opened and not changed: nothing to ask about.
  await sidebar(page).getByText("All profiles", { exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("All profiles");
  await expect(guard(page)).toHaveCount(0);

  await editIdle(page);
  await unfilter(page, "status");
  await sidebar(page).getByText("All profiles", { exact: true }).click();
  await expect(guard(page)).toBeVisible();
  // Cancel: still editing the view, the change still there.
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect(guard(page)).toHaveCount(0);
  await expect(editing(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Idle ones");
  // Another page asks too; Don't save drops the edit and goes there.
  await page.locator("aside").getByText("Settings", { exact: true }).click();
  await expect(guard(page)).toBeVisible();
  await guard(page).getByRole("button", { name: "Don’t save" }).click();
  await expect(page.getByRole("tab", { name: "General" })).toBeVisible();
  expect(await savedStatus(page)).toBe("idle");
  await sidebar(page).getByText("Idle ones", { exact: true }).click();
  await expect(editing(page)).toHaveCount(0);
  await expect(lock(page)).toHaveText("View: Idle ones");
  await expect.poll(() => names(page)).toHaveLength(6);

  // Save keeps the edit and goes on to All profiles.
  await editIdle(page);
  await unfilter(page, "status");
  await sidebar(page).getByText("All profiles", { exact: true }).click();
  await guard(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("All profiles");
  expect(await savedStatus(page)).toBe("all");
});

test("making a Folder from the sidebar while editing asks first: Cancel stays, Don't save opens the Folder", async ({ page }) => {
  await seedViews(page);
  await openApp(page);
  await editIdle(page);
  await unfilter(page, "status");
  const makeFolder = async (name: string) => {
    await page.getByRole("button", { name: "New folder" }).click();
    const dialog = page.getByRole("dialog", { name: /New folder/ });
    await dialog.getByRole("textbox", { name: "Name" }).fill(name);
    await dialog.getByRole("button", { name: "Create" }).click();
  };
  await makeFolder("Clients");
  await expect(guard(page)).toBeVisible();
  // The Folder is made either way; Cancel stays on the edit, with its change.
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect(sidebar(page).locator("[data-folder='Clients']")).toBeVisible();
  await expect(editing(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Idle ones");
  // Don't save drops the edit and opens the new Folder.
  await makeFolder("Leads");
  await guard(page).getByRole("button", { name: "Don’t save" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Leads");
  await expect(editing(page)).toHaveCount(0);
  expect(await savedStatus(page)).toBe("idle");
});

test("built-in views have no Edit view; a custom view's Filters menu says why a field is locked and offers it", async ({ page }) => {
  await seedViews(page);
  await openApp(page);
  // Running: no menu on its sidebar row, no Edit view in the palette, none in the Filters menu.
  await sidebar(page).locator("[data-view='builtin:running']").click();
  await sidebar(page).locator("[data-view='builtin:running']").click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Edit view");
  const options = page.getByRole("dialog", { name: "Command palette" }).getByRole("option");
  await expect(options.filter({ hasText: /^Edit view/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.locator("main header").getByRole("button", { name: /^Filters/ }).click();
  const status = page.getByRole("option", { name: /^Status/ });
  await expect(status).toHaveAttribute("aria-disabled", "true");
  await expect(status).toContainText("Set by this view");
  await expect(page.getByRole("button", { name: "Edit view" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A custom view: the same reason, and the way out. The palette offers it too.
  await sidebar(page).getByText("Idle ones", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Edit view");
  await expect(options.filter({ hasText: /^Edit view/ })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.locator("main header").getByRole("button", { name: /^Filters/ }).click();
  await expect(status).toContainText("Set by this view");
  await page.getByRole("button", { name: "Edit view" }).click();
  await expect(editing(page)).toBeVisible();
  await expect(chips(page)).toHaveCount(1);
  // Open now: Status can be picked in the menu.
  await filterBy(page, "Status", "Running");
  await expect(chips(page).first()).toHaveText(/^Status: Running$/);
  await expect.poll(() => names(page)).toEqual(["Amazon US seller", "eBay DE buyer"]);
});

test("Cmd/Ctrl+S saves the view being edited; with nothing changed it does nothing", async ({ page }) => {
  await seedViews(page);
  await openApp(page);
  await editIdle(page);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(editing(page)).toBeVisible();
  await unfilter(page, "status");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(editing(page)).toHaveCount(0);
  expect(await savedStatus(page)).toBe("all");
});
