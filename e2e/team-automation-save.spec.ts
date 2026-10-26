import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";
import { ADMIN_INVITE, joinTeam, space, toast } from "./support/team";

// Verifier finding 4 (team phase C): a team's project is saved from the revision it was read
// at (space/items.rs save_project), and the backend answers with the new one. The editor
// keeps that answer, so a second save of the same project goes through; so do changes made
// while a save is out, and a step back after one. A save over another member's is refused.

type Project = { id: string; name: string; revision?: number };
type M = {
  __shardxMock: {
    state: { automation: Project[] };
    log: { cmd: string; args: { project?: Project } }[];
    teamProjectSaved: (id: string) => void;
  };
  __shardxMockSlow?: Record<string, number>;
};

const nameField = (page: Page) => page.getByRole("textbox", { name: "Project name" });
const saveArea = (page: Page) => page.locator("[data-editor-save]");
const saveButton = (page: Page) => saveArea(page).getByRole("button", { name: "Save", exact: true });
const saved = (page: Page) => page.locator("[data-toast]").getByText("Project saved", { exact: true });
/** The revisions each automation_save named, oldest first. */
const sentRevisions = (page: Page) =>
  page.evaluate(() => (window as unknown as M).__shardxMock.log.filter((x) => x.cmd === "automation_save").map((x) => x.args.project?.revision ?? null));
const stored = (page: Page) => page.evaluate(() => (window as unknown as M).__shardxMock.state.automation.map((p) => ({ name: p.name, revision: p.revision })));

/** In the Ads team as its admin, the editor open on a new project named "Checkout", not yet saved. */
async function newTeamProject(page: Page) {
  await openApp(page, { section: "automation" });
  await joinTeam(page, ADMIN_INVITE);
  await expect(space(page)).toHaveText("Ads team");
  await page.locator("main header").getByRole("button", { name: "New project", exact: true }).click();
  await expect(nameField(page)).toBeFocused();
  await page.keyboard.type("Checkout");
  await expect.poll(() => stored(page)).toEqual([{ name: "New project", revision: 1 }]);
}

async function save(page: Page) {
  await saveButton(page).click();
  await expect(saved(page)).toBeVisible();
  await expect(saveArea(page)).not.toContainText("Unsaved changes");
}

test("two saves in a row of a team's project both go through", async ({ page }) => {
  await newTeamProject(page);
  await save(page);
  await nameField(page).fill("Checkout EU");
  await save(page);
  expect(await sentRevisions(page)).toEqual([1, 2]);
  expect(await stored(page)).toEqual([{ name: "Checkout EU", revision: 3 }]);
  await expect(page.locator("[data-toast]", { hasText: "Couldn’t save" })).toHaveCount(0);
});

test("changes made while a save is out are saved next, from the revision that save made", async ({ page }) => {
  await newTeamProject(page);
  await page.evaluate(() => { (window as unknown as M).__shardxMockSlow = { automation_save: 1200 }; });
  await saveButton(page).click();
  // Typed while the save is out: a draft over what it stores.
  await nameField(page).fill("Checkout EU");
  await expect(saved(page)).toBeVisible();
  await expect(saveArea(page)).toContainText("Unsaved changes");
  await save(page);
  expect(await sentRevisions(page)).toEqual([1, 2]);
  expect(await stored(page)).toEqual([{ name: "Checkout EU", revision: 3 }]);
});

test("a save asked for while one is out waits its turn and goes from that one's revision", async ({ page }) => {
  await newTeamProject(page);
  await appModule(page, "/src/entities/automation/lib/useAutomation.tsx", "__automation");
  await page.evaluate(() => { (window as unknown as M).__shardxMockSlow = { automation_save: 800 }; });
  const ok = await page.evaluate(async () => {
    const store = (window as unknown as { __automation: typeof import("../src/entities/automation/lib/useAutomation") }).__automation.useAutomation;
    const id = store.getState().openId!;
    const first = store.getState().save(id);
    await store.getState().patch(id, { name: "Checkout EU" });
    const second = store.getState().save(id);
    return Promise.all([first, second]);
  });
  expect(ok).toEqual([true, true]);
  expect(await sentRevisions(page)).toEqual([1, 2]);
  expect(await stored(page)).toEqual([{ name: "Checkout EU", revision: 3 }]);
  await expect(page.locator("[data-toast]", { hasText: "Couldn’t save" })).toHaveCount(0);
});

test("a step back after a save saves too", async ({ page }) => {
  await newTeamProject(page);
  await save(page);
  await nameField(page).fill("Checkout EU");
  await save(page);
  // Focus is on Save, out of any field: the editor's Undo key.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(nameField(page)).toHaveValue("Checkout");
  await save(page);
  expect(await sentRevisions(page)).toEqual([1, 2, 3]);
  expect(await stored(page)).toEqual([{ name: "Checkout", revision: 4 }]);
});

test("a save over another member's save is refused, in plain words, and the changes stay", async ({ page }) => {
  await newTeamProject(page);
  await save(page);
  await page.evaluate(() => { const m = (window as unknown as M).__shardxMock; m.teamProjectSaved(m.state.automation[0].id); });
  await nameField(page).fill("Checkout EU");
  await saveButton(page).click();
  const failed = toast(page, "Couldn’t save “Checkout EU”");
  await expect(failed).toContainText("Someone else saved this after you opened it. Open it again and redo your changes on the current version.");
  await expect(failed).not.toContainText("rev 3");
  await expect(saveArea(page).getByRole("alert")).toHaveText("Couldn’t save. Your changes are still here.");
  await expect(nameField(page)).toHaveValue("Checkout EU");
});

test("a personal project's save names no revision", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  await nameField(page).fill("Pricing scrape 12h");
  await save(page);
  await nameField(page).fill("Pricing scrape 24h");
  await save(page);
  expect(await sentRevisions(page)).toEqual([null, null]);
});
