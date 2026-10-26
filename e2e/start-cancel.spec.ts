import { expect, test, type Page } from "@playwright/test";
import { appModule, NOW, openApp } from "./support/app";

// Clarity fixes, Task 5: a profile that is Starting can be cancelled. Its
// button says Cancel (enabled, spinning) in the row, in the panel and in the
// row menu; pressed, it says Canceling and does nothing. The backend's
// `launch_cancel` (B49) ends the launch; without it the launch is left to
// return and the profile is stopped then. The row says Canceled for 3 s.

const ETSY = "Etsy craft shop";
const row = (page: Page) => page.locator("[role='row'][data-profile-id]", { hasText: ETSY });
const status = (page: Page) => row(page).locator("[data-cell='status']");
const peek = (page: Page) => page.locator("aside[data-peek='profile']");
const calls = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as unknown as { __shardxMock: { calls: Record<string, number> } }).__shardxMock.calls[c] ?? 0, cmd);
/** A failure toast: a cancelled start is a choice, not a failure. */
const failureToasts = (page: Page) => page.locator("[data-toast]").filter({ hasText: /could not|couldn’t|failed/i });

/** `launch` takes `ms` longer, and the backend answers `launch_cancel` as `cancel` says ("now", "late", or not at all). */
const slowLaunch = (page: Page, ms: number, cancel?: "now" | "late") =>
  page.addInitScript(([ms, cancel]) => {
    Object.assign(window, { __shardxMockSlow: { launch: ms }, __shardxMockLaunchCancel: cancel });
  }, [ms, cancel] as const);

/** Opens the app and presses Start on the Etsy row: it is Starting from here until the launch returns.
 *  Waits out the 400 ms in which a Cancel is taken for the tail of the Start press (a double-click). */
async function start(page: Page) {
  await openApp(page);
  await row(page).hover();
  await row(page).getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForTimeout(450);
}

test("Starting shows an enabled Cancel in the row, the panel and the menu", async ({ page }) => {
  await slowLaunch(page, 3000);
  await start(page);

  // The row: Cancel replaces Starting. Enabled, with the spinner beside the word.
  const cancel = row(page).getByRole("button", { name: "Cancel", exact: true });
  await expect(cancel).toBeVisible();
  await expect(cancel).toBeEnabled();
  await expect(cancel).not.toHaveAttribute("aria-disabled");
  await expect(cancel.locator(".animate-spin")).toHaveCount(1);
  await expect(row(page).getByRole("button", { name: "Starting" })).toHaveCount(0);

  // The menu: Cancel, and no Stop that would do nothing yet.
  await row(page).click({ button: "right" });
  const item = page.getByRole("menuitem", { name: "Cancel", exact: true });
  await expect(item).toBeVisible();
  await expect(item).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("menuitem", { name: "Stop", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(item).toHaveCount(0);

  // The panel's header.
  await row(page).locator("[data-cell='name']").click();
  await expect(peek(page)).toBeVisible();
  const inPanel = peek(page).locator("[data-peek-header]").getByRole("button", { name: "Cancel", exact: true });
  await expect(inPanel).toBeVisible();
  await expect(inPanel).toBeEnabled();
  await expect(inPanel.locator(".animate-spin")).toHaveCount(1);
});

test("Cancel without launch_cancel stops the profile once launch returns", async ({ page }) => {
  await slowLaunch(page, 3000);
  await start(page);
  await row(page).getByRole("button", { name: "Cancel", exact: true }).click();

  // Pressed: Canceling, and inert. The launch is still going, so nothing is stopped yet.
  const cancelling = row(page).getByRole("button", { name: "Canceling", exact: true });
  await expect(cancelling).toBeVisible();
  await expect(cancelling).toHaveAttribute("aria-disabled", "true");
  await cancelling.click({ force: true });
  expect(await calls(page, "process_kill")).toBe(0);

  // The launch returns: the profile is stopped, and the row says so.
  await expect(status(page)).toContainText("Canceled", { timeout: 10_000 });
  expect(await calls(page, "process_kill")).toBe(1);
  await row(page).hover();
  await expect(row(page).getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(row(page).getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(failureToasts(page)).toHaveCount(0);

  // For 3 s: then the status it had before.
  await expect(status(page)).not.toContainText("Canceled", { timeout: 6000 });
  await expect(status(page).locator("[data-pill='status']")).not.toHaveAttribute("data-state", "cancelled");
});

test("Cancel with launch_cancel calls it", async ({ page }) => {
  await slowLaunch(page, 3000, "now");
  await start(page);
  await row(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row(page).getByRole("button", { name: "Canceling", exact: true })).toBeVisible();
  expect(await calls(page, "launch_cancel")).toBe(1);

  // The backend ended the launch with its own "cancelled" error: not a failure,
  // and nothing was started, so nothing needs stopping.
  await expect(status(page)).toContainText("Canceled", { timeout: 10_000 });
  expect(await calls(page, "process_kill")).toBe(0);
  await expect(status(page)).not.toContainText("Failed");
  await expect(failureToasts(page)).toHaveCount(0);
  await row(page).hover();
  await expect(row(page).getByRole("button", { name: "Start", exact: true })).toBeVisible();
});

test("Cancel at the moment launch returns ends stopped with no error toast", async ({ page }) => {
  // The backend answers launch_cancel only once the launch has gone through:
  // too late to end it, in the same instant the launch returns.
  await slowLaunch(page, 1500, "late");
  await start(page);
  await row(page).getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(status(page)).toContainText("Canceled", { timeout: 10_000 });
  expect(await calls(page, "launch_cancel")).toBe(1);
  // It ended stopped, not running.
  expect(await calls(page, "process_kill")).toBe(1);
  await row(page).hover();
  await expect(row(page).getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(row(page).getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(failureToasts(page)).toHaveCount(0);
});

test("a double-click on Start keeps the profile starting: the second click is not a Cancel", async ({ page }) => {
  await openApp(page);
  await row(page).hover();
  await row(page).getByRole("button", { name: "Start", exact: true }).dblclick();
  // The launch goes through (900 ms in the mock) and the profile is running.
  await expect(row(page).getByRole("button", { name: "Stop", exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await calls(page, "launch_cancel")).toBe(0);
  expect(await calls(page, "process_kill")).toBe(0);
  await expect(status(page)).not.toContainText("Canceled");
});

test("Cancel on a launch longer than the poll's 20 s patience still ends stopped", async ({ page }) => {
  await slowLaunch(page, 4000);
  await start(page);
  await appModule(page, "/src/entities/profile/index.ts", "__profile");
  const running = () => page.evaluate(() =>
    (window as unknown as { __profile: { useProfile: { getState: () => { running: Record<string, number> } } } }).__profile.useProfile.getState().running.aed41005 !== undefined);
  expect(await running()).toBe(true);
  // 21 s on the (fixed) clock: the next poll gives up on the pending start and
  // forgets the profile, while its launch is still going.
  await page.clock.setFixedTime(new Date(NOW.getTime() + 21_000));
  await expect.poll(running, { timeout: 5000 }).toBe(false);
  // Starting still: the person can press Cancel.
  await row(page).getByRole("button", { name: "Cancel", exact: true }).click();

  // The launch returns: the profile is stopped all the same.
  await expect(status(page)).toContainText("Canceled", { timeout: 15_000 });
  expect(await calls(page, "process_kill")).toBe(1);
  await row(page).hover();
  await expect(row(page).getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(row(page).getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  await expect(failureToasts(page)).toHaveCount(0);
});
