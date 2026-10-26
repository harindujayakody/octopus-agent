import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// Clarity fixes, item 19: getting back to the projects list from a project was
// "really hard" (a small link in a path), and Projects/Modules was an awkward
// switch. Now: a Back button, Esc, and the sidebar's Automation item all
// return to the list, each through the unsaved-changes question; the page is
// the projects list alone, and the modules are managed from Add step. No
// @visual shots.

type Mock = { __shardxMock: { calls: Record<string, number> } };

async function openEditor(page: Page) {
  await openApp(page, { section: "automation" });
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Add step" })).toBeVisible();
}

const rows = (page: Page) => page.locator("[role='listitem'][data-row-id]");
const backButton = (page: Page) => page.locator("main header").getByRole("button", { name: "Projects", exact: true });
const guard = (page: Page) => page.getByRole("alertdialog", { name: "Save changes to Pricing scrape 6h?" });
const saves = (page: Page) => page.evaluate(() => (window as unknown as Mock).__shardxMock.calls.automation_save ?? 0);

/** A change to the draft that leaves no field focused. */
async function makeUnsaved(page: Page) {
  await page.locator('[data-step-card="b3"]').click();
  await page.getByRole("textbox", { name: "Target" }).fill("table.costs");
  await expect(page.locator("[data-editor-save]")).toContainText("Unsaved changes");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

test("← Projects returns to the list", async ({ page }) => {
  await openEditor(page);
  // One button with an arrow before the word, not a small link in a path.
  await expect(page.getByRole("navigation", { name: "Path" })).toHaveCount(0);
  await expect(backButton(page)).toBeVisible();
  await expect(backButton(page).locator("svg")).toHaveCSS("width", "14px");
  await backButton(page).click();
  await expect(rows(page).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add step" })).toHaveCount(0);
});

test("Esc returns when nothing is focused, not while typing", async ({ page }) => {
  await openEditor(page);
  const name = page.getByRole("textbox", { name: "Project name" });

  // In a field: Esc is the field's.
  await name.focus();
  await page.keyboard.press("Escape");
  await expect(name).toBeVisible();

  // A dialog takes its own Esc, and the editor stays.
  await page.getByRole("button", { name: "Add step" }).click();
  const library = page.getByRole("dialog", { name: "Add a step" });
  await expect(library).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(library).toHaveCount(0);
  await expect(name).toBeVisible();

  // So does a menu.
  await page.getByRole("button", { name: "More", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(name).toBeVisible();

  // And a popover.
  await page.locator("main header").locator("button[aria-haspopup='dialog']").click();
  const popover = page.getByRole("dialog", { name: "Run settings" });
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(name).toBeVisible();

  // Nothing has the keyboard: Esc goes back.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
  await expect(rows(page).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add step" })).toHaveCount(0);
});

test("Esc with unsaved changes asks first, and Cancel stays", async ({ page }) => {
  await openEditor(page);
  await makeUnsaved(page);
  const sent = await saves(page);
  await page.keyboard.press("Escape");
  await expect(guard(page)).toBeVisible();
  // Esc inside the question is its Cancel.
  await page.keyboard.press("Escape");
  await expect(guard(page)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Target" })).toHaveValue("table.costs");
  expect(await saves(page)).toBe(sent);

  await backButton(page).click();
  await guard(page).getByRole("button", { name: "Don’t save" }).click();
  await expect(rows(page).first()).toBeVisible();
  expect(await saves(page)).toBe(sent);
});

test("sidebar Automation returns to the list", async ({ page }) => {
  await openEditor(page);
  await page.locator("aside [data-nav='automation']").click();
  await expect(rows(page).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add step" })).toHaveCount(0);
  // On the list it stays the list.
  await page.locator("aside [data-nav='automation']").click();
  await expect(rows(page).first()).toBeVisible();
});

test("sidebar Automation with unsaved changes asks first", async ({ page }) => {
  await openEditor(page);
  await makeUnsaved(page);
  await page.locator("aside [data-nav='automation']").click();
  await expect(guard(page)).toBeVisible();
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect(guard(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add step" })).toBeVisible();
  const sent = await saves(page);

  await page.locator("aside [data-nav='automation']").click();
  await guard(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(rows(page).first()).toBeVisible();
  expect(await saves(page)).toBe(sent + 1);
});

test("no Projects/Modules segment: the page is the projects list, with a count", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.locator("main header").getByRole("tab")).toHaveCount(0);
  await expect(page.locator("main header [data-count]")).toHaveText("2");
  await expect(page.getByRole("list", { name: "Projects" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New project", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import" })).toBeVisible();
  // The module buttons left the page header with the segment.
  await expect(page.getByRole("button", { name: "Add module" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open folder" })).toHaveCount(0);
  await expect(page.getByRole("treegrid", { name: "Modules" })).toHaveCount(0);
});

test("Add step → Manage modules opens the modules dialog", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Add step" }).click();
  const library = page.getByRole("dialog", { name: "Add a step" });
  await library.getByRole("button", { name: "Manage modules" }).click();
  const modules = page.getByRole("dialog", { name: "Modules" });
  await expect(modules).toBeVisible();
  await expect(modules.getByRole("treegrid", { name: "Modules" })).toBeVisible();
  await expect(modules.getByRole("button", { name: "Add module" })).toBeVisible();
  await expect(modules.getByRole("button", { name: "Open folder" })).toBeVisible();
  // The close button closes it; the library is still there under it.
  await modules.getByRole("button", { name: "Close" }).click();
  await expect(modules).toHaveCount(0);
  await expect(library).toBeVisible();
});
