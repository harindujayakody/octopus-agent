import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";

// LAYOUT-11: a full-window panel is square; the window edge is the frame.
test("the sync panel fills its window with square corners", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 120 });
  await openApp(page, { hash: "#/?syncPanel=g1" });
  const shell = page.locator("[data-floating-panel]");
  await expect(shell).toBeVisible();
  expect(await shell.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("0px");
});

test("a press on a disabled button does not move the window (PC-011)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 120 });
  // Hold takes 1.5 s: meanwhile both buttons are disabled.
  await page.addInitScript(() => Object.assign(window, { __shardxMockSlow: { sync_set_paused: 1500 } }));
  await openApp(page, { hash: "#/?syncPanel=g1" });
  const drags = () => page.evaluate(() => (window as unknown as { __shardxMock: { windowCalls: string[] } }).__shardxMock.windowCalls.filter((c) => c.includes("start_dragging")).length);
  await page.getByRole("button", { name: /^Hold/ }).click();
  const stop = page.getByRole("button", { name: "Close every window in the group" });
  await expect(stop).toHaveAttribute("aria-disabled", "true");
  const before = await drags();
  const box = (await stop.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  expect(await drags()).toBe(before);
});

// F39 (Pair 52): the three satellite windows, square, each in both themes.
// Baselines first recorded at merge point 8.
for (const theme of ["dark", "light"] as const) {
  for (const [name, hash] of [["sync", "#/?syncPanel=g1"], ["helper", "#/?helperPanel=aed41005"], ["fleet", "#/?fleet=1"]] as const) {
    test(`satellite ${name}, ${theme}`, { tag: "@visual" }, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: name === "fleet" ? 420 : 160 });
      await openApp(page, { hash, theme });
      await expect(page).toHaveScreenshot(`satellite-${name}-${theme}.png`);
    });
  }
}
