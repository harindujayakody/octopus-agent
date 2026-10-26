import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });

test("Start shows the profile running at once, before the launch finishes", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").hover();
  await row(page, "Etsy craft shop").getByRole("button", { name: "Start" }).click();
  // The mock takes 900 ms to launch; the row must not wait for it: it says
  // Cancel at once (C11, Task 5), and Stop once the launch returns.
  await expect(row(page, "Etsy craft shop").getByRole("button", { name: "Cancel", exact: true })).toBeVisible({ timeout: 300 });
  await expect(row(page, "Etsy craft shop").getByRole("button", { name: "Stop" })).toBeVisible();
});

test("a failed start rolls back and says why", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockLaunchFails: string[] }).__shardxMockLaunchFails = ["aed41005"]; });
  await openApp(page);
  await row(page, "Etsy craft shop").hover();
  await row(page, "Etsy craft shop").getByRole("button", { name: "Start" }).click();
  await expect(row(page, "Etsy craft shop").getByRole("button", { name: "Cancel", exact: true })).toBeVisible({ timeout: 300 });
  await expect(page.locator("[data-toast]").getByText(/could not start/i)).toBeVisible();
  await row(page, "Etsy craft shop").hover();
  await expect(row(page, "Etsy craft shop").getByRole("button", { name: "Start" })).toBeVisible();
});

test("Stop shows the profile idle at once", async ({ page }) => {
  await openApp(page);
  await row(page, "Amazon US seller").getByRole("button", { name: "Stop" }).click();
  await row(page, "Amazon US seller").hover();
  await expect(row(page, "Amazon US seller").getByRole("button", { name: "Start" })).toBeVisible({ timeout: 300 });
});

// Live layer (Task 2): the store remembers a failed start for the session, so
// the Status pill can say "Failed to start" (not only a toast that goes
// away), until the profile starts or leaves the list.
type Store = { __profile: { useProfile: { getState: () => {
  startFailed: Record<string, number>;
  profiles: { id: string }[];
  /** The failure's reason, or null once it started (C25). */
  startStop: (p: { id: string }) => Promise<string | null>;
  deleteMany: (ids: string[]) => Promise<string[]>;
} } } };
const ETSY = "aed41005";
const failedAt = (page: Page) =>
  page.evaluate((id) => (window as unknown as Store).__profile.useProfile.getState().startFailed[id] ?? null, ETSY);

test("a failed start is remembered until the profile starts, and forgotten when it leaves", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockLaunchFails: string[] }).__shardxMockLaunchFails = ["aed41005"]; });
  await openApp(page);
  await appModule(page, "/src/entities/profile/index.ts", "__profile");
  const start = () => page.evaluate(async (id) => {
    const s = (window as unknown as Store).__profile.useProfile.getState();
    return s.startStop(s.profiles.find((p) => p.id === id)!);
  }, ETSY);

  expect(await failedAt(page)).toBeNull();
  expect(await start()).toEqual(expect.any(String));
  expect(await failedAt(page)).toEqual(expect.any(Number));
  // A second failure moves the time on.
  const first = (await failedAt(page))!;
  expect(await start()).toEqual(expect.any(String));
  expect(await failedAt(page)).toBeGreaterThanOrEqual(first);

  // It starts: the failure is gone, as soon as the start begins.
  await page.evaluate(() => { (window as unknown as { __shardxMockLaunchFails: string[] }).__shardxMockLaunchFails = []; });
  const started = start();
  await expect.poll(() => failedAt(page)).toBeNull();
  expect(await started).toBeNull();

  // Failed again, then moved to the Trash: nothing is kept for it.
  await page.evaluate(() => { (window as unknown as { __shardxMockLaunchFails: string[] }).__shardxMockLaunchFails = ["aed41005"]; });
  await row(page, "Etsy craft shop").getByRole("button", { name: "Stop" }).click();
  await row(page, "Etsy craft shop").hover();
  await expect(row(page, "Etsy craft shop").getByRole("button", { name: "Start" })).toBeVisible();
  expect(await start()).toEqual(expect.any(String));
  expect(await failedAt(page)).toEqual(expect.any(Number));
  await page.evaluate((id) => (window as unknown as Store).__profile.useProfile.getState().deleteMany([id]), ETSY);
  expect(await failedAt(page)).toBeNull();
});
