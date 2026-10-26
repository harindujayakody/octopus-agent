import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/** Window commands the app sent to the mock backend, e.g. "plugin:window|minimize". */
function windowCalls(page: Page) {
  return page.evaluate(() => (window as unknown as { __shardxMock: { windowCalls: string[] } }).__shardxMock.windowCalls);
}

/** Presses and releases the primary button at a point with no control under it. */
async function pressAt(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

test("no title strip: the app's panels start 8 px from the top edge, on the gray ground", async ({ page }) => {
  await openApp(page);
  // Borderless (owner, 2026-10-01): the sidebar and the page are panels on
  // the ground, 8 px in from the window's edges, with no strip above them.
  expect((await page.locator("aside").boundingBox())?.y).toBe(8);
  expect((await page.locator("main").boundingBox())?.y).toBe(8);
});

test("pressing the gray ground around and between the panels drags the window, and a double press zooms it", async ({ page }) => {
  await openApp(page);
  const sidebar = (await page.locator("aside").boundingBox())!;
  const drags = async () => (await windowCalls(page)).filter((c) => c === "plugin:window|start_dragging").length;
  // Above the panels, at the left edge, and in the gap between them.
  for (const [x, y] of [[400, 3], [3, 400], [sidebar.x + sidebar.width + 4, 400]]) {
    const before = await drags();
    await pressAt(page, x, y);
    await expect.poll(drags, { message: `a press at ${x}, ${y}` }).toBe(before + 1);
  }
  await page.mouse.dblclick(400, 3);
  await expect.poll(() => windowCalls(page)).toContain("plugin:window|toggle_maximize");
});

test("in the real macOS window a 38 px strip holds the traffic lights and the mark sits at the normal left inset", async ({ page }) => {
  // Tauri sets window.isTauri; the traffic lights exist only in its window.
  await page.addInitScript(() => { (window as unknown as { isTauri: boolean }).isTauri = true; });
  await openApp(page);
  const mark = page.locator("aside [data-brand]");
  await expect(mark).toContainText("Octopus Agent");
  const box = (await mark.boundingBox())!;
  // The panels start below a 38 px title strip that holds the lights
  // (trafficLightPosition 14,21); the mark is not pushed right of them.
  expect((await page.locator("aside").boundingBox())?.y).toBe(38);
  expect((await page.locator("main").boundingBox())?.y).toBe(38);
  expect(box.x).toBeLessThanOrEqual(30);
  // The header row is 52 px tall (not collapsed, not grown), and the mark sits inside it.
  const header = (await mark.locator("xpath=..").boundingBox())!;
  expect(header.height).toBe(52);
  expect(box.height).toBeGreaterThan(0);
  expect(box.y + box.height).toBeLessThanOrEqual(header.y + 52);
});

test("without traffic lights (the browser preview) the mark sits at the left, in line with the nav icons", async ({ page }) => {
  await openApp(page);
  const mark = (await page.locator("aside [data-brand]").boundingBox())!;
  const icon = (await page.locator("aside nav").getByText("Proxies", { exact: true }).locator("xpath=..").locator("svg").first().boundingBox())!;
  expect(Math.abs(mark.x - icon.x)).toBeLessThanOrEqual(2);
  expect(mark.y + mark.height).toBeLessThanOrEqual(52);
});

test("no window controls on macOS: the system traffic lights are used", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("button", { name: "Minimize" })).toHaveCount(0);
});

test("pressing an empty spot of the page header drags the window", async ({ page }) => {
  await openApp(page);
  const header = page.locator("main header").first();
  const box = (await header.boundingBox())!;
  await pressAt(page, box.x + box.width / 2, box.y + 4);
  expect(await windowCalls(page)).toContain("plugin:window|start_dragging");
});

test("double-clicking the page header zooms the window", async ({ page }) => {
  await openApp(page);
  const box = (await page.locator("main header").first().boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + 4);
  await expect.poll(() => windowCalls(page)).toContain("plugin:window|toggle_maximize");
});

test.describe("on Windows", () => {
  test.use({ userAgent: WINDOWS_UA });

  test("the caption buttons fill the top-right corner, 46 px each (LAYOUT-08)", async ({ page }) => {
    await openApp(page);
    const group = page.locator("[data-captions]");
    const vw = page.viewportSize()!.width;
    for (const name of ["Minimize", "Maximize", "Close"]) {
      const b = (await group.getByRole("button", { name }).boundingBox())!;
      expect(Math.round(b.width)).toBe(46);
      // The header's full height: Tooltip's wrapper has no box of its own.
      expect(Math.round(b.height)).toBe(52);
      expect(b.y).toBe(0);
    }
    const close = (await group.getByRole("button", { name: "Close" }).boundingBox())!;
    expect(Math.round(close.x + close.width)).toBe(vw);
    // A flick to the corner closes: the corner pixel is the Close button, not the drag region.
    await page.mouse.click(vw - 1, 1);
    expect(await windowCalls(page)).toContain("plugin:window|close");
  });

  test("the header's actions keep clear of the caption buttons", async ({ page }) => {
    await openApp(page);
    const primary = (await page.locator("main header").getByRole("button", { name: "New profile" }).boundingBox())!;
    const minimize = (await page.locator("[data-captions]").getByRole("button", { name: "Minimize" }).boundingBox())!;
    expect(primary.x + primary.width).toBeLessThanOrEqual(minimize.x - 8);
  });

  test("double-clicking the page header maximizes the window", async ({ page }) => {
    await openApp(page);
    const box = (await page.locator("main header").first().boundingBox())!;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + 4);
    expect(await windowCalls(page)).toContain("plugin:window|toggle_maximize");
  });

  test("the window controls act on the window", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Minimize" }).click();
    await page.getByRole("button", { name: "Maximize" }).click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    // The native window also follows the theme (Pair 46, H5: set_theme at start).
    expect((await windowCalls(page)).filter((c) => c !== "plugin:window|set_theme")).toEqual([
      "plugin:window|minimize",
      "plugin:window|toggle_maximize",
      "plugin:window|close",
    ]);
  });

  test("the engine download screen has window controls and drags the window", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __shardxMockEngine: string }).__shardxMockEngine = "offline";
    });
    await openApp(page);
    await expect(page.getByRole("heading", { name: "Couldn’t download the browser engine" })).toBeVisible();
    for (const name of ["Minimize", "Maximize", "Close"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await pressAt(page, 40, 400);
    expect(await windowCalls(page)).toContain("plugin:window|start_dragging");
  });
});
