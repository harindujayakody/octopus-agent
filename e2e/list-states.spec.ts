import { expect, test, type Locator, type Page } from "@playwright/test";
import { NOW, openApp, pressCreate } from "./support/app";
import { filterBy } from "./support/filters";
import { openSearch } from "./support/search";

const rows = (page: Page) => page.locator("[role='row'][data-profile-id]");
const slow = (page: Page, cmds: Record<string, number>) => page.addInitScript((c) => { (window as unknown as { __shardxMockSlow: Record<string, number> }).__shardxMockSlow = c; }, cmds);
const fail = (page: Page, cmds: Record<string, number>) => page.addInitScript((c) => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = c; }, cmds);
const sidebar = (page: Page) => page.locator("aside nav");
/** Fails the next n calls of each command, armed in the same task as the
 *  click that opens the page: the profile list reads proxies and fingerprints
 *  at start too (PERF-18), and a background read (the store's bus listeners)
 *  between a separate arm and the click would use up the one-shot. */
const failOnClick = (target: Locator, cmds: Record<string, number>) => target.evaluate((el, c) => {
  (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = c;
  (el as HTMLElement).click();
}, cmds);

test("Profiles: loading shows placeholder rows, never 'No profiles yet'", async ({ page }) => {
  await slow(page, { profile_list: 2500 });
  await openApp(page, { idle: false });
  await expect(page.locator("[data-loading]")).toBeVisible();
  await expect(page.getByText("No profiles yet")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(8, { timeout: 8000 });
  await expect(page.locator("[data-loading]")).toHaveCount(0);
});

test("Profiles: a load error says so; a Retry that fails again stays on the error; the next Retry loads", async ({ page }) => {
  await fail(page, { profile_list: 2 });
  await openApp(page);
  await expect(page.getByText("Couldn’t load profiles")).toBeVisible();
  // The reason shows in the list itself, not only in a notification. A list
  // with no rows (an error included) is a plain region, not a grid claiming
  // rows it doesn't have.
  await expect(page.locator("main").getByRole("region").getByText("Mock failure: profile_list")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Couldn’t load profiles")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(rows(page)).toHaveCount(8);
});

test("Profiles: a search matching nothing offers Clear search", async ({ page }) => {
  await openApp(page);
  await (await openSearch(page)).fill("zzzz");
  await expect(page.getByText("No profiles match")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(rows(page)).toHaveCount(8);
});

test("Profiles: filters matching nothing offer Clear filters", async ({ page }) => {
  await openApp(page);
  await filterBy(page, "Status", "Running");
  await filterBy(page, "Connection", "No proxy");
  await expect(page.getByText("No profiles match these filters")).toBeVisible();
  await page.locator("main").getByRole("region").getByRole("button", { name: "Clear filters" }).click();
  await expect(rows(page)).toHaveCount(8);
});

test("Profiles: an empty Folder says so, and New profile lands in it", async ({ page }) => {
  await page.addInitScript(() => { if (localStorage.getItem("shardx-folders") === null) localStorage.setItem("shardx-folders", JSON.stringify(["Empty1"])); });
  await openApp(page);
  await sidebar(page).locator("[data-folder='Empty1']").click();
  await expect(page.getByText("No profiles in Empty1")).toBeVisible();
  await page.locator("main").getByRole("button", { name: "New profile" }).last().click();
  await pressCreate(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(sidebar(page).locator("[data-folder='Empty1'] [data-count]")).toHaveText("1");
});

test("Profiles: a View showing nothing offers All profiles; a search in it says No profiles match", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.views", JSON.stringify({ version: 1, views: [
    { id: "v-none", name: "Running direct", pinned: true, query: { folder: "all", filters: { status: "running", country: "", proxy: "direct", tag: "", lastRun: "any" }, sort: "added", columns: { folder: true, tags: true, lastRun: true, notes: true } } },
  ] })));
  await openApp(page);
  await sidebar(page).getByText("Running direct", { exact: true }).click();
  await expect(page.getByText("No profiles in Running direct", { exact: true })).toBeVisible();
  await expect(page.getByText("Profiles show up here when they match this view’s filters.")).toBeVisible();
  await (await openSearch(page)).fill("zzzz");
  await expect(page.getByText("No profiles match")).toBeVisible();
  await (await openSearch(page)).fill("");
  await page.locator("main").getByRole("button", { name: "All profiles" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("All profiles");
  await expect(rows(page)).toHaveCount(8);
});

test("in Chinese", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
  await openApp(page);
  await (await openSearch(page)).fill("zzzz");
  await expect(page.getByText("没有与“zzzz”匹配的配置")).toBeVisible();
});

test("Proxies: loading, an error with Retry, and a search matching nothing", async ({ page }) => {
  await openApp(page);
  await failOnClick(sidebar(page).getByText("Proxies", { exact: true }), { proxy_list: 1 });
  await expect(page.getByText("Couldn’t load proxies")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator("[role='row'][data-proxy-id]").first()).toBeVisible();
  await (await openSearch(page)).fill("zzzz");
  await expect(page.getByText("No proxies match")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.locator("[role='row'][data-proxy-id]").first()).toBeVisible();
});

test("Proxies: loading shows placeholder rows, not 'No proxies yet'", async ({ page }) => {
  await slow(page, { proxy_list: 2500 });
  await openApp(page, { section: "proxies", idle: false });
  await expect(page.locator("[data-loading]")).toBeVisible();
  await expect(page.getByText("No proxies yet")).toHaveCount(0);
});

test("Fingerprints: a load error with Retry", async ({ page }) => {
  await openApp(page);
  await failOnClick(sidebar(page).getByText("Fingerprints", { exact: true }), { fingerprint_list: 1 });
  await expect(page.getByText("Couldn’t load fingerprints")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Couldn’t load fingerprints")).toHaveCount(0);
});

test("Extensions: a search matching nothing says so and offers Clear search; an error offers Retry", async ({ page }) => {
  await fail(page, { extension_list: 1 });
  await openApp(page, { section: "extensions" });
  await expect(page.getByText("Couldn’t load extensions")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await (await openSearch(page)).fill("zzzz");
  await expect(page.getByText("No extensions match")).toBeVisible();
  await expect(page.getByText("Paste a Web Store link")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByText("No extensions match")).toHaveCount(0);
});

test("Bookmarks: a search matching nothing is not an empty folder; an error offers Retry", async ({ page }) => {
  await fail(page, { bookmark_list: 1 });
  await openApp(page, { section: "bookmarks" });
  await expect(page.getByText("Couldn’t load bookmarks")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await (await openSearch(page)).fill("zzzz");
  await expect(page.getByText("No bookmarks match")).toBeVisible();
  await expect(page.getByText("Nothing in this folder")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByText("No bookmarks match")).toHaveCount(0);
});

test("Trash: loading is not 'The trash is empty'; an error offers Retry", async ({ page }) => {
  // The list's first load now runs during the engine check (PERF-18), and
  // the tag sweep after it reads the Trash too, racing the page's own read.
  // Not from Profiles: its action cards read the Trash (quietly) when it opens.
  await openApp(page, { section: "bookmarks" });
  await failOnClick(page.locator("aside").getByText("Trash", { exact: true }), { trash_list: 1 });
  await expect(page.getByText("Couldn’t load Trash")).toBeVisible();
  await expect(page.getByText("Trash is empty")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Amazon UK old")).toBeVisible();
});

test("Automation: an error offers Retry", async ({ page }) => {
  // automation_list is also read by the Modules card, which could take the failure.
  await fail(page, { automation_available: 1 });
  await openApp(page, { section: "automation" });
  await expect(page.getByText("Couldn’t load projects")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Couldn’t load projects")).toHaveCount(0);
});

test("coming back to Trash or Automation keeps the list while it refreshes", async ({ page }) => {
  const inFlight = () => page.waitForFunction(() => (window as unknown as { __shardxMock: { pending: number } }).__shardxMock.pending > 0);
  await openApp(page, { section: "trash" });
  await expect(page.getByText("Amazon UK old")).toBeVisible();
  await page.locator("aside [data-nav='automation']").click();
  // The first load's placeholder rows wait 150 ms before they show (WIG-12):
  // wait for the rows themselves, not for the placeholders to go.
  await expect(page.locator("main [role='listitem'][data-row-id]").first()).toBeVisible();
  await expect(page.locator("[data-loading]")).toHaveCount(0);
  // Fix round 1 (controller note on I3): a semantic `data-project-id` now
  // that the row's primary action is a real button, not a styling hook
  // that would drift again with the next visual change.
  const projectRows = await page.locator("main [data-loading], main [role='listitem'][data-row-id]").count();
  await page.evaluate(() => { (window as unknown as { __shardxMockSlow: Record<string, number> }).__shardxMockSlow = { trash_list: 2000, automation_list: 2000 }; });
  // One-shot counts while the refresh is in flight (an auto-retrying check
  // would wait it out).
  await page.locator("aside [data-nav='trash']").click();
  await inFlight();
  await expect(page.getByText("Amazon UK old")).toBeVisible();
  expect(await page.locator("[data-loading]").count()).toBe(0);
  await page.locator("aside [data-nav='automation']").click();
  await inFlight();
  expect(await page.locator("[data-loading]").count()).toBe(0);
  expect(projectRows).toBeGreaterThan(0);
});

test("Trash: the first load shows placeholder rows, not 'The trash is empty'", async ({ page }) => {
  await slow(page, { trash_list: 2500 });
  await openApp(page, { section: "trash", idle: false });
  await expect(page.locator("[data-loading]")).toBeVisible();
  await expect(page.getByText("Trash is empty")).toHaveCount(0);
});

test("while the list loads or fails, the header shows no count", async ({ page }) => {
  await fail(page, { profile_list: 1 });
  await openApp(page);
  await expect(page.getByText("Couldn’t load profiles")).toBeVisible();
  await expect(page.locator("main header [data-count]")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator("main header [data-count]")).toHaveText("8");
});

test("onboarding in progress: while Profiles loads it shows placeholders, and a failure shows Retry", async ({ page }) => {
  // The welcome is answered already: this test is about the list, not about the welcome.
  await page.addInitScript(() => localStorage.setItem("shardx.onboarding", JSON.stringify({ version: 2, state: "active", welcomeDone: true, tour: "done", pagesSeen: [], tipsOff: true })));
  await fail(page, { profile_list: 1 });
  await openApp(page);
  await expect(page.getByText("Couldn’t load profiles")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(rows(page)).toHaveCount(8);
  // The seeded data has profiles: once loaded, the setup finishes.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("shardx.onboarding")!).state)).toBe("done");
});

// Fix round 1 (I3), F26: a bookmark opens its editor from the keyboard. The
// row is the control now (the list's one Tab stop), not a button in its title.
test("a bookmark's row opens its editor from the keyboard", async ({ page }) => {
  await openApp(page, { section: "bookmarks" });
  const row = page.getByRole("treegrid", { name: "Bookmarks" }).locator("[role='row'][data-row-id]", { hasText: "Seller Central" });
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Edit bookmark" })).toBeVisible();
});

// WIG-12: placeholder rows only for a load that takes a while, and then long enough to read.
// The list's own rows, not the ones a lazy page draws while its code is on its
// way (App.tsx SectionLoading, the same LoadingRows). Those are about the code
// arriving, not about the list's first load, and a page in the LOADING map
// (Trash is) draws them on the dev server every time: its chunk takes about a
// second, so they show, and they were what these timings measured.
const watchSkeleton = (page: Page) => page.addInitScript(() => {
  const w = window as unknown as { __skeletonShown?: number; __skeletonGone?: number };
  new MutationObserver(() => {
    const on = [...document.querySelectorAll("[data-loading] [aria-hidden='true']")].some((el) => !el.closest("[data-page-loading]"));
    if (on && w.__skeletonShown === undefined) w.__skeletonShown = performance.now();
    if (!on && w.__skeletonShown !== undefined && w.__skeletonGone === undefined) w.__skeletonGone = performance.now();
  }).observe(document, { childList: true, subtree: true });
});
const skeletonTimes = (page: Page) =>
  page.evaluate(() => { const w = window as unknown as { __skeletonShown?: number; __skeletonGone?: number }; return { shown: w.__skeletonShown, gone: w.__skeletonGone }; });

test("a quick first load shows no placeholder rows at all", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockLatency: number }).__shardxMockLatency = 0; });
  await watchSkeleton(page);
  await openApp(page, { section: "trash" });
  await expect(page.getByText("Amazon UK old")).toBeVisible();
  expect((await skeletonTimes(page)).shown).toBeUndefined();
});

test("a slow first load shows placeholder rows after a moment, and keeps them long enough to read", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shardxMockLatency: number; __shardxMockSlow: Record<string, number> };
    w.__shardxMockLatency = 0;
    w.__shardxMockSlow = { trash_list: 300 };
  });
  await watchSkeleton(page);
  await openApp(page, { section: "trash" });
  await expect(page.getByText("Amazon UK old")).toBeVisible();
  const { shown, gone } = await skeletonTimes(page);
  expect(shown).toBeDefined();
  expect(gone! - shown!).toBeGreaterThanOrEqual(390);
});

// Pair 3 review, Minor 1: the rows' timer and the hold's clock were two
// timers of the same length, and a task could run between them (an IPC
// reply is the likely one). Rows that had shown then went at once. Here a
// 150 ms timer started in the same pass as another one still pending fires
// 200 ms late, which puts the list's answer between the two.
test("placeholder rows that showed stay long enough even when a task runs between their timers", async ({ page }) => {
  // The fixed clock replaces the page's timers: install it first, so the
  // stand-in below wraps it.
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => {
    const w = window as unknown as { __shardxMockLatency: number; __shardxMockSlow: Record<string, number> };
    w.__shardxMockLatency = 0;
    w.__shardxMockSlow = { trash_list: 300 };
    const later = window.setTimeout.bind(window);
    const cancel = window.clearTimeout.bind(window);
    // The pending 150 ms timers started in this pass (StrictMode clears and
    // starts its effects again).
    let pass: Set<number> | null = null;
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
      if (ms !== 150) return later(fn, ms, ...rest);
      if (!pass) { pass = new Set(); queueMicrotask(() => { pass = null; }); }
      const h = later(fn, pass.size > 0 ? ms + 200 : ms, ...rest);
      pass.add(h);
      return h;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((h?: number) => { pass?.delete(h!); cancel(h); }) as typeof window.clearTimeout;
  });
  await watchSkeleton(page);
  await openApp(page, { section: "trash" });
  await expect(page.getByText("Amazon UK old")).toBeVisible();
  const { shown, gone } = await skeletonTimes(page);
  expect(shown).toBeDefined();
  expect(gone! - shown!).toBeGreaterThanOrEqual(390);
});

// Pair 3 review, Minor 2: on a fresh install the empty page took the table's
// place the moment the list came in, and the placeholder rows went with it.
test("a fresh install keeps its placeholder rows long enough before the empty state", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shardxMockLatency: number; __shardxMockSlow: Record<string, number>; __shardxMockEmpty: boolean };
    w.__shardxMockLatency = 0;
    w.__shardxMockSlow = { profile_list: 400 };
    w.__shardxMockEmpty = true;
  });
  await watchSkeleton(page);
  await openApp(page);
  await expect(page.getByText("No profiles yet")).toBeVisible();
  const { shown, gone } = await skeletonTimes(page);
  expect(shown).toBeDefined();
  expect(gone! - shown!).toBeGreaterThanOrEqual(390);
});

// Pair 3 (carried): the header's count read the raw status, so it showed
// beside the placeholder rows while they were held (up to 400 ms after the
// list came in).
test("the header count waits for the placeholder rows to go", async ({ page }) => {
  test.slow();
  for (const [section, cmd] of [
    ["profiles", "profile_list"], ["proxies", "proxy_list"], ["fingerprints", "fingerprint_list"], ["trash", "trash_list"],
    ["extensions", "extension_list"], ["bookmarks", "bookmark_list"],
  ] as const) {
    await page.addInitScript((c) => {
      const w = window as unknown as { __shardxMockLatency: number; __shardxMockSlow: Record<string, number>; __countBeside?: boolean };
      w.__shardxMockLatency = 0;
      w.__shardxMockSlow = { [c]: 300 };
      new MutationObserver(() => {
        if (document.querySelector("[data-loading] [aria-hidden='true']") && document.querySelector("main header [data-count]")) w.__countBeside = true;
      }).observe(document, { childList: true, subtree: true });
    }, cmd);
    await openApp(page, { section });
    await expect(page.locator("main header [data-count]"), section).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __countBeside?: boolean }).__countBeside ?? false), section).toBe(false);
  }
});

