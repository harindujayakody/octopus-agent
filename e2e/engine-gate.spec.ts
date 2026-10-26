import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// The engine screen is never a dead end (IFACE-09, WRITE-25), and the window
// has its controls from the first frame (FEEL-40, LAYOUT-08).
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const knobs = (page: Page, k: Record<string, unknown>) => page.addInitScript((k) => { Object.assign(window, k); }, k);
const setEngine = (page: Page, mode: string) =>
  page.evaluate((m) => { (window as unknown as { __shardxMockEngine: string }).__shardxMockEngine = m; }, mode);

test("a failed engine download says why and can be tried again", async ({ page }) => {
  await knobs(page, { __shardxMockEngine: "offline" });
  await openApp(page, { idle: false });
  await expect(page.getByRole("heading", { name: "Couldn’t download the browser engine" })).toBeVisible();
  await expect(page.getByText("Check your internet connection, then try again.")).toBeVisible();
  // The backend's words speak of an engine there is: kept for Copy details.
  await expect(page.getByText(/^Downloading the engine failed/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy details" })).toBeVisible();
  await setEngine(page, "missing");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("main[data-section='profiles']")).toBeVisible({ timeout: 10_000 });
});

test("Close window on a failed download closes the window", async ({ page }) => {
  await knobs(page, { __shardxMockEngine: "offline" });
  await openApp(page, { idle: false });
  await page.getByRole("button", { name: "Close window" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __shardxMock: { windowCalls: string[] } }).__shardxMock.windowCalls))
    .toContain("plugin:window|close");
});

test("an engine update says it is an update, with its progress in words", async ({ page }) => {
  await knobs(page, { __shardxMockEngine: "update", __shardxMockEngineStepMs: 1500 });
  await openApp(page, { idle: false });
  await expect(page.getByRole("heading", { name: "Updating the browser engine" })).toBeVisible();
  await expect(page.getByText(/^Browser engine, \d+\.\d of 19\.1\sMB$/)).toBeVisible({ timeout: 5000 });
  await expect(page.locator("main[data-section='profiles']")).toBeVisible({ timeout: 15_000 });
});

// The frame holds the sidebar's place at its own width, so the app replaces
// it without a sideways jump (FEEL-40): the whole sidebar between 1024 and
// 1280 px too (the width no longer folds it), and the rail when chosen.
const gateThenSidebar = async (page: Page): Promise<[number, number]> => {
  await knobs(page, { __shardxMockSlow: { runtime_status: 2000 } });
  await openApp(page, { idle: false });
  const gate = page.locator("[data-gate-frame] > :first-child");
  await expect(gate).toBeVisible();
  const before = (await gate.boundingBox())!.width;
  await expect(page.locator("main[data-section='profiles']")).toBeVisible({ timeout: 10_000 });
  return [before, (await page.locator("aside:not([data-peek])").boundingBox())!.width];
};

test("the startup frame is as wide as the sidebar that replaces it", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  // 232: the sidebar panel, its 240 less the 8 px of ground beside it (borderless).
  expect(await gateThenSidebar(page)).toEqual([232, 232]);
});

test("the startup frame is as wide as the rail when the rail is chosen", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("shardx.sidebar", JSON.stringify({ v: 1, collapsed: {}, foldersOpen: false, rail: true }));
  });
  expect(await gateThenSidebar(page)).toEqual([56, 56]);
});

test.describe("on Windows", () => {
  test.use({ userAgent: WINDOWS_UA });

  test("the window controls show while the engine check runs", async ({ page }) => {
    await knobs(page, { __shardxMockSlow: { runtime_status: 3000 } });
    await openApp(page, { idle: false });
    await expect(page.locator("[data-gate-frame]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Minimize" })).toBeVisible();
    await expect(page.locator("main[data-section='profiles']")).toBeVisible({ timeout: 10_000 });
  });
});

test("the profile list is asked for while the engine check runs, and the frame shows rows", async ({ page }) => {
  await knobs(page, { __shardxMockSlow: { runtime_status: 3000 } });
  await openApp(page, { idle: false });
  await expect(page.locator("[data-gate-frame]")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __shardxMock: { calls: Record<string, number> } }).__shardxMock.calls.profile_list ?? 0), { timeout: 1500 })
    .toBeGreaterThan(0);
  await expect(page.locator("[data-gate-frame] [data-loading]")).toBeVisible();
  await expect(page.locator("main[data-section='profiles'] [role='row'][data-profile-id]").first()).toBeVisible({ timeout: 10_000 });
});

// A returning user: nothing moves when the list arrives under the frame.
test("the list's first row lands where the frame's first placeholder row was", async ({ page }) => {
  await openApp(page);
  await knobs(page, { __shardxMockSlow: { runtime_status: 3000 } });
  await page.reload();
  const placeholder = page.locator("[data-gate-frame] [data-loading] > [aria-hidden]").first();
  await expect(placeholder).toBeVisible();
  const before = (await placeholder.boundingBox())!;
  const row = page.locator("main[data-section='profiles'] [role='row'][data-profile-id]").first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  const after = (await row.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
});
