import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";

// Quit asks first (manual save, Task 11; backend half is B48): the backend
// emits "app://quit-requested" and waits for app_quit_confirmed or
// app_quit_cancelled. The window asks about unsaved changes and answers.
type U = typeof import("../src/shared/model/unsaved");
type M = { __shardxMock: { calls: Record<string, number>; emit: (e: string, p?: unknown) => void } };
type W = M & { __unsaved: U; fake: { saves: number; discards: number } };

const requestQuit = (page: Page) => page.evaluate(() => (window as unknown as M).__shardxMock.emit("app://quit-requested"));
const calls = (page: Page) =>
  page.evaluate(() => {
    const c = (window as unknown as M).__shardxMock.calls;
    return { confirmed: c.app_quit_confirmed ?? 0, cancelled: c.app_quit_cancelled ?? 0 };
  });
const guard = (page: Page) => page.getByRole("alertdialog", { name: "Save changes to Fake?" });

/** One fake dirty editor, counting its saves and discards. */
async function addFake(page: Page, saveOk = true) {
  await appModule(page, "/src/shared/model/unsaved.ts", "__unsaved");
  await page.evaluate((ok) => {
    const w = window as unknown as W;
    w.fake = { saves: 0, discards: 0 };
    w.__unsaved.unsavedStore.setState({
      editors: [{
        id: "fake",
        label: "Fake",
        save: async () => { w.fake.saves++; return ok; },
        discard: () => { w.fake.discards++; },
      }],
    });
  }, saveOk);
}
const fake = (page: Page) => page.evaluate(() => (window as unknown as W).fake);

test("no unsaved: confirms at once", async ({ page }) => {
  await openApp(page);
  await requestQuit(page);
  await expect.poll(() => calls(page)).toEqual({ confirmed: 1, cancelled: 0 });
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("unsaved: shows the guard; Cancel sends app_quit_cancelled", async ({ page }) => {
  await openApp(page);
  await addFake(page);
  await requestQuit(page);
  await expect(guard(page)).toBeVisible();
  // Nothing is answered while the question is open.
  expect(await calls(page)).toEqual({ confirmed: 0, cancelled: 0 });
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect(guard(page)).toHaveCount(0);
  await expect.poll(() => calls(page)).toEqual({ confirmed: 0, cancelled: 1 });
  expect(await fake(page)).toEqual({ saves: 0, discards: 0 });
});

test("Don't save sends app_quit_confirmed", async ({ page }) => {
  await openApp(page);
  await addFake(page);
  await requestQuit(page);
  await guard(page).getByRole("button", { name: "Don’t save" }).click();
  await expect.poll(() => calls(page)).toEqual({ confirmed: 1, cancelled: 0 });
  expect(await fake(page)).toEqual({ saves: 0, discards: 1 });
});

test("Save sends app_quit_confirmed; a failed save sends app_quit_cancelled", async ({ page }) => {
  await openApp(page);
  await addFake(page, true);
  await requestQuit(page);
  await guard(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => calls(page)).toEqual({ confirmed: 1, cancelled: 0 });
  expect(await fake(page)).toEqual({ saves: 1, discards: 0 });

  await addFake(page, false);
  await requestQuit(page);
  await guard(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => calls(page)).toEqual({ confirmed: 1, cancelled: 1 });
});
