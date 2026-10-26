import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// PERF-22: an out-of-band change reloads the profile list only when profiles
// or proxies changed.
type M = { __shardxMock: { calls: Record<string, number>; emit: (e: string, p: unknown) => void } };
const reloads = (page: Page) => page.evaluate(() => (window as unknown as M).__shardxMock.calls.profile_list ?? 0);
const emit = (page: Page, topic: string) => page.evaluate((t) => (window as unknown as M).__shardxMock.emit("store-changed", t), topic);

test("an automation change does not reload the profile list; a profile change does", async ({ page }) => {
  await openApp(page);
  const before = await reloads(page);
  await emit(page, "automation");
  await page.waitForTimeout(600);
  expect(await reloads(page)).toBe(before);
  await emit(page, "profiles");
  await expect.poll(() => reloads(page)).toBeGreaterThan(before);
});
