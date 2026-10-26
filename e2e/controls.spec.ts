import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// C11 (Pair 15): controls show busy and open states in place.

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });

test("while a profile starts, its button keeps focus and says Cancel (enabled), and Stop takes its place once the launch returns", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockSlow: Record<string, number> }).__shardxMockSlow = { launch: 1500 }; });
  await openApp(page);
  const r = row(page, "Sandbox");
  await r.locator("[data-cell='status']").click();
  if (await page.locator("aside[data-peek]").count()) await page.keyboard.press("Escape");
  const start = r.getByRole("button", { name: "Start" });
  await start.focus();
  await page.keyboard.press("Enter");
  const starting = r.getByRole("button", { name: "Cancel", exact: true });
  await expect(starting).toBeFocused();
  await expect(starting).not.toHaveAttribute("aria-disabled");
  const stop = r.getByRole("button", { name: "Stop" });
  await expect(stop).toBeVisible({ timeout: 5000 });
  await expect(stop).toBeFocused();
});

test("a proxy row's Test spins and stays in view while it runs", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockSlow: Record<string, number> }).__shardxMockSlow = { proxy_full_test: 1500 }; });
  await openApp(page, { section: "proxies" });
  const r = page.locator("[role='row']", { hasText: "DC Tokyo" });
  await r.hover();
  await r.getByRole("button", { name: /^Test/ }).click();
  await page.mouse.move(5, 5);
  const test = r.getByRole("button", { name: /^Test/ });
  await expect(test).toBeVisible();
  await expect(test).toHaveAttribute("aria-busy", "true");
});

test("the Filters and Display buttons say, and show, when their panel is open", async ({ page }) => {
  await openApp(page);
  for (const name of [/^Filters/, /^Display/]) {
    const trigger = page.getByRole("button", { name });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    const rest = await trigger.evaluate((el) => getComputedStyle(el).backgroundColor);
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    // Pointer off the trigger: the fill left is the open look, not a hover.
    await page.mouse.move(5, 5);
    await expect.poll(() => trigger.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(rest);
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }
});

test("the color choices in a list row are 21 px with 24 px targets", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("shardx.tags") === null) {
      localStorage.setItem("shardx.tags", JSON.stringify({ version: 1, tags: [{ id: "t-vip", name: "VIP", color: "violet" }], byProfile: {} }));
    }
  });
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Tags" }).click();
  const radio = page.getByRole("radiogroup").first().getByRole("radio").first();
  const box = (await radio.boundingBox())!;
  // Owner: every swatch is 21 px drawn, the one in a list row too.
  expect(Math.round(box.width)).toBe(21);
  expect(Math.round(box.height)).toBe(21);
  // The hit area is the swatch's ::before, drawn past its edge on each side.
  const hit = await radio.evaluate((el) => {
    const a = getComputedStyle(el, "::before");
    return { top: parseFloat(a.top), left: parseFloat(a.left) };
  });
  expect(box.width - 2 * hit.left).toBeGreaterThanOrEqual(24);
  expect(box.height - 2 * hit.top).toBeGreaterThanOrEqual(24);
});
