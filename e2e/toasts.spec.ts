import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { openSearch } from "./support/search";

const raise = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __shardxToast: { undo: (t: string, f: () => void) => void }; undone?: number };
  w.__shardxToast.undo("Moved 1 to the trash", () => { w.undone = (w.undone ?? 0) + 1; });
});
const undone = (page: Page) => page.evaluate(() => (window as unknown as { undone?: number }).undone ?? 0);
const toast = (page: Page) => page.locator("[data-toast]").filter({ hasText: "Moved 1 to the trash" });

test("an Undo toast runs its action once and goes away", async ({ page }) => {
  await openApp(page);
  await raise(page);
  await toast(page).getByRole("button", { name: "Undo" }).click();
  await expect(toast(page)).toHaveCount(0);
  expect(await undone(page)).toBe(1);
});

test("an Undo toast lasts about 6 s, and stays while the pointer is on it", async ({ page }) => {
  test.slow(); // waits out a 6 s toast by design: 4.5 s + 3 s + the dismissal
  await openApp(page);
  await raise(page);
  await page.waitForTimeout(4500);
  await expect(toast(page)).toBeVisible();
  await toast(page).hover();
  await page.waitForTimeout(3000);
  await expect(toast(page)).toBeVisible();
  await page.mouse.move(10, 10);
  await expect(toast(page)).toHaveCount(0, { timeout: 8000 });
  expect(await undone(page)).toBe(0);
});

test("Cmd/Ctrl+Z runs the newest Undo, but not while typing", async ({ page }) => {
  await openApp(page);
  await raise(page);
  const filter = await openSearch(page);
  await filter.fill("abc");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await undone(page)).toBe(0);
  await filter.blur();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => undone(page)).toBe(1);
  await expect(toast(page)).toHaveCount(0);
});

type ToastApi = {
  ok: (t: string, o?: unknown) => number;
  info: (t: string, o?: unknown) => number;
  saved: (t: string) => number;
  warn: (w: { title: string }) => number;
  err: (t: string) => number;
  fail: (f: { title: string; detail?: unknown }) => number;
  progress: (p: { title: string; total: number }) => { update: (n: number, t?: string) => void; done: (s: { title: string; failed?: number }) => void };
};
const api = (page: Page) => (fn: (t: ToastApi) => void) =>
  page.evaluate((src) => { new Function("t", `(${src})(t)`)((window as unknown as { __shardxToast: ToastApi }).__shardxToast); }, fn.toString());
const stack = (page: Page) => page.locator("[data-toast]");
// The stack's "1 more".
const more = (page: Page) => page.getByRole("region", { name: /Notifications/ }).getByText(/1 more/);

test("the same toast six times is one toast, with no count", async ({ page }) => {
  await openApp(page);
  await api(page)((t) => { for (let i = 0; i < 6; i++) t.ok("Copied the profile ID"); });
  await expect(stack(page)).toHaveCount(1);
  await expect(stack(page)).not.toContainText("×");
});

// The page clock moves the toast timers (Date stays fixed in tests, so the
// store counts time on the monotonic clock).
const here = (page: Page, text: string) => stack(page).filter({ hasText: text });

test("error toast closes after 8 s", async ({ page }) => {
  await openApp(page);
  await api(page)((t) => t.fail({ title: "Couldn’t start “Sandbox”", detail: new Error("port 9222 busy") }));
  await expect(here(page, "Couldn’t start")).toBeVisible();
  await page.clock.runFor(6500);
  await expect(here(page, "Couldn’t start")).toBeVisible();
  await page.clock.runFor(2000);
  await expect(here(page, "Couldn’t start")).toHaveCount(0);
});

test("info closes after 5 s", async ({ page }) => {
  await openApp(page);
  await api(page)((t) => t.info("Profile ID copied"));
  await page.clock.runFor(3500);
  await expect(here(page, "Profile ID copied")).toBeVisible();
  await page.clock.runFor(2000);
  await expect(here(page, "Profile ID copied")).toHaveCount(0);
});

test("a save closes after 3 s; a warning and a toast with an action after 8 s", async ({ page }) => {
  await openApp(page);
  await api(page)((t) => {
    t.saved("Sandbox saved");
    t.warn({ title: "Launcher is out of date" });
    t.ok("Imported 3 proxies", { action: { label: "Open", run: () => {} } });
  });
  await expect(stack(page)).toHaveCount(3);
  await page.clock.runFor(4500);
  await expect(here(page, "Sandbox saved")).toHaveCount(0);
  await expect(here(page, "Launcher is out of date")).toBeVisible();
  await expect(here(page, "Imported 3 proxies")).toBeVisible();
  await page.clock.runFor(4500);
  await expect(stack(page)).toHaveCount(0);
});

test("hover pauses and leaving resumes the remaining time", async ({ page }) => {
  await openApp(page);
  await api(page)((t) => t.ok("Copied the profile ID"));
  const copied = here(page, "Copied the profile ID");
  await expect(copied).toBeVisible();
  await page.clock.runFor(3000);
  await copied.hover();
  // Held far past its 5 s: it stays.
  await page.clock.runFor(10_000);
  await expect(copied).toBeVisible();
  await page.mouse.move(10, 10);
  // About 2 s were left, not a fresh 5 s.
  await page.clock.runFor(500);
  await expect(copied).toBeVisible();
  await page.clock.runFor(2500);
  await expect(copied).toHaveCount(0);
});

test("a repeat restarts the timer and shows no ×2", async ({ page }) => {
  await openApp(page);
  await api(page)((t) => t.ok("Copied the profile ID"));
  await page.clock.runFor(3000);
  await api(page)((t) => t.ok("Copied the profile ID"));
  await expect(stack(page)).toHaveCount(1);
  await expect(stack(page)).not.toContainText("×2");
  // 6 s after the first, 3 s after the second: the first alone would be gone.
  await page.clock.runFor(3000);
  await expect(here(page, "Copied the profile ID")).toBeVisible();
  await page.clock.runFor(2500);
  await expect(here(page, "Copied the profile ID")).toHaveCount(0);
});

test("at most three show; older plain toasts give way, errors wait their turn", async ({ page }) => {
  await openApp(page);
  await api(page)((t) => { for (const n of [1, 2, 3, 4, 5]) t.ok(`Saved ${n}`); });
  await expect(stack(page)).toHaveCount(3);
  await expect(stack(page).first()).toContainText("Saved 3");
  await api(page)((t) => { for (const n of [1, 2, 3, 4]) t.fail({ title: `Couldn’t save ${n}` }); });
  await expect(stack(page)).toHaveCount(3);
  await expect(more(page)).toBeVisible();
});

// Pair 13 review, Important 1: the toast just raised never gives way.
test("a new toast shows even over three errors; the oldest error waits behind 1 more", async ({ page }) => {
  await openApp(page);
  await api(page)((t) => { for (const n of [1, 2, 3]) t.fail({ title: `Couldn’t save ${n}` }); t.ok("Copied the profile ID"); });
  await expect(stack(page).filter({ hasText: "Copied the profile ID" })).toBeVisible();
  await expect(stack(page)).toHaveCount(3);
  await expect(more(page)).toBeVisible();
});

test("a toast waiting behind three Undos starts its time only once it shows", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const t = (window as unknown as { __shardxToast: { undo: (t: string, f: () => void) => void; ok: (t: string) => void } }).__shardxToast;
    for (const n of [1, 2, 3]) t.undo(`Moved ${n} to the trash`, () => {});
    t.ok("Copied the profile ID");
  });
  const copied = stack(page).filter({ hasText: "Copied the profile ID" });
  await expect(copied).toHaveCount(0);
  // The Undos last 6 s; a waiting toast's own 5 s had not started.
  await expect(copied).toBeVisible({ timeout: 8000 });
});

test("an error keeps its detail apart from the title, and can be dismissed", async ({ page }) => {
  await openApp(page);
  await api(page)((t) => t.fail({ title: "Couldn’t start “Sandbox”", detail: new Error("port 9222 busy") }));
  const toast = stack(page).filter({ hasText: "Couldn’t start “Sandbox”" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("port 9222 busy");
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(toast).toHaveCount(0);
});

test("a progress toast updates in place and ends as a result", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const t = (window as unknown as { __shardxToast: ToastApi }).__shardxToast;
    const p = t.progress({ title: "Starting 0 of 3 profiles", total: 3 });
    (window as unknown as { __p: typeof p }).__p = p;
  });
  await expect(page.getByRole("progressbar", { name: "Starting 0 of 3 profiles" })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __p: { update: (n: number, t: string) => void } }).__p.update(2, "Starting 2 of 3 profiles"));
  await expect(stack(page)).toHaveCount(1);
  await expect(stack(page)).toContainText("Starting 2 of 3 profiles");
  await page.evaluate(() => (window as unknown as { __p: { done: (s: { title: string; failed: number }) => void } }).__p.done({ title: "Started 2 of 3 profiles. 1 failed", failed: 1 }));
  await expect(stack(page)).toContainText("Started 2 of 3 profiles. 1 failed");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

test("toasts are announced: successes politely, errors assertively", async ({ page }) => {
  await openApp(page);
  const polite = page.locator("[data-live='polite']");
  const assertive = page.locator("[data-live='assertive']");
  await expect(polite).toHaveAttribute("role", "status");
  await expect(assertive).toHaveAttribute("role", "alert");
  await api(page)((t) => t.ok("Saved"));
  await expect(polite).toHaveText("Saved");
  await api(page)((t) => t.fail({ title: "Couldn’t save", detail: "disk full" }));
  await expect(assertive).toHaveText("Couldn’t save. disk full");
});

test("toasts sit at the bottom center of the list, above the bulk bar", async ({ page }) => {
  await openApp(page);
  await page.locator("[role='row'][data-profile-id]").first().locator("[data-cell='checkbox'] input").check({ force: true });
  await api(page)((t) => t.ok("Saved"));
  const toast = (await page.locator("[data-toast]").first().boundingBox())!;
  const bar = (await page.locator("[data-bulk-bar]").boundingBox())!;
  // The list column's visible part (F10), not `main`.
  const column = (await page.locator("[data-toast-anchor]").boundingBox())!;
  expect(Math.abs(toast.x + toast.width / 2 - (column.x + column.width / 2))).toBeLessThanOrEqual(2);
  expect(toast.y + toast.height).toBeLessThanOrEqual(bar.y);
});

test("timers wait while the window is hidden", async ({ page }) => {
  test.slow(); // holds a toast past its 5 s timer while hidden
  await openApp(page);
  await api(page)((t) => t.ok("Started"));
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(6000);
  await expect(page.locator("[data-toast]").filter({ hasText: "Started" })).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("[data-toast]").filter({ hasText: "Started" })).toHaveCount(0, { timeout: 8000 });
});

test("dismissing a toast from the keyboard keeps focus nearby", async ({ page }) => {
  await openApp(page);
  await api(page)((t) => { t.fail({ title: "First" }); t.fail({ title: "Second" }); });
  const dismiss = page.locator("[data-toast]").filter({ hasText: "Second" }).getByRole("button", { name: "Dismiss" });
  await dismiss.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-toast]").filter({ hasText: "First" }).getByRole("button", { name: "Dismiss" })).toBeFocused();
});

// Pair 13 review, Minor 5: the toast layer is above dialogs, so a lasting
// error must not sit on a dialog's buttons in a short window. At 480 px the
// stack's usual place overlaps the New folder dialog; it moves just under it.
test("a toast that fits beside an open dialog does not cover it", async ({ page }) => {
  await openApp(page);
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.getByRole("button", { name: "New folder" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await api(page)((t) => t.fail({ title: "Couldn’t save" }));
  await expect(stack(page)).toHaveCount(1);
  const d = (await dialog.boundingBox())!;
  for (const box of await Promise.all((await stack(page).all()).map((t) => t.boundingBox()))) {
    const b = box!;
    const apart = b.y + b.height <= d.y || b.y >= d.y + d.height || b.x + b.width <= d.x || b.x >= d.x + d.width;
    expect(apart).toBe(true);
  }
});
