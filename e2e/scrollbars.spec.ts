import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";

// Headless Chromium hides scrollbars; the app's window shows 10 px ones. The
// list's width fitting has to leave room for them.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("at 1280 x 800 a long list keeps every column beside its scrollbar", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockProfiles: number }).__shardxMockProfiles = 80; });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  const grid = page.getByRole("treegrid");
  expect(await grid.evaluate((el) => el.offsetWidth - el.clientWidth)).toBeGreaterThan(2);
  await expect(page.getByRole("columnheader", { name: "Notes" })).toBeVisible();
  expect(await grid.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("at the minimum window size, with the sidebar folded to its rail, a long list fits beside its scrollbar", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockProfiles: number }).__shardxMockProfiles = 80; });
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page);
  // The rail is the user's choice now, not the width's (Task 8a); with the
  // whole sidebar the list scrolls inside its card (profile-new-columns.spec).
  await page.keyboard.press("ControlOrMeta+Backslash");
  const grid = page.getByRole("treegrid");
  await expect.poll(() => grid.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("a list's scrollbar is 8 px and shows only while it scrolls, then hides 700 ms after (owner)", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockProfiles: number }).__shardxMockProfiles = 80; });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  const grid = page.getByRole("treegrid");
  // Thinner than the system's: the bar takes 8 px of the box.
  expect(await grid.evaluate((el) => el.offsetWidth - el.clientWidth)).toBe(8);
  await expect(grid).not.toHaveAttribute("data-scroll-active");
  await grid.evaluate((el) => { el.scrollTop = 400; });
  await expect(grid).toHaveAttribute("data-scroll-active", "");
  // The clock is frozen in tests; the idle timer runs on real time.
  await page.clock.runFor(800);
  await expect(grid).not.toHaveAttribute("data-scroll-active", { timeout: 3000 });
});
