import { expect, test, type Page } from "@playwright/test";
import { openApp, reloadApp } from "./support/app";
import { ADMIN_INVITE, dialog, joinTeam, memberRow, menu, openTeamPage, rowMenu, server, toast } from "./support/team";

// The rights editor: one member's rules as a grid of where (the whole team,
// each folder, the profiles in none, profiles with rules of their own) by
// what (seven actions). Dana Kim's seeded rules: the whole team may See and
// Start; Shops may Edit and Cookies; FB Ads 02 (tp-ads-2, in Ads) may not Start.

const editor = (page: Page) => page.getByRole("dialog", { name: /^Rights for/ });
const grid = (page: Page) => editor(page).getByRole("grid");
const row = (page: Page, key: string) => grid(page).locator(`[data-rights-row='${key}']`);
const COL = { see: 0, start: 1, edit: 2, create: 3, delete: 4, cookies: 5, take_out: 6 } as const;
const cell = (page: Page, key: string, action: keyof typeof COL) => row(page, key).getByRole("gridcell").nth(COL[action]).getByRole("button");
const hint = (page: Page) => editor(page).locator("[data-rights-hint]");
const preset = (page: Page, name: string) => editor(page).locator("[data-presets]").getByRole("radio", { name, exact: true });
const grantsOf = async (page: Page, id: string) => (await server(page)).members.find((m: { id: string }) => m.id === id).grants;

async function openRights(page: Page, memberId = "m-dana") {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  // A row opens its member's rights, as Enter does.
  await memberRow(page, memberId).click();
  await expect(grid(page)).toBeVisible();
}

test("the grid lists the whole team, each folder, the profiles in none, then profiles with rules of their own", async ({ page }) => {
  await openRights(page);
  await expect(grid(page).getByRole("rowheader")).toHaveText(["Whole team", "Ads", "Shops", "Warm-up", "No folder", /^FB Ads 02/]);
  await expect(grid(page).getByRole("columnheader")).toHaveText(["Where", "See", "Start", "Edit", "Create", "Delete", "Cookies", "Take out"]);
  await expect(cell(page, "team", "see")).toHaveAttribute("data-state", "allow");
  await expect(cell(page, "profile:tp-ads-2", "start")).toHaveAttribute("data-state", "refuse");
  await expect(cell(page, "folder:Ads", "start")).toHaveAttribute("data-state", "inherit");
  // The grid is one Tab stop, and has the keyboard on open; the line under it waits for a cell.
  await expect(grid(page).locator("button[tabindex='0']")).toHaveCount(1);
  await expect(cell(page, "team", "see")).toBeFocused();
  await expect(hint(page)).toHaveText("");
  // A column says what it covers.
  await grid(page).locator("[data-action-head='take_out']").hover();
  await expect(page.getByRole("tooltip")).toHaveText("Take out: move the profile out of the team, into a personal space or a file.");
});

test("the presets fill the row in hand: the whole team first, a folder once picked", async ({ page }) => {
  await openRights(page);
  await expect(editor(page).locator("[data-presets]")).toContainText("Set “Whole team” to");
  await expect(preset(page, "Start")).toHaveAttribute("aria-checked", "true");
  await preset(page, "All but take out").click();
  await expect(preset(page, "All but take out")).toHaveAttribute("aria-checked", "true");
  for (const a of ["see", "start", "edit", "create", "delete", "cookies"] as const) await expect(cell(page, "team", a)).toHaveAttribute("data-state", "allow");
  await expect(cell(page, "team", "take_out")).toHaveAttribute("data-state", "inherit");
  await preset(page, "See only").click();
  await expect(cell(page, "team", "see")).toHaveAttribute("data-state", "allow");
  await expect(cell(page, "team", "start")).toHaveAttribute("data-state", "inherit");

  // A press on a place picks its row and changes no rule.
  await row(page, "folder:Ads").getByRole("rowheader").click();
  await expect(editor(page).locator("[data-presets]")).toContainText("Set “Ads” to");
  await expect(row(page, "folder:Ads")).toHaveAttribute("aria-selected", "true");
  await expect(preset(page, "None")).toHaveAttribute("aria-checked", "true");
  await preset(page, "Start").click();
  await expect(cell(page, "folder:Ads", "see")).toHaveAttribute("data-state", "allow");
  await expect(cell(page, "folder:Ads", "start")).toHaveAttribute("data-state", "allow");
  await preset(page, "None").click();
  await expect(cell(page, "folder:Ads", "see")).toHaveAttribute("data-state", "inherit");
  // The other rows keep their own rules.
  await expect(cell(page, "folder:Shops", "edit")).toHaveAttribute("data-state", "allow");
  await expect(cell(page, "team", "see")).toHaveAttribute("data-state", "allow");
});

test("run only one folder: a new member, the Ads row, Start, and Save", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  await page.locator("main header").getByRole("button", { name: "Add member" }).click();
  await dialog(page).getByRole("textbox", { name: "Name" }).fill("Ivan");
  await dialog(page).getByRole("button", { name: "Add member" }).click();
  await dialog(page).getByRole("button", { name: "Set rights…" }).click();
  await expect(grid(page)).toBeVisible();
  // Nothing set yet: each cell still shows where it is.
  await expect(cell(page, "folder:Ads", "start").locator("[data-empty-mark]")).toHaveCount(1);
  await row(page, "folder:Ads").getByRole("rowheader").click();
  await preset(page, "Start").click();
  await editor(page).getByRole("button", { name: "Save rights" }).click();
  await expect(editor(page)).toHaveCount(0);
  const ivan = (await server(page)).members.find((m: { name: string }) => m.name === "Ivan");
  expect(ivan.grants).toEqual([
    { scope: { kind: "folder", name: "Ads" }, action: "see", allow: true },
    { scope: { kind: "folder", name: "Ads" }, action: "start", allow: true },
  ]);
  await expect(memberRow(page, ivan.id).locator("[data-member-access]")).toHaveText("Ads: see and start");
});

test("allowing Start where nothing allows See turns See on too; refused See leaves it idle, and says so", async ({ page }) => {
  await openRights(page, "m-sam");
  await cell(page, "folder:Ads", "start").click();
  await expect(cell(page, "folder:Ads", "start")).toHaveAttribute("data-state", "allow");
  await expect(cell(page, "folder:Ads", "see")).toHaveAttribute("data-state", "allow");
  await expect(hint(page)).toHaveText("Ads, Start: allowed, and “See” turned on with it: without it the profiles stay hidden");
  // See refused on the row: Start stays, marked as doing nothing.
  await cell(page, "folder:Ads", "see").click();
  await expect(cell(page, "folder:Ads", "see")).toHaveAttribute("data-state", "refuse");
  await expect(cell(page, "folder:Ads", "start")).toHaveAttribute("data-idle", "true");
  await expect(cell(page, "folder:Ads", "start")).toHaveAccessibleName("Start, Ads: allowed, does nothing without “See”");
  await cell(page, "folder:Ads", "start").hover();
  await expect(hint(page)).toHaveText("Ads, Start: allowed, but it does nothing here without “See”");
  // Create needs no See: allowing it adds nothing more.
  await cell(page, "folder:Shops", "create").click();
  await expect(cell(page, "folder:Shops", "see")).toHaveAttribute("data-state", "inherit");
});

test("a cell steps through not set, allowed and refused by mouse", async ({ page }) => {
  await openRights(page);
  const c = cell(page, "folder:Warm-up", "delete");
  await expect(c).toHaveAttribute("data-state", "inherit");
  await c.click();
  await expect(c).toHaveAttribute("data-state", "allow");
  await expect(c).toHaveAccessibleName("Delete, Warm-up: allowed");
  await c.click();
  await expect(c).toHaveAttribute("data-state", "refuse");
  await c.click();
  await expect(c).toHaveAttribute("data-state", "inherit");
  await expect(c).toHaveAccessibleName("Delete, Warm-up: not set");
});

test("the keys move between cells and set them: arrows, Space, Delete", async ({ page }) => {
  await openRights(page);
  await cell(page, "team", "see").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const edit = cell(page, "folder:Ads", "edit");
  await expect(edit).toBeFocused();
  await expect(edit).toHaveAttribute("tabindex", "0");
  // The row under the keyboard is the one the presets fill.
  await expect(editor(page).locator("[data-presets]")).toContainText("Set “Ads” to");
  await page.keyboard.press("Space");
  await expect(edit).toHaveAttribute("data-state", "allow");
  await page.keyboard.press("Enter");
  await expect(edit).toHaveAttribute("data-state", "refuse");
  await page.keyboard.press("Delete");
  await expect(edit).toHaveAttribute("data-state", "inherit");
  await page.keyboard.press("End");
  await expect(cell(page, "folder:Ads", "take_out")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(cell(page, "folder:Ads", "see")).toBeFocused();
  // The dialog stays open: Enter on a cell is the cell's, not Save.
  await expect(editor(page)).toBeVisible();
});

test("the line under the grid names the row and says what wins, on hover and on focus", async ({ page }) => {
  await openRights(page);
  await cell(page, "folder:Ads", "start").focus();
  await expect(hint(page)).toHaveText("Ads, Start: allowed here by the whole-team rule");
  await expect(cell(page, "folder:Ads", "start")).toHaveAccessibleDescription("Ads, Start: allowed here by the whole-team rule");
  // The pointer explains without changing anything.
  await cell(page, "profile:tp-ads-2", "start").hover();
  await expect(hint(page)).toHaveText("FB Ads 02, Start: refused by this rule");
  await expect(cell(page, "profile:tp-ads-2", "start")).toHaveAttribute("data-state", "refuse");
  await cell(page, "folder:Shops", "edit").focus();
  await expect(hint(page)).toHaveText("Shops, Edit: allowed by this rule");
  await cell(page, "folder:Ads", "edit").focus();
  await expect(hint(page)).toHaveText("Ads, Edit: not allowed, no rule gives it");
  // A refusal on the whole team, under an allowance on a folder: the folder wins there.
  await cell(page, "team", "cookies").click();
  await cell(page, "team", "cookies").click();
  await cell(page, "folder:Ads", "cookies").focus();
  await expect(hint(page)).toHaveText("Ads, Cookies: refused here by the whole-team rule");
  await cell(page, "folder:Shops", "cookies").focus();
  await expect(hint(page)).toHaveText("Shops, Cookies: allowed by this rule");
});

test("a profile rule row: added from the picker, Create locked and never written, folder rules showing through", async ({ page }) => {
  await openRights(page);
  await editor(page).getByRole("combobox", { name: "Add a profile rule…" }).click();
  await page.getByRole("option", { name: /Etsy main/ }).click();
  await expect(row(page, "profile:tp-shop-1")).toBeVisible();
  // The new row is the one the presets fill.
  await expect(editor(page).locator("[data-presets]")).toContainText("Set “Etsy main” to");
  const create = cell(page, "profile:tp-shop-1", "create");
  await expect(create).toHaveAttribute("aria-disabled", "true");
  // A press on it changes nothing, by mouse or key.
  await create.click({ force: true });
  await page.keyboard.press("Space");
  await expect(create).toHaveAttribute("data-state", "locked");
  await expect(hint(page)).toHaveText("Etsy main, Create is about the team or a folder: a rule on one profile cannot carry it");
  await cell(page, "profile:tp-shop-1", "edit").focus();
  await expect(hint(page)).toHaveText("Etsy main, Edit: allowed here by the rule on folder “Shops”");
  // A preset on a profile row leaves Create off too, and Save writes no Create there.
  await preset(page, "All but take out").click();
  await expect(create).toHaveAttribute("data-state", "locked");
  await editor(page).getByRole("button", { name: "Save rights" }).click();
  await expect(editor(page)).toHaveCount(0);
  const saved = await grantsOf(page, "m-dana");
  expect(saved.filter((g: { scope: { kind: string; id?: string } }) => g.scope.kind === "profile" && g.scope.id === "tp-shop-1").map((g: { action: string }) => g.action))
    .toEqual(["see", "start", "edit", "delete", "cookies"]);

  // Set and then taken away again, the row goes, and the keyboard stays in the grid.
  await memberRow(page, "m-dana").click();
  await editor(page).getByRole("button", { name: "Remove the rules for “Etsy main”" }).click();
  await expect(row(page, "profile:tp-shop-1")).toHaveCount(0);
  await expect(cell(page, "profile:tp-ads-2", "see")).toBeFocused();
});

test("Save writes the whole list, and it is there after a restart", async ({ page }) => {
  await openRights(page);
  await cell(page, "folder:Warm-up", "delete").click();
  await cell(page, "folder:Ads", "start").click();
  await cell(page, "folder:Ads", "start").click();
  await editor(page).getByRole("button", { name: "Save rights" }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(toast(page, "Saved rights for “Dana Kim”")).toBeVisible();
  const saved = await grantsOf(page, "m-dana");
  expect(saved).toContainEqual({ scope: { kind: "folder", name: "Warm-up" }, action: "delete", allow: true });
  expect(saved).toContainEqual({ scope: { kind: "folder", name: "Ads" }, action: "start", allow: false });
  expect(saved).toHaveLength(7);

  await reloadApp(page);
  await memberRow(page, "m-dana").click();
  await expect(cell(page, "folder:Warm-up", "delete")).toHaveAttribute("data-state", "allow");
  await expect(cell(page, "folder:Ads", "start")).toHaveAttribute("data-state", "refuse");
});

test("unsaved changes ask before the editor closes; Keep editing keeps them", async ({ page }) => {
  await openRights(page);
  await cell(page, "folder:Warm-up", "see").click();
  await page.keyboard.press("Escape");
  const ask = page.getByRole("alertdialog", { name: "Discard your changes?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(cell(page, "folder:Warm-up", "see")).toHaveAttribute("data-state", "allow");
  await editor(page).getByRole("button", { name: "Cancel" }).click();
  await ask.getByRole("button", { name: "Discard" }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(await grantsOf(page, "m-dana")).toHaveLength(5);
  // Untouched, Esc just closes, and the keyboard is back on the member's row.
  await rowMenu(page, memberRow(page, "m-dana"));
  await menu(page).getByRole("menuitem", { name: "Rights…" }).click();
  await expect(grid(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(memberRow(page, "m-dana")).toBeFocused();
});

test("a switched-off member's rights say they wait", async ({ page }) => {
  await openRights(page, "m-sam");
  await expect(editor(page)).toContainText("Switched off: these rules wait until you switch them back on.");
  await expect(grid(page).getByRole("rowheader")).toHaveText(["Whole team", "Ads", "Shops", "Warm-up", "No folder"]);
});
