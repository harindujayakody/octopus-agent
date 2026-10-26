import { expect, test, type Page } from "@playwright/test";
import { NOW, openApp, reloadApp } from "./support/app";

// The Automation projects page: a grid of project cards (owner, 2026-10-08;
// before that two-line rows), each with its name, description, step chain,
// last run and Run; module rows with a request row under them. Clarity fixes,
// item 19: the page is the projects list alone, and the modules are managed
// from a project (Add step, Manage modules). No @visual shots.

type Mock = {
  __shardxMock: {
    state: { automation: { id: string; blocks: { id: string; kind: string; label: string; enabled: boolean; on_done: string; on_fail: string; params: object; secrets: string[]; x: number; y: number }[] }[]; modules: unknown[] };
    save: () => void;
    calls: Record<string, number>;
  };
};

const project = (page: Page, name: string) => page.locator("[role='listitem'][data-row-id]", { hasText: name });
const moduleRow = (page: Page, id = "sheets") => page.locator(`[role='row'][data-row-id='${id}']`);
const backToList = (page: Page) => page.locator("main header").getByRole("button", { name: "Projects", exact: true });

/** Opens Pricing scrape 6h, then Add step, then Manage modules: the modules dialog. */
async function openModules(page: Page) {
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByRole("dialog", { name: "Add a step" }).getByRole("button", { name: "Manage modules" }).click();
  const dialog = page.getByRole("dialog", { name: "Modules" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("Add step has Manage modules, which opens the modules dialog with the page's old buttons", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const dialog = await openModules(page);
  // The list, the folder and the install button moved into the dialog.
  await expect(dialog.getByRole("treegrid", { name: "Modules" })).toBeVisible();
  await expect(moduleRow(page)).toContainText("Google Sheets");
  await expect(dialog.getByRole("button", { name: "Open folder" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add module" })).toBeVisible();
  // The request row fits the dialog's width: Allow ends inside the list, not past its edge.
  const allow = (await dialog.locator("[data-module-request]").getByRole("button", { name: "Allow" }).boundingBox())!;
  const grid = (await dialog.getByRole("treegrid", { name: "Modules" }).boundingBox())!;
  expect(allow.x + allow.width).toBeLessThanOrEqual(grid.x + grid.width);
  // Esc closes the dialog and leaves the library under it; the library's own Esc closes that.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Add a step" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add a step" })).toHaveCount(0);
});

test("a module added in the dialog shows its steps in the library when the dialog closes", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const dialog = await openModules(page);
  await dialog.getByRole("button", { name: "Add module" }).first().click();
  const added = page.locator("[data-toast]").filter({ hasText: /added: 1 step/ });
  await expect(added).toBeVisible();
  await page.keyboard.press("Escape");
  const library = page.getByRole("dialog", { name: "Add a step" });
  await library.getByRole("combobox").fill("Custom step");
  await expect(library.getByRole("option", { name: /Custom step/ })).toBeVisible();
});

test("removing the module whose group is chosen leaves the library on its first category", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const dialog = await openModules(page);
  // The mock's new module has no group of its own to join, so it gets one named for it.
  await dialog.getByRole("button", { name: "Add module" }).first().click();
  await expect(page.locator("[data-toast]").filter({ hasText: /added: 1 step/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  const library = page.getByRole("dialog", { name: "Add a step" });
  const categories = library.getByRole("group", { name: "Categories" }).getByRole("button");
  await categories.getByText("export", { exact: true }).click();
  await expect(library.getByRole("option", { name: /Custom step/ })).toBeVisible();

  await library.getByRole("button", { name: "Manage modules" }).click();
  const added = dialog.locator("[role='row'][data-row-id^='mod-']");
  await added.hover();
  await dialog.getByRole("button", { name: "Remove export" }).click();
  await expect(added).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  // Its category is gone: the first one shows, chosen, with its steps.
  await expect(categories.first()).toHaveAttribute("aria-pressed", "true");
  await expect(library.getByText(/No steps match/)).toHaveCount(0);
  await expect(library.getByRole("option").first()).toBeVisible();
});

test("a module waiting for approval is named in the header, and Review opens the modules dialog", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const awaiting = page.locator("main header [data-modules-awaiting]");
  await expect(awaiting).toContainText("1 module needs approval");
  await awaiting.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Modules" });
  const request = dialog.locator("[data-module-request]");
  await expect(request).toContainText("Needs approval");
  await request.getByRole("button", { name: "Allow" }).click();
  await expect(request).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
  // Answered: nothing waits, so the header says nothing.
  await expect(awaiting).toHaveCount(0);
});

test("a denied request no longer waits, and stays answered after a reload", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const awaiting = page.locator("main header [data-modules-awaiting]");
  await awaiting.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Modules" });
  await dialog.locator("[data-module-request]").getByRole("button", { name: "Deny" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(awaiting).toHaveCount(0);
  await reloadApp(page);
  await expect(page.locator("main header [data-count]")).toHaveText("2");
  await expect(awaiting).toHaveCount(0);
});

test("the explainer sits behind the help button, says where the modules went, and the name field is gone", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await expect(page.getByPlaceholder("New project name")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "About this page" }).click();
  const help = page.getByRole("dialog", { name: "About automation" });
  await expect(help).toContainText("choose “Add step”, then “Manage modules”");
});

test("New project opens the editor with its name selected", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const name = page.getByRole("textbox", { name: "Project name" });
  await expect(name).toHaveValue("New project");
  await expect(name).toBeFocused();
  expect(await name.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, "New project".length]);
  await page.keyboard.type("Checkout test");
  await expect(name).toHaveValue("Checkout test");
});

/** The fleet as the Fleet monitor reads it, held to `runs` (a finished run stays in it until the next one). */
async function fleetOf(page: Page, runs: object[]) {
  await page.evaluate((fleet) => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, ...rest: unknown[]) => Promise<unknown> } };
    const real = w.__TAURI_INTERNALS__.invoke.bind(w.__TAURI_INTERNALS__);
    w.__TAURI_INTERNALS__.invoke = (cmd, ...rest) => (cmd === "automation_fleet" ? Promise.resolve(fleet) : real(cmd, ...rest));
  }, runs);
}

const worker = (status: string) => ({ profile_id: "e51f8c32", profile_name: "Scraper pricing", pass: 1, step: 1, steps_total: 5, status, note: "" });
const ranAt = (projectId: string, agoSecs: number, status: string, running = false) => ({
  project_id: projectId, project_name: projectId, started_at: Math.floor(NOW.getTime() / 1000) - agoSecs - 30, running,
  workers: [worker(status)], log: [`[${Math.floor(NOW.getTime() / 1000) - agoSecs - 30}] started`, `[${Math.floor(NOW.getTime() / 1000) - agoSecs}] finished`],
});

test("the projects are cards in a grid, newest change first, each a tile with no border", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const list = page.getByRole("list", { name: "Projects" });
  await expect(list).toBeVisible();
  await expect(page.getByRole("treegrid", { name: "Projects" })).toHaveCount(0);
  await expect(list.getByRole("listitem")).toHaveCount(2);
  // Sorted by Updated, newest first: Pricing (yesterday) before Ads (2 days ago).
  await expect(list.getByRole("listitem").first()).toContainText("Pricing scrape 6h");
  await expect(list.getByRole("listitem").nth(1)).toContainText("Ads account warm-up");
  // No table is left: no header row, no columns.
  await expect(page.locator("main [data-list-header]")).toHaveCount(0);
  await expect(page.getByRole("columnheader")).toHaveCount(0);
  const edges = await project(page, "Pricing scrape 6h").evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth];
  });
  expect(edges).toEqual(["0px", "0px", "0px", "0px"]);
  // Two cards side by side share a row; the Extensions grid's card width.
  const [a, b] = await Promise.all([project(page, "Pricing scrape 6h").boundingBox(), project(page, "Ads account warm-up").boundingBox()]);
  expect(a!.width).toBeGreaterThanOrEqual(280);
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(1);
  expect(Math.abs(a!.height - b!.height)).toBeLessThan(1);
});

test("a project card shows its name, description, steps as icons in run order, the steps line and the last run", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const pricing = project(page, "Pricing scrape 6h");
  await expect(pricing.getByRole("heading", { level: 2 })).toHaveText("Pricing scrape 6h");
  await expect(pricing.locator("[data-description]")).toHaveText("Opens the competitor list, reads prices, posts to the sheet.");
  await expect(pricing.locator("[data-step-chain] [data-step-icon]")).toHaveCount(5);
  await expect(pricing.locator("[data-step-chain]")).toHaveAccessibleName("Use profile, Open page, Wait for table, Read prices, Post to sheet");
  await expect(pricing.locator("[data-run-summary]")).toHaveText("5 steps, runs for 6 h");
  await expect(pricing.locator("[data-step-more]")).toHaveCount(0);
  // Never run: a word, not a dot alone.
  await expect(pricing.locator("[data-run-status]")).toHaveText("Never run");
  await expect(pricing.getByRole("button", { name: "Run", exact: true })).toBeVisible();
  const warmup = project(page, "Ads account warm-up");
  await expect(warmup.locator("[data-run-summary]")).toHaveText("5 steps, 3 loops");
  // "Open a post" is off: dimmed, the others are not.
  await expect(warmup.locator("[data-step-slot][data-off]")).toHaveCount(1);
  await expect(warmup.locator("[data-step-slot][data-off]")).toHaveCSS("opacity", "0.4");
  await expect(warmup.locator("[data-step-slot]:not([data-off])").first()).toHaveCSS("opacity", "1");
  await expect(warmup.locator("[data-step-icon]").first()).toHaveCSS("width", "14px");
});

test("the description takes two lines at most, and says No description in muted text when empty", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await page.evaluate(() => {
    const m = (window as unknown as Mock).__shardxMock;
    const [pricing, warmup] = m.state.automation as unknown as { id: string; notes: string }[];
    pricing.notes = "word ".repeat(80).trim();
    warmup.notes = "";
    m.save();
  });
  await reloadApp(page);
  const long = project(page, "Pricing scrape 6h").locator("[data-description]");
  expect((await long.boundingBox())!.height).toBeLessThanOrEqual(32.5);
  const none = project(page, "Ads account warm-up").locator("[data-description]");
  await expect(none).toHaveText("No description");
  const [muted, normal] = await Promise.all([none.evaluate((el) => getComputedStyle(el.firstElementChild ?? el).color), long.evaluate((el) => getComputedStyle(el).color)]);
  expect(muted).not.toBe(normal);
  // A long name is cut on one line; the whole name is in its tooltip.
  await page.evaluate(() => {
    const m = (window as unknown as Mock).__shardxMock;
    (m.state.automation[0] as unknown as { name: string }).name = "A project with a very long name that cannot fit on one line of a card, however wide";
    m.save();
  });
  await reloadApp(page);
  const heading = page.getByRole("list", { name: "Projects" }).getByRole("heading", { level: 2 }).first();
  expect((await heading.boundingBox())!.height).toBeLessThan(24);
  await heading.hover();
  await expect(page.getByRole("tooltip")).toHaveText("A project with a very long name that cannot fit on one line of a card, however wide");
});

test("past six steps the chain says how many more", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await page.evaluate(() => {
    const m = (window as unknown as Mock).__shardxMock;
    const p = m.state.automation.find((x) => x.id === "proj-pricing")!;
    // After "Post to sheet" on the canvas: the runner orders steps by place,
    // so a step at 0, 0 would sit before the start and never run.
    for (const [i, id] of ["b6", "b7"].entries()) p.blocks.push({ id, kind: "page.goto", label: `Open ${id}`, params: {}, enabled: true, secrets: [], x: 1380 + i * 260, y: 120, on_done: "next", on_fail: "stop" });
    p.blocks[4].on_done = "next";
    m.save();
  });
  await reloadApp(page);
  const pricing = project(page, "Pricing scrape 6h");
  await expect(pricing.locator("[data-step-chain] [data-step-icon]")).toHaveCount(6);
  await expect(pricing.locator("[data-step-more]")).toHaveText("+1");
  await expect(pricing.locator("[data-run-summary]")).toHaveText("7 steps, runs for 6 h");
});

test("the last run is a word with its time: Finished, Failed, Stopped, or Running", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await fleetOf(page, [ranAt("proj-pricing", 2 * 3600 + 60, "done"), ranAt("proj-warmup", 5 * 60 + 10, "failed")]);
  await expect(project(page, "Pricing scrape 6h").locator("[data-run-status]")).toHaveText("Finished 2 h ago");
  await expect(project(page, "Ads account warm-up").locator("[data-run-status]")).toHaveText("Failed 5 min ago");
  await fleetOf(page, [ranAt("proj-pricing", 20, "stopped"), ranAt("proj-warmup", 0, "running", true)]);
  await expect(project(page, "Pricing scrape 6h").locator("[data-run-status]")).toHaveText("Stopped just now");
  // Running keeps today's words, and Stop takes Run's place.
  const warmup = project(page, "Ads account warm-up");
  await expect(warmup.locator("[data-run-status]")).toHaveText("Running on 1 profile");
  await expect(warmup.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await expect(warmup.getByRole("button", { name: "Run", exact: true })).toHaveCount(0);
});

test("Run starts the saved project without opening it; the card says where, and Stop is there while it runs", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const runs = () => page.evaluate(() => (window as unknown as Mock).__shardxMock.calls.automation_run ?? 0);
  const before = await runs();
  const pricing = project(page, "Pricing scrape 6h");
  await pricing.getByRole("button", { name: "Run", exact: true }).click();
  await expect(pricing.locator("[data-run-status]")).toHaveText("Running on 1 profile");
  expect(await runs()).toBe(before + 1);
  // The click on Run is not a click on the card.
  await expect(page.getByRole("button", { name: "Add step" })).toHaveCount(0);
  await page.mouse.move(0, 0);
  const stop = pricing.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();
  await expect(pricing.getByRole("button", { name: "Run", exact: true })).toHaveCount(0);
  await stop.click();
  await expect(pricing.locator("[data-run-status]")).toHaveText("Stopped just now");
  await expect(project(page, "Ads account warm-up").locator("[data-run-status]")).toHaveText("Never run");
  await expect(pricing.getByRole("button", { name: "Run", exact: true })).toBeVisible();
});

test("a click anywhere on a card opens the editor, the same as Enter on the focused card", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const addStep = page.getByRole("button", { name: "Add step" });
  // On its description, on the step chain, and on the blank part of the tile.
  for (const target of ["[data-description]", "[data-step-chain]", "[data-run-summary]"]) {
    await project(page, "Pricing scrape 6h").locator(target).click();
    await expect(addStep).toBeVisible();
    await backToList(page).click();
    await expect(addStep).toHaveCount(0);
  }
  const card = project(page, "Ads account warm-up");
  await card.focus();
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(addStep).toBeVisible();
  await expect(page.locator("h1").getByRole("textbox", { name: "Project name" })).toHaveValue("Ads account warm-up");
});

test("arrow keys move between cards, Home and End jump, and the grid is one Tab stop", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const first = project(page, "Pricing scrape 6h");
  const second = project(page, "Ads account warm-up");
  // One Tab stop: the first card; the other card and every Run button but the active one's are out of the order.
  await expect(first).toHaveAttribute("tabindex", "0");
  await expect(second).toHaveAttribute("tabindex", "-1");
  await expect(second.getByRole("button", { name: "Run", exact: true })).toHaveAttribute("tabindex", "-1");
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(second).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(first).toBeFocused();
  await page.keyboard.press("End");
  await expect(second).toBeFocused();
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
  // From a card, Tab reaches its own Run, then its More.
  await page.keyboard.press("Tab");
  await expect(first.getByRole("button", { name: "Run", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first.getByRole("button", { name: "More" })).toBeFocused();
});

test("More shows on hover and at focus; its menu is Rename, Duplicate, Export, Delete, and Rename opens the editor on the name", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const pricing = project(page, "Pricing scrape 6h");
  const more = pricing.getByRole("button", { name: "More" });
  await page.mouse.move(0, 0);
  await expect(more).toBeHidden();
  await pricing.hover();
  await expect(more).toBeVisible();
  await more.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Rename", "Duplicate", "Export", "Delete"]);
  await menu.getByRole("menuitem", { name: "Rename" }).click();
  const name = page.getByRole("textbox", { name: "Project name" });
  await expect(name).toHaveValue("Pricing scrape 6h");
  await expect(name).toBeFocused();
  expect(await name.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, "Pricing scrape 6h".length]);
});

test("Duplicate in the menu makes a copy and opens it; Export downloads the project", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const pricing = project(page, "Pricing scrape 6h");
  await pricing.hover();
  await pricing.getByRole("button", { name: "More" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export" }).click();
  expect((await download).suggestedFilename()).toBe("Pricing-scrape-6h.shardx-project.json");
  // Its one secret (the sheet token) is left blank in the file, and the toast says so.
  await expect(page.locator("[data-toast]").getByText("Exported. 1 secret left blank", { exact: true })).toBeVisible();
  await pricing.hover();
  await pricing.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(page.locator("h1").getByRole("textbox", { name: "Project name" })).toHaveValue("Pricing scrape 6h copy");
  await backToList(page).click();
  await expect(page.getByRole("list", { name: "Projects" }).getByRole("listitem")).toHaveCount(3);
});

// Manual save (Task 9): Rename opens the editor on the name; the new name is
// a change to the project like any other, stored on Save.
test("renaming the project waits for Save", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const saves = () => page.evaluate(() => (window as unknown as Mock).__shardxMock.calls.automation_save ?? 0);
  const storedName = () => page.evaluate(() => ((window as unknown as Mock).__shardxMock.state.automation.find((p) => p.id === "proj-pricing") as unknown as { name: string }).name);
  const sent = await saves();
  const pricing = project(page, "Pricing scrape 6h");
  await pricing.hover();
  await pricing.getByRole("button", { name: "More" }).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "Rename" }).click();
  const name = page.getByRole("textbox", { name: "Project name" });
  await expect(name).toBeFocused();
  await page.keyboard.type("Pricing scrape 12h");
  await expect(name).toHaveValue("Pricing scrape 12h");
  const save = page.locator("[data-editor-save]");
  await expect(save).toContainText("Unsaved changes");
  await page.waitForTimeout(500);
  expect(await saves()).toBe(sent);
  expect(await storedName()).toBe("Pricing scrape 6h");
  await save.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-toast]").getByText("Project saved", { exact: true })).toBeVisible();
  expect(await saves()).toBe(sent + 1);
  expect(await storedName()).toBe("Pricing scrape 12h");
  await backToList(page).click();
  await expect(project(page, "Pricing scrape 12h")).toBeVisible();
  await expect(project(page, "Pricing scrape 6h")).toHaveCount(0);
});

test("Delete removes the project behind an Undo toast, and Undo brings it back", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const pricing = project(page, "Pricing scrape 6h");
  await pricing.hover();
  await pricing.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(pricing).toHaveCount(0);
  await expect(page.locator("[data-toast]").filter({ hasText: "Deleted “Pricing scrape 6h”" })).toBeVisible();
  await page.locator("[data-toast]").getByRole("button", { name: "Undo" }).click();
  await expect(pricing).toHaveCount(1);
});

test("a module row shows the file name only; the full path is in its tooltip, with a copy button", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await openModules(page);
  const row = moduleRow(page);
  await expect(row).toContainText("Google Sheets");
  await expect(row).toContainText("Adds 1 step: Append row");
  await expect(row.locator("[data-module-file]")).toHaveText("sheets.wasm");
  await expect(row).not.toContainText("/Users/you");
  await expect(row).toContainText("Run variables rows and sheet");
  await row.locator("[data-module-file]").hover();
  await expect(page.getByRole("tooltip")).toHaveText("/Users/you/Library/Application Support/ShardX/modules/sheets.wasm");
  await row.hover();
  await row.getByRole("button", { name: "Copy path" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Copied path" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __shardxMockClipboard?: string }).__shardxMockClipboard)).toBe("/Users/you/Library/Application Support/ShardX/modules/sheets.wasm");
});

test("Remove is neutral until its own hover", async ({ page }) => {
  await openApp(page, { section: "automation", theme: "light" });
  await openModules(page);
  const row = moduleRow(page);
  await row.hover();
  const remove = row.getByRole("button", { name: "Remove Google Sheets" });
  const before = await remove.evaluate((el) => getComputedStyle(el).color);
  await remove.hover();
  await expect.poll(() => remove.evaluate((el) => getComputedStyle(el).color)).not.toBe(before);
});

test("a permission request is one row: Needs approval, what it wants, its reason; Allow clears it", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await openModules(page);
  const request = page.locator("[data-module-request]");
  await expect(request).toContainText("Needs approval");
  await expect(request).toContainText("Wants to run any of your projects.");
  await expect(request).toContainText("Its reason: “sheets needs to read the run variables it appends”");
  const text = await moduleRow(page).innerText();
  expect(text).not.toContain("—");
  expect(text).not.toContain("flow *");
  await request.getByRole("button", { name: "Allow" }).click();
  await expect(request).toHaveCount(0);
});

test("Deny clears the request and it stays cleared after a reload", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await openModules(page);
  await page.locator("[data-module-request]").getByRole("button", { name: "Deny" }).click();
  await expect(page.locator("[data-module-request]")).toHaveCount(0);
  await reloadApp(page);
  await openModules(page);
  await expect(moduleRow(page)).toBeVisible();
  await expect(page.locator("[data-module-request]")).toHaveCount(0);
});

test("a module that failed to load shows its error in words", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await page.evaluate(() => {
    const m = (window as unknown as Mock).__shardxMock;
    (m.state.modules[0] as { error: string }).error = "the file is not a WebAssembly module";
    m.save();
  });
  await reloadApp(page);
  await openModules(page);
  await expect(moduleRow(page)).toContainText("Didn’t load: the file is not a WebAssembly module");
});

test("both zero states are the kit's action tile with a one-line hint", async ({ page }) => {
  await openApp(page, { section: "automation" });
  // No modules, one project to reach the dialog from.
  await page.evaluate(() => {
    const m = (window as unknown as Mock).__shardxMock;
    m.state.modules.length = 0;
    m.save();
  });
  await reloadApp(page);
  const dialog = await openModules(page);
  const emptyModules = dialog.locator("[data-empty-state]");
  await expect(emptyModules.getByRole("button", { name: "Add module" })).toBeVisible();
  await expect(emptyModules).toContainText("A WebAssembly file that adds its own steps.");
  await expect(dialog.getByText("File", { exact: true })).toHaveCount(0);

  // No projects.
  await page.evaluate(() => {
    const m = (window as unknown as Mock).__shardxMock;
    m.state.automation.length = 0;
    m.save();
  });
  await reloadApp(page);
  const empty = page.locator("main [data-empty-state]");
  await expect(empty.getByRole("button", { name: "New project" })).toBeVisible();
  await expect(empty).toContainText("A list of steps your profiles run, like a person.");
  // No header row over an empty list.
  await expect(page.getByText("Updated", { exact: true })).toHaveCount(0);
});

test("the projects count in the header waits for the placeholder rows to go", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shardxMockLatency: number; __shardxMockSlow: Record<string, number>; __countBeside?: boolean };
    w.__shardxMockLatency = 0;
    w.__shardxMockSlow = { automation_list: 300 };
    new MutationObserver(() => {
      const count = document.querySelector("main header [data-count]");
      if (document.querySelector("[data-loading] [aria-hidden='true']") && count && /\d/.test(count.textContent ?? "")) w.__countBeside = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await openApp(page, { section: "automation" });
  await expect(page.locator("main header [data-count]")).toHaveText("2");
  expect(await page.evaluate(() => (window as unknown as { __countBeside?: boolean }).__countBeside ?? false)).toBe(false);
});

test("the modules list saves its sort and keeps it after a reload; the projects keep no list layout", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await openModules(page);
  await page.getByRole("treegrid", { name: "Modules" }).locator("[data-col='file']").click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Descending" }).click();
  const modulesSaved = await page.evaluate(() => JSON.parse(localStorage.getItem("shardx.automation.modules.layout") ?? "null"));
  expect(modulesSaved).toMatchObject({ sort: { id: "file", dir: "descending" } });
  // Cards have no columns to save: nothing is written for them.
  expect(await page.evaluate(() => localStorage.getItem("shardx.automation.projects.layout"))).toBeNull();

  await reloadApp(page);
  const dialog = await openModules(page);
  await expect(page.getByRole("treegrid", { name: "Modules" }).locator("[data-col='file']")).toHaveAttribute("aria-sort", "descending");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add a step" })).toHaveCount(0);
  await backToList(page).click();
  // The projects stay newest first.
  await expect(page.getByRole("list", { name: "Projects" }).getByRole("listitem").first()).toContainText("Pricing scrape 6h");
  expect(await page.evaluate(() => localStorage.getItem("shardx.automation.projects.layout"))).toBeNull();
});

test("a request for a project this computer has and one it does not: Allow grants the known one and the row leaves the pending state", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __shardxMockAsks: { flows: string[] } }).__shardxMockAsks = { flows: ["Pricing scrape 6h", "Ghost project"] };
  });
  await openApp(page, { section: "automation" });
  await openModules(page);
  const request = page.locator("[data-module-request]");
  await expect(request).toContainText("Wants to run Pricing scrape 6h.");
  await request.getByRole("button", { name: "Allow" }).click();
  await expect(request).toHaveCount(0);
  await expect(moduleRow(page)).toContainText("Asked for 1 project not on this computer");
  const granted = await page.evaluate(async () => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<{ granted: { call_flows: string[] } }> } };
    return (await w.__TAURI_INTERNALS__.invoke("automation_module_permissions", { id: "sheets" })).granted.call_flows;
  });
  expect(granted).toEqual(["proj-pricing"]);
});

test("a double click on New project makes one project", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await page.getByRole("button", { name: "New project", exact: true }).dblclick();
  await expect(page.getByRole("textbox", { name: "Project name" })).toHaveValue("New project");
  const count = await page.evaluate(() => (window as unknown as Mock).__shardxMock.state.automation.filter((p) => (p as unknown as { name: string }).name === "New project").length);
  expect(count).toBe(1);
});
