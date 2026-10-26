import { expect, test, type Page } from "@playwright/test";
import { openApp, pressCreate } from "./support/app";

// Whether this is a fresh install (`state` in the stored record): the first
// loaded list decides it ("active" with no profiles, "done" with any, or with
// profiles in the Trash), and the first profile puts it away for good. A
// fresh install's Profiles page is the list's plain empty state.
const empty = (page: Page) => page.addInitScript(() => { (window as unknown as { __shardxMockEmpty: boolean }).__shardxMockEmpty = true; });
const rows = (page: Page) => page.locator("[role='row'][data-profile-id]");
const emptyState = (page: Page) => page.locator("main [data-empty-state]");
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("shardx.onboarding") ?? "null") as { state: string } | null);
const stateIs = (page: Page, state: string) => expect.poll(async () => (await stored(page))?.state).toBe(state);

test("a fresh install shows the list's empty state, with New profile and Import, and is under way", async ({ page }) => {
  await empty(page);
  await openApp(page);
  await expect(emptyState(page)).toContainText("No profiles yet");
  await expect(emptyState(page).getByRole("button", { name: "New profile" })).toBeVisible();
  await expect(emptyState(page).getByRole("button", { name: /^Import/ })).toBeVisible();
  await stateIs(page, "active");
});

test("the first profile finishes the setup, for good", async ({ page }) => {
  await empty(page);
  await openApp(page);
  await stateIs(page, "active");
  await emptyState(page).getByRole("button", { name: "New profile" }).click();
  await pressCreate(page);
  await expect(rows(page)).toHaveCount(1);
  await stateIs(page, "done");
  await page.reload();
  await expect(rows(page)).toHaveCount(1);
  await stateIs(page, "done");
});

test("an existing install is decided as done", async ({ page }) => {
  await openApp(page);
  await expect(rows(page)).toHaveCount(8);
  await stateIs(page, "done");
});

test("emptying the list later shows the plain empty state and stays done", async ({ page }) => {
  await empty(page);
  await openApp(page);
  await emptyState(page).getByRole("button", { name: "New profile" }).click();
  await pressCreate(page);
  await expect(rows(page)).toHaveCount(1);
  await stateIs(page, "done");
  await rows(page).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText("No profiles yet")).toBeVisible();
  await stateIs(page, "done");
});

test("a profile from any path finishes the setup: an imported one", async ({ page }) => {
  await empty(page);
  await openApp(page);
  await stateIs(page, "active");
  await page.evaluate(() => { (window as unknown as { __shardxMockClipboard: string }).__shardxMockClipboard = JSON.stringify([{ name: "Imported one" }]); });
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("import");
  await page.getByRole("option", { name: /^Import profiles/ }).click();
  await expect(rows(page)).toHaveCount(1);
  await stateIs(page, "done");
});

test("a broken stored value decides again from the list", async ({ page }) => {
  await empty(page);
  await page.addInitScript(() => localStorage.setItem("shardx.onboarding", "{nope"));
  await openApp(page);
  await expect(page.getByText("No profiles yet")).toBeVisible();
  await stateIs(page, "active");
});

test("dev mock: ?mock=empty opens as a fresh install", async ({ page }) => {
  await page.addInitScript(() => { if (localStorage.getItem("shardx.lang") === null) localStorage.setItem("shardx.lang", "en"); });
  await page.goto("/?mock=empty");
  await expect(page.getByText("No profiles yet")).toBeVisible();
  await expect(page).not.toHaveURL(/mock=/);
  await stateIs(page, "active");
});

test("an install whose profiles are all in the Trash is not fresh (PC-115)", async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    const w = window as unknown as {
      __shardxMock: { state: { profiles: Record<string, unknown> } };
      __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> };
    };
    for (const id of Object.keys(w.__shardxMock.state.profiles)) await w.__TAURI_INTERNALS__.invoke("profile_delete", { id });
  });
  await page.evaluate(() => localStorage.removeItem("shardx.onboarding"));
  await page.reload();
  // Decided once the list and the Trash are in: been here before.
  await expect(page.getByText("No profiles yet")).toBeVisible();
  await stateIs(page, "done");
});
