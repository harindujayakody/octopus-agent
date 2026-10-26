import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle } from "./support/app";

type Stored = { name: string; notes: string; _meta: Record<string, unknown> };
type MockState = { profiles: Record<string, Stored>; order: string[]; trash: { id: string }[] };
const mock = (page: Page) => page.evaluate(() => (window as unknown as { __shardxMock: { state: MockState } }).__shardxMock.state);
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const undoToast = (page: Page) => page.locator("[data-toast]").filter({ has: page.getByRole("button", { name: "Undo" }) });

test("Delete moves the active row to the Trash at once, and Undo brings it back", async ({ page }) => {
  await openApp(page);
  await row(page, "eBay DE buyer").locator("[data-cell='status']").click();
  await page.keyboard.press("Delete");
  await expect(row(page, "eBay DE buyer")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(undoToast(page)).toContainText("Moved “eBay DE buyer” to Trash");
  await undoToast(page).getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "eBay DE buyer")).toHaveCount(1);
  await expect(page.locator("[role='row'][data-active]")).toContainText("eBay DE buyer");
});

test("a bulk move is one toast, and Undo gives back every profile as it was", async ({ page }) => {
  await openApp(page);
  const before = await mock(page);
  const names = ["Etsy craft shop", "Sandbox", "Scraper pricing"];
  for (const n of names) await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: /Move to Trash/ }).click();
  for (const n of names) await expect(row(page, n)).toHaveCount(0);
  await expect(undoToast(page)).toHaveCount(1);
  await expect(undoToast(page)).toContainText("Moved 3 profiles to Trash");
  await page.keyboard.press("ControlOrMeta+z");
  for (const n of names) await expect(row(page, n)).toHaveCount(1);
  // The rows show before the backend has them back (LQ-03).
  await waitForIdle(page);
  const after = await mock(page);
  for (const id of Object.keys(before.profiles)) {
    expect(after.profiles[id]?.name).toBe(before.profiles[id].name);
    expect(after.profiles[id]?.notes).toBe(before.profiles[id].notes);
    expect(after.profiles[id]?._meta).toEqual(before.profiles[id]._meta);
  }
  expect(after.trash.length).toBe(before.trash.length);
});

test("the row menu's Move to Trash asks nothing", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Sandbox")).toHaveCount(0);
});

const errors = (page: Page) => page.locator("[data-toast]").filter({ hasText: /failed|not found/i });
const count = (page: Page) => page.evaluate(() => (window as unknown as { __shardxMock: { state: MockState } }).__shardxMock.state.order.length);

test("holding Delete moves one profile, not a run of them", async ({ page }) => {
  await openApp(page);
  await row(page, "eBay DE buyer").locator("[data-cell='status']").click();
  await page.keyboard.down("Delete");
  await page.keyboard.down("Delete");
  await page.keyboard.down("Delete");
  await page.keyboard.up("Delete");
  await expect(undoToast(page)).toHaveCount(1);
  await page.waitForTimeout(800);
  expect(await count(page)).toBe(7);
  expect(await undoToast(page).count()).toBe(1);
  // Now, not eventually: an error toast would time out and pass a waiting check.
  expect(await errors(page).count()).toBe(0);
});

test("a double click on the bar's Move to Trash moves the selection once, with no error", async ({ page }) => {
  await openApp(page);
  for (const n of ["Etsy craft shop", "Sandbox"]) await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: /Move to Trash/ }).dblclick();
  await expect(undoToast(page)).toHaveCount(1);
  await page.waitForTimeout(800);
  expect(await count(page)).toBe(6);
  expect(await undoToast(page).count()).toBe(1);
  // Now, not eventually: an error toast would time out and pass a waiting check.
  expect(await errors(page).count()).toBe(0);
});

test("a moved row leaves the list at once, before the backend is done", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => { (window as unknown as { __shardxMockSlow: Record<string, number> }).__shardxMockSlow = { profile_delete: 3000 }; });
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  await page.keyboard.press("Delete");
  await expect(row(page, "Sandbox")).toHaveCount(0, { timeout: 1000 });
});

test("a running profile is stopped before it goes to the Trash", async ({ page }) => {
  await openApp(page);
  await row(page, "Amazon US seller").locator("[data-cell='status']").click();
  await page.keyboard.press("Delete");
  await expect(row(page, "Amazon US seller")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __shardxMock: { calls: Record<string, number> } }).__shardxMock.calls.process_kill ?? 0,
  )).toBe(1);
});
