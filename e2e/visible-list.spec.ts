import { expect, test, type Page } from "@playwright/test";
import { appModule, NOW, openApp, row } from "./support/app";
import { openSearch } from "./support/search";

// PERF-04: one cached list for the table, the keys and the selection.
type W = { __profile: { selectVisible: () => unknown }; __before?: unknown };
const rows = (page: Page) => page.locator("[role='row'][data-profile-id]");
const names = (page: Page) => rows(page).locator("[data-cell='name']");
const DAY = 24 * 3600_000;

/// The next minute tick, at `ms` past NOW: the clock jumps there, then a
/// minute of timers runs (the list's minute clock among them).
async function minuteTickAt(page: Page, ms: number) {
  await page.clock.setFixedTime(NOW.getTime() + ms);
  await page.clock.runFor(60_000);
}

/// Counts the renders of the Profiles page around the list, set before load.
/// The page hands its header new props each time it renders, and a render
/// inside it (the list's) leaves them the same object.
async function countPageRenders(page: Page) {
  await page.addInitScript(() => {
    type Fiber = { type: unknown; memoizedProps: unknown; child: Fiber | null; sibling: Fiber | null };
    const w = window as unknown as { __pageRenders: number; __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
    w.__pageRenders = 0;
    let last: unknown;
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      isDisabled: false,
      renderers: new Map(),
      inject: () => 1,
      checkDCE: () => {},
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
        const stack: Fiber[] = [root.current];
        while (stack.length) {
          const f = stack.pop()!;
          // The header's root element (data-region="header"): its props are new
          // exactly when PageHeader renders, and the name survives minification.
          if (f.type === "header" && (f.memoizedProps as Record<string, unknown> | null)?.["data-region"] === "header") {
            if (f.memoizedProps !== last) { w.__pageRenders++; last = f.memoizedProps; }
            return;
          }
          if (f.sibling) stack.push(f.sibling);
          if (f.child) stack.push(f.child);
        }
      },
    };
  });
}
const pageRenders = (page: Page) => page.evaluate(() => (window as unknown as { __pageRenders: number }).__pageRenders);

test("arrow keys and a range reuse the list they already have", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/entities/profile/index.ts", "__profile");
  await rows(page).first().focus();
  await page.evaluate(() => { const w = window as unknown as W; w.__before = w.__profile.selectVisible(); });
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  expect(await page.evaluate(() => { const w = window as unknown as W; return w.__profile.selectVisible() === w.__before; })).toBe(true);
});

test("the filter finds names, notes and tag names, in the list's order", async ({ page }) => {
  await openApp(page);
  const box = await openSearch(page);
  await box.fill("payout"); // Etsy craft shop's notes
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("Etsy craft shop");
  await box.fill("FB ADS");
  await expect(rows(page).locator("[data-cell='name']")).toHaveText(["FB Ads acc-01", "FB Ads acc-02"]);
  await box.fill("");
  await expect(rows(page)).toHaveCount(8);
});

test("the header count follows the list", async ({ page }) => {
  await openApp(page);
  await (await openSearch(page)).fill("fb ads");
  // "2 of 8" while a search narrows the list (F2, CRAFT-18).
  await expect(page.locator("main header [data-count]")).toHaveText("2 of 8");
});

test("the Status order follows a profile that starts: the cached order keys on the running state", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/entities/profile/index.ts", "__profile");
  const order = await page.evaluate(() => {
    type P = { id: string; pinned: boolean; last_launched_at: string | null; folder: string; proxy_id: null; name: string; notes: string };
    const w = window as unknown as { __profile: { computeVisible: (i: unknown) => { ids: string[] }; emptyFilters: () => unknown } };
    const p = (id: string, at: string): P => ({ id, pinned: false, last_launched_at: at, folder: "", proxy_id: null, name: id, notes: "" });
    const base = {
      profiles: [p("a", "2026-08-31T10:00:00Z"), p("b", "2026-08-01T10:00:00Z")],
      proxies: [], search: "", folder: "all", filters: w.__profile.emptyFilters(), sort: "status",
      tags: [], byProfile: {}, now: Date.now(),
    };
    const idle = w.__profile.computeVisible({ ...base, running: {} }).ids;
    // Same list, same order asked for: only the running state changed.
    const started = w.__profile.computeVisible({ ...base, running: { b: Date.now() } }).ids;
    return { idle, started };
  });
  expect(order).toEqual({ idle: ["a", "b"], started: ["b", "a"] });
});

test("the list's cache keeps the answer it used last", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/entities/profile/index.ts", "__profile");
  const kept = await page.evaluate(() => {
    const w = window as unknown as { __profile: { computeVisible: (i: unknown) => unknown; emptyFilters: () => unknown } };
    const base = {
      profiles: [], proxies: [], folder: "all", filters: w.__profile.emptyFilters(), running: {}, sort: "added",
      tags: [], byProfile: {}, now: 0,
    };
    const ask = (search: string) => w.__profile.computeVisible({ ...base, search });
    const a = ask("a");
    ask("b");
    ask("a"); // used again: now the newer of the two
    ask("c"); // a third search pushes out the one used longest ago, "b"
    return ask("a") === a;
  });
  expect(kept).toBe(true);
});

test("an idle minute ticks the rows' clock, not the page around the list", async ({ page }) => {
  await countPageRenders(page);
  await openApp(page);
  // eBay DE buyer started 27 min before NOW (the mock's seed).
  const ebay = row(page, "eBay DE buyer").locator("[data-cell='status']");
  await expect(ebay).toHaveAccessibleName(/Running for 27\smin/);
  const before = await pageRenders(page);
  await minuteTickAt(page, 60_000);
  await expect(ebay).toHaveAccessibleName(/Running for 28\smin/);
  // The order (Added) and the filters do not read the clock: the header,
  // View bar, toolbar and bulk bar do not render again.
  expect(await pageRenders(page)).toBe(before);
});

test("Most run time sorts again on the minute tick as a running session grows", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.profiles.sort", "runtime-desc"));
  await openApp(page);
  // The two pinned rows first; then Scraper pricing's 301 h over eBay DE
  // buyer's 96 h and the 27 min it has been running.
  await expect(names(page).nth(2)).toHaveText("Scraper pricing");
  await expect(names(page).nth(3)).toHaveText("eBay DE buyer");
  // Nine days later eBay DE buyer's total passes Scraper pricing's.
  await minuteTickAt(page, 9 * DAY);
  await expect(names(page).nth(2)).toHaveText("eBay DE buyer");
  await expect(names(page).nth(3)).toHaveText("Scraper pricing");
});

test("the Last run filter reads the clock again on the minute tick", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/entities/profile/index.ts", "__profile");
  await page.evaluate(() => {
    const w = window as unknown as { __profile: { useProfileUi: { getState: () => { setFilters: (f: { lastRun: string }) => void } } } };
    w.__profile.useProfileUi.getState().setFilters({ lastRun: "week" });
  });
  // Every profile but Sandbox, which never ran; TikTok creator last ran 5 days ago.
  await expect(rows(page)).toHaveCount(7);
  await expect(row(page, "TikTok creator")).toHaveCount(1);
  // Two days later its last run is more than a week old.
  await minuteTickAt(page, 2 * DAY);
  await expect(rows(page)).toHaveCount(6);
  await expect(row(page, "TikTok creator")).toHaveCount(0);
});
