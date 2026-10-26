import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp, openEditForm, waitForIdle } from "./support/app";
import { pickOption } from "./support/select";

// PERF-14: Peek follows the arrows from a cache; no frame shows it without
// its form. Etsy craft shop, FB Ads acc-02 and TikTok creator are neighbors.
const peek = (page: Page) => page.locator("aside[data-peek]");
const knob = (page: Page, name: string, value: unknown) =>
  page.evaluate(([n, v]) => { (window as unknown as Record<string, unknown>)[n as string] = v; }, [name, value] as const);

/** Starts counting frames with Peek open and no form in it; the returned function stops and reads. */
async function watchBlankFrames(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __blank: number; __watch: boolean };
    w.__blank = 0;
    w.__watch = true;
    const tick = () => {
      if (!w.__watch) return;
      const p = document.querySelector("aside[data-peek]");
      if (p && !p.querySelector("[data-peek-section]")) w.__blank++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () => page.evaluate(() => {
    const w = window as unknown as { __blank: number; __watch: boolean };
    w.__watch = false;
    return w.__blank;
  });
}

async function openOn(page: Page, id: string) {
  await page.locator(`[role='row'][data-profile-id='${id}'] [data-cell='name']`).click();
  await expect(peek(page).locator("[data-peek-section]").first()).toBeVisible();
  // The neighbors' forms load while the browser is idle (at most 500 ms later).
  await page.waitForTimeout(600);
  await waitForIdle(page);
}

test("going back to a profile shows its form on the first frame", async ({ page }) => {
  await openApp(page);
  await openOn(page, "aed41005");
  await page.keyboard.press("ArrowDown");
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: FB Ads acc-02");
  await expect(peek(page).locator("[data-peek-section]").first()).toBeVisible();
  await waitForIdle(page);
  await knob(page, "__shardxMockSlow", { profile_get: 2000 });
  const stop = await watchBlankFrames(page);
  await page.keyboard.press("ArrowUp");
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: Etsy craft shop");
  await page.waitForTimeout(300);
  expect(await stop()).toBe(0);
  // Peek only shows: its form is the Fingerprint rows (read from the cache on the first frame).
  await expect(peek(page).locator("[data-peek-section='fingerprint'] [data-property='os']")).toBeVisible();
});

test("the next row's form is ready before the arrow gets there", async ({ page }) => {
  await openApp(page);
  await openOn(page, "aed41005");
  await knob(page, "__shardxMockSlow", { profile_get: 2000 });
  const stop = await watchBlankFrames(page);
  await page.keyboard.press("ArrowDown");
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: FB Ads acc-02");
  await page.waitForTimeout(300);
  expect(await stop()).toBe(0);
});

test.describe("where requestIdleCallback does not exist (WKWebView)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { delete (window as { requestIdleCallback?: unknown }).requestIdleCallback; });
  });

  test("the next row's form is still ready", async ({ page }) => {
    await openApp(page);
    await openOn(page, "aed41005");
    await knob(page, "__shardxMockSlow", { profile_get: 2000 });
    const stop = await watchBlankFrames(page);
    await page.keyboard.press("ArrowDown");
    await expect(peek(page)).toHaveAttribute("aria-label", "Peek: FB Ads acc-02");
    await page.waitForTimeout(300);
    expect(await stop()).toBe(0);
  });
});

test("a profile changed elsewhere shows its new values after the cached ones", async ({ page }) => {
  await openApp(page);
  await openOn(page, "aed41005");
  await page.keyboard.press("ArrowDown");
  await waitForIdle(page);
  // Changed through the API while Peek shows another profile: a value the
  // form holds and Peek shows (its timezone).
  await page.evaluate(async () => {
    type I = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
    const w = window as unknown as { __TAURI_INTERNALS__: I };
    const stored = (await w.__TAURI_INTERNALS__.invoke("profile_get", { id: "aed41005" })) as { timezone: string };
    stored.timezone = "Europe/Paris";
    await w.__TAURI_INTERNALS__.invoke("profile_save", { payload: stored });
  });
  await page.keyboard.press("ArrowUp");
  await expect(peek(page).locator("[data-peek-section='fingerprint'] [data-property='timezone']")).toContainText("Europe/Paris");
});

// PC-061: what a save wrote is what Peek shows when it comes back. The form
// is a dialog now, so a save cannot be on its way while the person moves to
// another profile; the first frame back must still hold the saved values.
test("coming back to a profile just saved in the form shows what was saved", async ({ page }) => {
  await openApp(page);
  await openOn(page, "aed41005");
  const form = await openEditForm(page, "Etsy craft shop", "Fingerprint");
  await pickOption(form, "Timezone", "Europe/Paris");
  await knob(page, "__shardxMockSlow", { profile_save: 1500 });
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.locator("[role='row'][data-profile-id]", { hasText: "FB Ads acc-02" }).locator("[data-cell='name']").click();
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: FB Ads acc-02");
  await expect(peek(page).locator("[data-peek-section]").first()).toBeVisible();
  // On the first frame (Pair 18 review, M2): the save's own row update
  // no longer drops the saved form from the cache.
  const stop = await watchBlankFrames(page);
  await page.locator("[role='row'][data-profile-id='aed41005'] [data-cell='name']").click();
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: Etsy craft shop");
  await page.waitForTimeout(300);
  expect(await stop()).toBe(0);
  const timezone = peek(page).locator("[data-peek-section='fingerprint'] [data-property='timezone']");
  await expect(timezone).toContainText("Europe/Paris");
  await waitForIdle(page);
  await expect(timezone).toContainText("Europe/Paris");
});

// Pair 18 review, M1: a read that left before a save and lands after it
// never puts the older form back.
test("the cache never goes back to an older rev", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/entities/profile/lib/formCache.ts", "__forms");
  type F = { __forms: { rememberForm: (f: { id: string; rev: number; notes: string }) => void; peekForm: (id: string) => { notes: string } | undefined } };
  const notes = await page.evaluate(() => {
    const c = (window as unknown as F).__forms;
    c.rememberForm({ id: "r1", rev: 5, notes: "saved" });
    c.rememberForm({ id: "r1", rev: 4, notes: "read before the save" });
    return c.peekForm("r1")?.notes;
  });
  expect(notes).toBe("saved");
});

test("the cache keeps the 50 most recent forms", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/entities/profile/lib/formCache.ts", "__forms");
  type F = { __forms: { rememberForm: (f: { id: string }) => void; cachedForm: (id: string) => unknown; peekForm: (id: string) => unknown; FORM_CACHE_SIZE: number } };
  const out = await page.evaluate(() => {
    const c = (window as unknown as F).__forms;
    for (let i = 0; i < c.FORM_CACHE_SIZE; i++) c.rememberForm({ id: `t${i}` });
    c.cachedForm("t0"); // t0 is recent again
    c.rememberForm({ id: "t50" }); // one too many: the oldest untouched goes
    return { t0: !!c.peekForm("t0"), t1: !!c.peekForm("t1"), t50: !!c.peekForm("t50") };
  });
  expect(out).toEqual({ t0: true, t1: false, t50: true });
});
