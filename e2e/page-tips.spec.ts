import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp, seed } from "./support/app";

// Onboarding Task 5: page tips. The first visit to Proxies, Fingerprints,
// Extensions, Bookmarks, Automation, Settings or Trash plays that
// page's two or three steps once. Never over the welcome, a tour or a dialog,
// not for pages the full tour showed, not after "Don't show tips".

type Entry = { id: string; section: string; target: string | null; picture?: string };
type TourApi = {
  fullTour: Entry[];
  pageTips: Record<string, Entry[]>;
  useTour: {
    getState: () => { start: (steps: Entry[], kind: "full" | "page") => void };
    subscribe: (fn: (s: { run: { kind: string; page?: string } | null }, p: { run: unknown }) => void) => void;
  };
};
type Win = { __tour: TourApi; __starts: string[] };

const KEY = "shardx.onboarding";
const card = (page: Page) => page.locator("[data-tour-card]");
const scrim = (page: Page) => page.locator("[data-tour-scrim]");
const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), KEY);

/** The welcome answered, the tour never taken, no page seen, tips on. */
const tipsOn = (page: Page, over: Record<string, unknown> = {}) => seed(page, KEY, {
  version: 2, state: "unknown", welcomeDone: true, tour: "never", pagesSeen: [], tipsOff: false, ...over,
});

/** Notes every run that starts, as "full:" or "page:proxies". */
async function recordStarts(page: Page) {
  await appModule(page, "/src/features/tour/index.ts", "__tour");
  await page.evaluate(() => {
    const w = window as unknown as Win;
    w.__starts = [];
    w.__tour.useTour.subscribe((s, p) => { if (s.run && !p.run) w.__starts.push(`${s.run.kind}:${s.run.page ?? ""}`); });
  });
}
const starts = (page: Page) => page.evaluate(() => (window as unknown as Win).__starts);

/** A tip starts well within this once its page is up: what a "nothing started" check waits out. */
const quiet = (page: Page) => page.waitForTimeout(800);

const goTo = (page: Page, section: string) => page.locator(`aside [data-nav='${section}']`).click();

/** The cut-out sits 8 px round the first element with `data-tour="key"` that has a box. */
async function expectHoleAround(page: Page, key: string) {
  const want = () => page.evaluate((k) => {
    const el = [...document.querySelectorAll(`[data-tour="${k}"]`)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 || r.height > 0; });
    if (!el) return null;
    const html = document.documentElement;
    const z = html.getBoundingClientRect().width / html.offsetWidth || 1;
    const r = el.getBoundingClientRect();
    return [r.left / z - 8, r.top / z - 8, r.width / z + 16, r.height / z + 16];
  }, key);
  await expect.poll(async () => {
    const got = (await scrim(page).getAttribute("data-cutout"))?.split(" ").map(Number) ?? [];
    const exp = await want();
    return !!exp && got.length === 5 && exp.every((v, i) => Math.abs(v - got[i]) <= 1);
  }, { message: `the cut-out sits around data-tour=${key}` }).toBe(true);
}

/** The cut-out sits 8 px round the page's title (never the (i) beside it). */
async function expectHoleAroundTitle(page: Page) {
  await expect.poll(async () => {
    const got = (await scrim(page).getAttribute("data-cutout"))?.split(" ").map(Number) ?? [];
    const want = await page.evaluate(() => {
      const el = document.querySelector("main [data-page-title]")!;
      const html = document.documentElement;
      const z = html.getBoundingClientRect().width / html.offsetWidth || 1;
      const r = el.getBoundingClientRect();
      return [r.left / z - 8, r.top / z - 8, r.width / z + 16, r.height / z + 16];
    });
    return got.length === 5 && want.every((v, i) => Math.abs(v - got[i]) <= 1);
  }, { message: "the cut-out sits around the page title" }).toBe(true);
}

/** Waits for the card of step `id` to land. */
async function landed(page: Page, id: string) {
  await expect(card(page)).toHaveAttribute("data-step", id);
  await expect(card(page)).not.toHaveAttribute("data-entering");
}

test("first visit to Proxies plays its tip once", async ({ page }) => {
  await tipsOn(page);
  await openApp(page);
  await recordStarts(page);
  await goTo(page, "proxies");
  await landed(page, "proxiesAdd");
  await expect(card(page)).toContainText("Add your proxies");
  await expect(card(page)).toContainText("1 of 2");
  // A page's run stays on its page: no beat, and the card names the page above the title.
  await expect(card(page)).not.toHaveAttribute("data-beat");
  await expect(card(page).locator("[data-tour-page]")).toHaveText("Proxies");
  // A tip says just "Skip": it is no tour.
  await expect(card(page).getByRole("button", { name: "Skip", exact: true })).toBeVisible();
  await expect(card(page).getByRole("button", { name: "Skip tour" })).toHaveCount(0);
  await expect(card(page).getByRole("button", { name: "Don’t show tips" })).toBeVisible();
  // Its hit area is 40 px tall, as every control's: the box is 30 px and its ::before reaches 5 px beyond,
  // without covering the Next button above it.
  const link = card(page).getByRole("button", { name: "Don’t show tips" });
  const hit = await link.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const before = getComputedStyle(el, "::before");
    const x = r.left + r.width / 2;
    const next = [...el.closest("[data-tour-card]")!.querySelectorAll("button")].find((b) => b.textContent === "Next")!.getBoundingClientRect();
    return {
      boxHeight: Math.round(r.height),
      hitHeight: Math.round(parseFloat(before.height)),
      hitWidth: Math.round(parseFloat(before.width)),
      above: el.contains(document.elementFromPoint(x, r.top - 4)),
      below: el.contains(document.elementFromPoint(x, r.bottom + 4)),
      nextBelow: document.elementFromPoint(next.left + next.width / 2, next.bottom + 4)?.closest("button")?.textContent,
    };
  });
  expect(hit.boxHeight).toBe(30);
  expect(hit.hitHeight).toBeGreaterThanOrEqual(40);
  expect(hit.hitWidth).toBeGreaterThanOrEqual(40);
  expect(hit.above).toBe(true);
  expect(hit.below).toBe(true);
  expect(hit.nextBelow).toBe("Next");
  await expectHoleAround(page, "add-proxy");
  await card(page).getByRole("button", { name: "Next" }).click();
  await landed(page, "proxiesHelp");
  await expect(card(page)).toContainText("About proxies");
  await expect(card(page)).toContainText("2 of 2");
  // The (i) is not what the second step frames: the page's title is.
  await expectHoleAroundTitle(page);
  await card(page).getByRole("button", { name: "Finish" }).click();
  await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
  // Finishing marks the page seen. A tip is no tour: the full tour stays as it was.
  await expect.poll(async () => (await stored(page)).pagesSeen).toEqual(["proxies"]);
  expect((await stored(page)).tour).toBe("never");
  expect((await stored(page)).tipsOff).toBe(false);
  // The second visit plays nothing.
  await goTo(page, "profiles");
  await expect(page.locator("main[data-section='profiles']")).toBeVisible();
  await goTo(page, "proxies");
  await expect(page.locator("main[data-section='proxies'] [data-page-loading]")).toHaveCount(0);
  await quiet(page);
  expect(await starts(page)).toEqual(["page:proxies"]);
  await expect(card(page)).toHaveCount(0);
});

test("every page has its tip: two or three steps, each on its element or its picture", async ({ page }) => {
  test.setTimeout(120_000);
  await tipsOn(page);
  await openApp(page);
  await appModule(page, "/src/features/tour/index.ts", "__tour");
  const registry = await page.evaluate(() => Object.fromEntries(Object.entries((window as unknown as Win).__tour.pageTips).map(([k, v]) => [k, v.map((e) => e.id)])));
  const plan: [string, string[]][] = [
    ["proxies", ["proxiesAdd", "proxiesHelp"]],
    ["fingerprints", ["fingerprintsLibrary", "fingerprintsHelp"]],
    ["extensions", ["extensionsAdd", "extensionsHelp"]],
    ["bookmarks", ["bookmarksAdd", "bookmarksHelp"]],
    ["automation", ["automationProject", "automationEditor", "automationHelp"]],
    ["settings", ["settingsSave", "settingsHelp"]],
    ["trash", ["trashPage", "trashHelp"]],
  ];
  // Profiles has none: its part is the start of the full tour.
  expect(registry).toEqual(Object.fromEntries(plan));
  // A step may stand in the middle with no element: no project open.
  const loose = new Set(["automationEditor"]);
  for (const [section, ids] of plan) {
    await goTo(page, section);
    for (const [i, id] of ids.entries()) {
      await landed(page, id);
      await expect(page.locator(`main[data-section='${section}']`)).toBeVisible();
      await expect(card(page)).toContainText(`${i + 1} of ${ids.length}`);
      const hole = await scrim(page).getAttribute("data-cutout");
      if (id === "automationEditor") {
        expect(hole, `${id} shows its picture`).toBe("none");
        await expect(card(page).locator("[data-tour-picture='automationEditor']")).toBeVisible();
      } else if (!loose.has(id)) {
        expect(hole, `${id} lost its element`).not.toBe("none");
      }
      if (id.endsWith("Help")) await expectHoleAroundTitle(page);
      // Next, or Finish on the last step (the "Don't show tips" link comes after them).
      await card(page).getByRole("button", { name: i === ids.length - 1 ? "Finish" : "Next", exact: true }).click();
    }
    await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
  }
  expect((await stored(page)).pagesSeen).toEqual(plan.map(([s]) => s));
});

test("Skip and Esc each end a tip and mark its page seen", async ({ page }) => {
  await tipsOn(page);
  await openApp(page);
  await goTo(page, "fingerprints");
  await landed(page, "fingerprintsLibrary");
  await card(page).getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).pagesSeen).toEqual(["fingerprints"]);
  await goTo(page, "bookmarks");
  await landed(page, "bookmarksAdd");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
  // A tip comes back from the (i), not from a tour in Settings.
  await expect(page.locator("[data-toast]").filter({ hasText: "You can see this again from the (i) beside the page title" })).toBeVisible();
  await expect.poll(async () => (await stored(page)).pagesSeen).toEqual(["fingerprints", "bookmarks"]);
  // Ending a tip leaves tips on.
  expect((await stored(page)).tipsOff).toBe(false);
});

test("pages seen in the full tour play no tip", async ({ page }) => {
  await tipsOn(page, { tour: "done", pagesSeen: ["profiles", "proxies", "trash"] });
  await openApp(page);
  await recordStarts(page);
  await goTo(page, "proxies");
  await expect(page.locator("main[data-section='proxies'] [data-page-loading]")).toHaveCount(0);
  await quiet(page);
  expect(await starts(page)).toEqual([]);
  // A page it did not show still plays its own.
  await goTo(page, "extensions");
  await landed(page, "extensionsAdd");
  expect(await starts(page)).toEqual(["page:extensions"]);
});

test("after a full tour, the page it ended on plays no tip", async ({ page }) => {
  await tipsOn(page);
  await openApp(page);
  await recordStarts(page);
  // The last step of Profiles' part and Proxies: the tour ends on a page with a tip.
  await page.evaluate(() => {
    const t = (window as unknown as Win).__tour;
    t.useTour.getState().start(t.fullTour.slice(7, 9), "full");
  });
  await landed(page, "viewsFolders");
  await card(page).getByRole("button", { name: "Next" }).click();
  await landed(page, "proxies");
  await card(page).getByRole("button", { name: "Finish" }).click();
  const end = page.getByRole("dialog", { name: "You’re all set." });
  await expect(end).toBeVisible();
  await end.getByRole("button", { name: "Done" }).click();
  await expect(end).toHaveCount(0);
  // Done goes to Profiles (it has no tip); a visit back to the page the tour ended on plays none either.
  await expect(page.locator("main[data-section='profiles']")).toBeVisible();
  await goTo(page, "proxies");
  await expect(page.locator("main[data-section='proxies'] [data-page-loading]")).toHaveCount(0);
  await quiet(page);
  expect(await starts(page)).toEqual(["full:"]);
  await expect(card(page)).toHaveCount(0);
  expect((await stored(page)).pagesSeen).toEqual(["profiles", "proxies"]);
});

test("Don't show tips stops all tips", async ({ page }) => {
  await tipsOn(page);
  await openApp(page);
  await recordStarts(page);
  await goTo(page, "proxies");
  await landed(page, "proxiesAdd");
  await card(page).getByRole("button", { name: "Don’t show tips" }).click();
  await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
  // Off for good, and this page counts as seen.
  await expect.poll(async () => (await stored(page)).tipsOff).toBe(true);
  expect((await stored(page)).pagesSeen).toEqual(["proxies"]);
  await goTo(page, "fingerprints");
  await expect(page.locator("main[data-section='fingerprints'] [data-page-loading]")).toHaveCount(0);
  await quiet(page);
  expect(await starts(page)).toEqual(["page:proxies"]);
  await expect(card(page)).toHaveCount(0);
});

test("Don't show tips holds after a restart", async ({ page }) => {
  await tipsOn(page, { tipsOff: true });
  await openApp(page, { section: "trash" });
  await recordStarts(page);
  await quiet(page);
  expect(await starts(page)).toEqual([]);
  await expect(card(page)).toHaveCount(0);
});

test("no tip while a dialog is open", async ({ page }) => {
  // An update opens What's new at the start, on the page the tip belongs to.
  await page.addInitScript(() => localStorage.setItem("shardx-patchlog-seen-version", "0.0.1"));
  await tipsOn(page);
  await openApp(page, { section: "proxies" });
  await recordStarts(page);
  const news = page.getByRole("dialog", { name: /What’s new/ });
  await expect(news).toBeVisible();
  await quiet(page);
  expect(await starts(page)).toEqual([]);
  await expect(card(page)).toHaveCount(0);
  // Once it closes, the page's first visit gets its tip.
  await page.keyboard.press("Escape");
  await expect(news).toHaveCount(0);
  await landed(page, "proxiesAdd");
  expect(await starts(page)).toEqual(["page:proxies"]);
});

test("the welcome comes first; the tip follows once it is answered", async ({ page }) => {
  await openApp(page, { onboarding: "fresh", section: "proxies" });
  await recordStarts(page);
  const welcome = page.getByRole("dialog", { name: "Welcome to Octopus Agent" });
  await expect(welcome).toBeVisible();
  await quiet(page);
  expect(await starts(page)).toEqual([]);
  await welcome.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(welcome).toHaveCount(0);
  await landed(page, "proxiesAdd");
  expect(await starts(page)).toEqual(["page:proxies"]);
});

test("a storage that cannot be written shows no welcome and no tips", async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "shardx.onboarding") throw new DOMException("blocked", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await openApp(page, { onboarding: "fresh", section: "proxies" });
  await recordStarts(page);
  await expect(page.locator("main[data-section='proxies']")).toBeVisible();
  await quiet(page);
  expect(await starts(page)).toEqual([]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
