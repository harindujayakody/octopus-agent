import { expect, test, type Page } from "@playwright/test";
import { openApp, seedATag } from "./support/app";

// O15: Settings > Appearance > Interface size, 90 to 150%, is CSS zoom on
// <html>. It replaces the width-driven root font steps. Overlays open at their
// trigger or pointer, and the layout reacts like a narrower window.

const atSize = (page: Page, n: number) => page.addInitScript((v) => localStorage.setItem("shardx.interfaceSize", String(v)), n);
const zoomOf = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).zoom);
const noPageScroll = (page: Page) =>
  page.evaluate(() => {
    const s = document.scrollingElement!;
    return { x: s.scrollWidth <= window.innerWidth + 1, y: s.scrollHeight <= window.innerHeight + 1 };
  });
const appearance = (page: Page) => page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name: "Appearance" }).click();

test("Interface size shows at once from Settings, and is stored and survives a reload on Save", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await appearance(page);
  await page.getByRole("combobox", { name: "Interface size" }).click();
  await page.getByRole("option", { name: "125%" }).click();
  await expect.poll(() => zoomOf(page)).toBe("1.25");
  await page.locator("[data-save-bar]").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-save-bar]")).toHaveCount(0);
  await page.reload();
  await expect.poll(() => zoomOf(page)).toBe("1.25");
  await appearance(page);
  await page.getByRole("combobox", { name: "Interface size" }).click();
  // Auto, the default, says what it picks for this screen (owner, 2026-10-23).
  await page.getByRole("option", { name: "Auto (currently 100%)" }).click();
  await expect.poll(() => zoomOf(page)).toBe("1");
  await page.locator("[data-save-bar]").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-save-bar]")).toHaveCount(0);
  // Auto is nothing stored.
  expect(await page.evaluate(() => localStorage.getItem("shardx.interfaceSize"))).toBeNull();
});

// Owner, 2026-10-23: on 4K at 150% (a 2560 px wide screen) everything was
// too small. Auto goes by the screen's width in CSS px; a size picked by
// hand wins over it.
test("Auto: 100% on a 1920 screen, 125% on a 2560 one, 150% from 2800; it follows the window to another screen; a size picked by hand wins", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openApp(page);
  expect(await zoomOf(page)).toBe("1");
  await page.setViewportSize({ width: 2560, height: 1440 });
  await expect.poll(() => zoomOf(page)).toBe("1.25");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--page-zoom"))).toBe("1.25");
  expect(await noPageScroll(page)).toEqual({ x: true, y: true });
  await page.setViewportSize({ width: 3840, height: 2160 });
  await expect.poll(() => zoomOf(page)).toBe("1.5");
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.goto("/?section=settings");
  await appearance(page);
  await expect(page.getByRole("combobox", { name: "Interface size" })).toContainText("Auto (currently 125%)");
  await page.getByRole("combobox", { name: "Interface size" }).click();
  await page.getByRole("option", { name: "100%", exact: true }).click();
  await page.locator("[data-save-bar]").getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => zoomOf(page)).toBe("1");
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.waitForTimeout(200);
  expect(await zoomOf(page)).toBe("1");
});

// Auto never leaves a window under 1280 x 800 layout px: the default window
// on a 4K screen stays at 100%, and a bigger one gets what fits.
for (const [width, height, zoom] of [[1280, 800, "1"], [1024, 680, "1"], [1920, 1080, "1.25"], [3840, 2100, "1.5"]] as const) {
  test.describe(`a ${width} x ${height} window on a 4K screen at 100%`, () => {
    test.use({ viewport: { width, height }, contextOptions: { screen: { width: 3840, height: 2160 } } });
    test(`Auto goes by the window too: ${zoom}`, async ({ page }) => {
      await openApp(page);
      expect(await zoomOf(page)).toBe(zoom);
      expect(await noPageScroll(page)).toEqual({ x: true, y: true });
    });
  });
}

// The old build kept "100" for its "100% (default)": that reads as Auto, once.
test("a 100 kept by the old build reads as Auto; a 100 picked now stays 100", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.addInitScript(() => { if (sessionStorage.getItem("seeded") === null) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("shardx.interfaceSize", "100"); } });
  await openApp(page);
  expect(await zoomOf(page)).toBe("1.25");
  expect(await page.evaluate(() => localStorage.getItem("shardx.interfaceSize"))).toBeNull();
  await page.evaluate(() => localStorage.setItem("shardx.interfaceSize", "100"));
  await page.reload();
  await expect.poll(() => zoomOf(page)).toBe("1");
});

test("at 125% in a 1280 x 800 window: no page scrollbar, and opening Peek folds the sidebar like a 1024 window", async ({ page }) => {
  await atSize(page, 125);
  await openApp(page);
  expect(await noPageScroll(page)).toEqual({ x: true, y: true });
  // The rail is never forced by the width alone (Task 8a): it folds when
  // Peek needs the room below 1280 layout px. The sidebar panel is 232 wide
  // (borderless: its 240 less the 8 px of ground beside it).
  expect((await page.locator("aside").first().boundingBox())!.width).toBeCloseTo(232 * 1.25, 0);
  await page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek]")).toBeVisible();
  await expect.poll(async () => (await page.locator("aside").first().boundingBox())!.width).toBeCloseTo(56 * 1.25, 0);
});

// 125% in a 900 px window (720 layout px): the registry's row menu no longer
// fits under the first row in 640.
for (const [n, width, height] of [[125, 1280, 900], [150, 1920, 1080]] as const) {
  test(`at ${n}%: a button's menu opens at its button, a context menu at the pointer`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await atSize(page, n);
    await openApp(page);
    // A row's More actions opens its menu against it, right edges aligned
    // (Phase A Task 4): under the button while the room below is enough,
    // otherwise above it. Which side it takes is the window's business — the
    // menu gained an item ("Copy debugging address") and no longer fits
    // under the top rows at 125% in a 900 px window — so what is checked is
    // that it hangs off the button and stays on screen.
    const first = page.locator("[role='row'][data-profile-id]", { hasText: "Amazon US seller" });
    await first.locator("[data-cell='status']").click();
    const more = first.getByRole("button", { name: "More actions" });
    await more.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const b = (await more.boundingBox())!;
    const m = (await menu.boundingBox())!;
    expect(Math.abs(m.x + m.width - (b.x + b.width))).toBeLessThanOrEqual(2);
    const below = m.y - (b.y + b.height);
    expect(below).toBeLessThanOrEqual(12);
    // Where the room below runs out the menu slides up, and only as far as
    // the window's bottom: it never leaves the screen and never parts from
    // its button.
    if (below < -1) expect(height - (m.y + m.height), `menu bottom at ${m.y + m.height} of ${height}`).toBeLessThanOrEqual(16);
    expect(m.y).toBeGreaterThanOrEqual(0);
    expect(m.y + m.height).toBeLessThanOrEqual(height);
    await page.keyboard.press("Escape");
    const cell = page.locator("[role='row'][data-profile-id]").nth(1).locator("[data-cell='name']");
    const c = (await cell.boundingBox())!;
    const at = { x: c.x + 10, y: c.y + c.height / 2 };
    await page.mouse.click(at.x, at.y, { button: "right" });
    const ctx = (await page.getByRole("menu").boundingBox())!;
    expect(Math.abs(ctx.x - at.x)).toBeLessThanOrEqual(5);
    expect(Math.abs(ctx.y - at.y)).toBeLessThanOrEqual(5);
  });
}

test("at 125%, a column edge, a title's marker and its ghost follow the pointer", async ({ page }) => {
  await seedATag(page);
  await atSize(page, 125);
  await openApp(page);
  const header = page.locator("[role='row'][aria-rowindex='1']");
  const tags = header.locator("[data-col='tags']");
  const before = (await tags.boundingBox())!.width;
  const e = (await header.locator("[data-col-edge='tags']").boundingBox())!;
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
  await page.mouse.down();
  await page.mouse.move(e.x + e.width / 2 + 60, e.y + e.height / 2, { steps: 6 });
  expect(Math.abs((await tags.boundingBox())!.width - (before + 60))).toBeLessThanOrEqual(1);
  await page.mouse.up();
  // Tags over the right half of Proxy lands before Notes: the marker sits 5
  // layout px left of Notes' edge (6.25 client px at 125%; Task 14 review,
  // Minor 4), the ghost 12 layout px past the pointer.
  const t = (await tags.boundingBox())!;
  const proxy = (await header.locator("[data-col='proxy']").boundingBox())!;
  const at = { x: proxy.x + proxy.width - 6, y: proxy.y + proxy.height / 2 };
  await page.mouse.move(t.x + 8, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(t.x + 24, t.y + t.height / 2, { steps: 2 });
  await page.mouse.move(at.x, at.y, { steps: 5 });
  const notes = (await header.locator("[data-col='notes']").boundingBox())!;
  const marker = (await header.locator("[data-column-drop]").boundingBox())!;
  expect(Math.abs(marker.x + marker.width / 2 - (notes.x - 5 * 1.25))).toBeLessThanOrEqual(0.5);
  const ghost = (await page.locator("[data-column-ghost]").boundingBox())!;
  expect(Math.abs(ghost.x - (at.x + 12 * 1.25))).toBeLessThanOrEqual(2);
  expect(Math.abs(ghost.y - (at.y + 12 * 1.25))).toBeLessThanOrEqual(2);
  await page.keyboard.press("Escape");
});

test("at 150% in a 1024 x 680 window the shortcut sheet is one column: 683 layout px is under its 720 (Task 14 review, Minor 2)", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await atSize(page, 150);
  await openApp(page);
  // The Name cell: with no select column at rest (selection mode, Lane C) the
  // Status cell is in view unscrolled here, under the row actions the hover shows.
  await page.locator("[role='row'][data-profile-id]").first().locator("[data-cell='name']").click();
  await page.keyboard.type("?");
  const sections = page.getByRole("dialog", { name: "Keyboard shortcuts" }).locator("section");
  await expect(sections.first()).toBeVisible();
  const first = (await sections.first().boundingBox())!;
  const last = (await sections.last().boundingBox())!;
  expect(Math.abs(last.x - first.x)).toBeLessThanOrEqual(1);
  expect(last.y).toBeGreaterThan(first.y);
});

// PC-113: the sheet is taller than a short window (one column at 150% in a
// 1024 x 680 window is 453 layout px high). It stays inside the window, its
// title stays in view, and its body scrolls to the last row.
test("at 150% in a 1024 x 680 window the shortcut sheet fits the window and scrolls to its last row (PC-113)", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await atSize(page, 150);
  await openApp(page);
  // The Name cell: with no select column at rest (selection mode, Lane C) the
  // Status cell is in view unscrolled here, under the row actions the hover shows.
  await page.locator("[role='row'][data-profile-id]").first().locator("[data-cell='name']").click();
  await page.keyboard.type("?");
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet.getByRole("heading", { name: "Keyboard shortcuts" })).toBeInViewport({ ratio: 1 });
  const box = (await sheet.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(680);
  const lastRow = sheet.locator("section").last().locator(":scope > div").last();
  // The keyboard path (Pair 1 review, Minor 6): the scrolling body is a
  // named region with a Tab stop, and End scrolls it to its last row.
  const body = sheet.getByRole("region", { name: "Keyboard shortcuts" });
  await expect(body).toHaveAttribute("tabindex", "0");
  await body.focus();
  await page.keyboard.press("End");
  await expect(lastRow).toBeInViewport({ ratio: 1 });
  await expect(sheet.getByRole("heading", { name: "Keyboard shortcuts" })).toBeInViewport({ ratio: 1 });
});

test("at 100% the shortcut sheet fits whole: its body is no Tab stop (PC-113)", async ({ page }) => {
  await openApp(page);
  await page.locator("[role='row'][data-profile-id]").first().locator("[data-cell='status']").click();
  await page.keyboard.type("?");
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet.locator("section").first()).toBeVisible();
  await expect(sheet.getByRole("region")).toHaveCount(0);
  await expect(sheet.locator("[tabindex='0']")).toHaveCount(0);
});

test("at 125%, a Select list opens under its field", async ({ page }) => {
  await atSize(page, 125);
  await openApp(page, { section: "settings" });
  await appearance(page);
  const trigger = page.getByRole("combobox", { name: "Interface size" });
  await trigger.click();
  const t = (await trigger.boundingBox())!;
  const list = (await page.getByRole("listbox").locator("xpath=..").boundingBox())!;
  expect(Math.abs(list.x - t.x)).toBeLessThanOrEqual(2);
  expect(list.y - (t.y + t.height)).toBeGreaterThanOrEqual(0);
  expect(list.y - (t.y + t.height)).toBeLessThanOrEqual(10);
});

test("at 150% in a 1920 x 1080 window the palette fits the window", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await atSize(page, 150);
  await openApp(page);
  expect(await noPageScroll(page)).toEqual({ x: true, y: true });
  await page.keyboard.press("ControlOrMeta+k");
  const box = (await page.getByRole("dialog", { name: "Command palette" }).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(1080);
});
