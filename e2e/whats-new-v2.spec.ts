import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { pickOption } from "./support/select";

// CRAFT-28: titles first; a body opens on demand.
const open = async (page: Page, lang: "en" | "zh" = "en") => {
  await page.addInitScript((l) => { localStorage.setItem("shardx.lang", l); localStorage.setItem("shardx-patchlog-seen-version", "0.0.1"); }, lang);
  await openApp(page);
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();
  return dialog;
};

test("every entry opens collapsed, as a row with its lead", async ({ page }) => {
  const dialog = await open(page);
  // The newest release, 2.3.0, has six.
  await expect(dialog.locator("[data-entry]")).toHaveCount(6);
  await expect(dialog.locator("[data-entry-body]")).toHaveCount(0);
  for (const b of await dialog.locator("[data-entry] button[aria-expanded]").all()) await expect(b).toHaveAttribute("aria-expanded", "false");
});

test("an entry opens and closes from the keyboard", async ({ page }) => {
  const dialog = await open(page);
  const first = dialog.locator("[data-entry] button[aria-expanded]").first();
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.locator("[data-entry-body]")).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect(dialog.locator("[data-entry-body]")).toHaveCount(0);
});

test("first focus is the panel, not the release picker (plan ruling 23)", async ({ page }) => {
  const dialog = await open(page);
  await expect(dialog.locator("[data-whats-new-panel]")).toBeFocused();
});

test("entries are grouped by what changed, with counts", async ({ page }) => {
  const dialog = await open(page);
  // 2.3.0 changed the launcher only: no Browser group.
  await expect(dialog.locator("[data-scope-group='launcher'] h3")).toHaveText(/^Launcher\s*6$/);
  await expect(dialog.locator("[data-scope-group='browser']")).toHaveCount(0);
  // 2.1.2 changed both.
  await pickOption(dialog, "Release", /^v2\.1\.2/);
  await expect(dialog.locator("[data-scope-group='launcher'] h3")).toHaveText(/^Launcher\s*\d+$/);
  await expect(dialog.locator("[data-scope-group='browser'] h3")).toHaveText(/^Browser\s*\d+$/);
});

test("no synthesized italics; badges are neutral (TYPE-11, COLOR-10)", async ({ page }) => {
  const dialog = await open(page);
  for (const b of await dialog.locator("[data-entry] button[aria-expanded]").all()) await b.click();
  await expect(dialog.locator("em, i")).toHaveCount(0);
  const colors = await dialog.locator("[data-entry] [data-badge]").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-color")))]);
  expect(colors.every((c) => c === "gray" || c === "warning")).toBe(true);
});

test("in Chinese the notes say they are in English (WRITE-27)", async ({ page }) => {
  const dialog = await open(page, "zh");
  await expect(dialog.getByText("更新说明仅提供英文版。")).toBeVisible();
});

// Live layer 6.3: a body's height moves from what shows now, so a second
// press mid-way turns it around; under Reduce motion it opens at once.
// The suite runs with Reduce motion on (playwright.config.ts); this one moves.
test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });
  test("a body opens from its current height and turns around mid-way", async ({ page }) => {
    const dialog = await open(page);
    // Slowed tenfold, so "mid-way" does not depend on the machine's speed.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Animation.enable");
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 0.1 });
    const first = dialog.locator("[data-entry] button[aria-expanded]").first();
    await first.click();
    const body = dialog.locator("[data-entry-body]");
    const mid = await body.evaluate((el) => ({ h: el.offsetHeight, full: el.scrollHeight, moving: el.getAnimations().length }));
    expect(mid.moving).toBe(1);
    expect(mid.h).toBeLessThan(mid.full);
    await first.click();
    // It closes from where it was, not from its full height.
    expect(await body.evaluate((el) => el.offsetHeight)).toBeLessThan(mid.full);
    await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 });
    await expect(body).toHaveCount(0);
  });
});

test("under Reduce motion a body opens and closes at once", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dialog = await open(page);
  const first = dialog.locator("[data-entry] button[aria-expanded]").first();
  await first.click();
  const body = dialog.locator("[data-entry-body]");
  const shown = await body.evaluate((el) => ({ moving: el.getAnimations().length, h: el.offsetHeight, full: el.scrollHeight }));
  expect(shown.moving).toBe(0);
  expect(shown.h).toBe(shown.full);
  await first.click();
  await expect(body).toHaveCount(0);
});
