import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";
import { cpu, idleLongTasks, scrollScriptPerFrame, twoThousandByName } from "./support/perf";

// Review Focus 3 (scale). The `perf` project runs these on the production
// build of the mock, after every other project. 2,000 profiles in name order,
// the CPU slowed 4x (a mid-range laptop).

test("idle Profiles does no work while nothing changes", async ({ page }) => {
  test.setTimeout(120_000);
  await twoThousandByName(page);
  await cpu(page, 4);
  // Five poll ticks (PERF-01, PERF-20). The overview's bar: no long task in 10 s.
  const idle = await idleLongTasks(page, 10_000);
  expect(idle.count, `long tasks: ${JSON.stringify(idle)}`).toBe(0);
});

test("scrolling 2,000 profiles stays cheap", async ({ page }) => {
  test.setTimeout(120_000);
  await twoThousandByName(page);
  const cdp = await cpu(page, 4);
  // 150 frames at 72 px, two new rows a frame (PERF-02, PERF-03). The
  // overview's bar: under 5 ms of script per frame (Phase D aims at 2).
  const perFrame = await scrollScriptPerFrame(page, cdp);
  expect(perFrame).toBeLessThan(5);
});

test("a right-click menu on 2,000 rows opens within a frame at 1x (PERF-11)", async ({ page }) => {
  await twoThousandByName(page);
  const ms = await page.evaluate(() => {
    const row = document.querySelectorAll<HTMLElement>("[role='row'][data-profile-id]")[3];
    const r = row.getBoundingClientRect();
    const t0 = performance.now();
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 10 }));
    return performance.now() - t0;
  });
  await expect(page.getByRole("menu")).toBeVisible();
  expect(ms).toBeLessThan(16);
});

test("1,000 proxies: Peek's Proxy row opens within a frame, its chooser windowed (PERF-15)", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockProxies: number }).__shardxMockProxies = 1000; });
  await openApp(page);
  // The name cell opens Peek; the status cell is the run button now.
  await page.locator("[role='row'][data-profile-id]").first().locator("[data-cell='name']").click();
  const peek = page.locator("aside[data-peek]");
  if ((await peek.count()) === 0) await page.keyboard.press("Enter");
  const field = peek.locator("[data-property='proxy'] button");
  await expect(field).toBeVisible();
  const ms = await field.evaluate(async (el) => {
    const t0 = performance.now();
    (el as HTMLElement).click();
    // React renders a click's update in a microtask queued by the click: wait
    // for it, so the time covers what opens, not only the handler.
    await Promise.resolve();
    return performance.now() - t0;
  });
  // The row opens the profile's editor on its Proxy tab; the choosing happens
  // there now, and that is the list that must stay windowed with a thousand
  // proxies behind it.
  const form = page.getByRole("dialog").first();
  await expect(form.locator("[data-property='proxy'] button")).toBeVisible();
  expect(ms).toBeLessThan(16);
  await form.locator("[data-property='proxy'] button").click();
  await expect(page.getByRole("option").first()).toBeVisible();
  expect(await page.getByRole("option").count()).toBeLessThanOrEqual(40);
});

test("1,000 proxies: P opens its picker within a frame, windowed (PERF-15, IFACE-04)", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockProxies: number }).__shardxMockProxies = 1000; });
  await openApp(page);
  const r = page.locator("[role='row'][data-profile-id]").first();
  await r.focus();
  const ms = await page.evaluate(() => {
    const t0 = performance.now();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true, cancelable: true }));
    return performance.now() - t0;
  });
  await expect(page.getByRole("option").first()).toBeVisible();
  expect(await page.getByRole("option").count()).toBeLessThanOrEqual(40);
  expect(ms).toBeLessThan(16);
});
