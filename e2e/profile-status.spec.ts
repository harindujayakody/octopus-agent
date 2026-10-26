import { expect, test, type Page } from "@playwright/test";
import { openApp, pressCreate, waitForIdle } from "./support/app";

// Task 5d: a single Status column replaces the status dot column and the
// Last run column. `openApp`'s clock is fixed at NOW = 2026-09-01T12:00:00Z
// (UTC — playwright.config.ts sets timezoneId "UTC"), and the mock seeds
// (src/dev/mock/fixtures.ts) write `last_launched_at` at day-and-hour grain
// (`stamp(daysAgo, 9)`, minute fixed at :12): the exact strings below are
// computed from that, not guessed.
//
// Fix round 1 (controller rulings): relative times are explicit i18n
// templates, not `Intl.RelativeTimeFormat` wording; a run in another year
// drops the day ("Aug 2025", not "Aug 29, 2025"); every status word is
// `text-sub-600` (color lives only in the dot); the dot's slot is reserved
// on every row, so words line up; bucket edges round down (`Math.floor`).

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const statusCell = (page: Page, name: string) => row(page, name).locator("[data-cell='status']");
// The cell's full accessible text (visible word + the sr-only exact detail);
// `[data-status-label]` is just the visible word, for the plain-text checks.
const statusLabel = (page: Page, name: string) => statusCell(page, name).locator("[data-status-label]");
// Live layer (Task 5): the Status cell's pill, and a row by its id.
const pill = (page: Page, name: string) => statusCell(page, name).locator("[data-pill='status']");
const rowEl = (page: Page, id: string) => page.locator(`[role='row'][data-profile-id='${id}']`);
const names = (page: Page) => page.locator("[role='row'][data-profile-id] [data-cell='name']").allTextContents();

// Adds seven profiles at exact ms offsets from NOW, one per bucket of the
// relative-time formatter — `stamp`'s day-and-hour grain cannot hit "59 min
// ago" or "23 h ago". See `statusProbes` in fixtures.ts.
async function withStatusProbes(page: Page) {
  await page.addInitScript(() => { (window as unknown as { __shardxMockStatusProbes: boolean }).__shardxMockStatusProbes = true; });
}

test("the header shows Status right after Name, and no Last run or unlabeled status header", async ({ page }) => {
  await openApp(page);
  const headerTexts = await page.locator("[role='row']").first().locator("[role='columnheader']").allTextContents();
  expect(headerTexts).toContain("Status");
  expect(headerTexts.indexOf("Status")).toBe(headerTexts.indexOf("Name") + 1);
  await expect(page.getByRole("columnheader", { name: "Last run" })).toHaveCount(0);
  // The old status dot's columnheader carried its "Status" name only as an
  // aria-label, on an empty cell; now it is the visible text of a real cell.
  await expect(page.getByRole("columnheader", { name: "Status" })).toHaveText("Status");
  await expect(page.getByRole("columnheader", { name: "Status" })).toHaveCount(1);
});

test("a running profile's pill says Running in the success text on its tint", async ({ page }) => {
  await openApp(page);
  // Live layer (spec 4.2): color means state, as a tinted pill; the word
  // still carries it (the dot is decoration).
  await expect(statusLabel(page, "Amazon US seller")).toHaveText("Running");
  const probe = (cls: string, prop: "color" | "backgroundColor") => page.evaluate(([cls, prop]) => {
    const el = document.createElement("span");
    el.className = cls;
    document.body.appendChild(el);
    const value = getComputedStyle(el)[prop as "color"];
    el.remove();
    return value;
  }, [cls, prop]);
  const pillEl = statusCell(page, "Amazon US seller").locator("[data-pill='status']");
  await expect(pillEl).toHaveCSS("color", await probe("text-success-text", "color"));
  await expect(pillEl).toHaveCSS("background-color", await probe("bg-success-tint", "backgroundColor"));
});

test("a profile last run earlier today shows an hours-ago string computed from the mock's stamp, floored", async ({ page }) => {
  await openApp(page);
  // Scraper pricing: launchedDaysAgo 0, hour 9 (`stamp(0, 9)`) => 09:12 UTC.
  // NOW is 12:00 UTC: 2 h 48 m elapsed. Floored, that's "2 h ago" (a round
  // formatter would say "3 h ago" a bucket early).
  await expect(statusLabel(page, "Scraper pricing")).toHaveText("2 h ago");
});

test("a profile last run yesterday shows Yesterday", async ({ page }) => {
  await openApp(page);
  // FB Ads acc-01: launchedDaysAgo 1 (Aug 31), a previous calendar day.
  await expect(statusLabel(page, "FB Ads acc-01")).toHaveText("Yesterday");
});

test("a never-run profile shows Never run", async ({ page }) => {
  await openApp(page);
  await expect(statusLabel(page, "Sandbox")).toHaveText("Never run");
});

test("the exact date and time of a last run is exposed to screen readers (accessible name) and on hover", async ({ page }) => {
  await openApp(page);
  const cell = statusCell(page, "Scraper pricing");
  // Accessible name: the visible word plus the sr-only exact detail, read
  // without ever "opening" a tooltip (an `aria-label` on a plain span has no
  // naming effect in ARIA, and VoiceOver ignores it — this is real text).
  await expect(cell).toHaveAccessibleName(/2 h ago\s+September 1, 2026 at 9:12 AM/);
  // Hover: the same detail, in the row's own tooltip.
  await statusLabel(page, "Scraper pricing").hover();
  await expect(page.getByRole("tooltip")).toHaveText("September 1, 2026 at 9:12 AM");
});

test("a running profile's hover and accessible name say how long, from the session start the old dot's tooltip used", async ({ page }) => {
  await openApp(page);
  // Amazon US seller: the mock starts it 2 h 14 min before NOW.
  const cell = statusCell(page, "Amazon US seller");
  await expect(cell).toHaveAccessibleName(
    /Show the window of Amazon US seller\s+Running for 2\sh 14\smin/);
  await statusLabel(page, "Amazon US seller").hover();
  await expect(page.getByRole("tooltip")).toHaveText("Running for 2 h 14 min");
  // eBay DE buyer: started 27 min before NOW — under an hour, no "0 h".
  await expect(statusCell(page, "eBay DE buyer")).toHaveAccessibleName(/Running for 27\smin/);
});

test("the relative-time formatter's boundaries, and the another-year fallback drops the day", async ({ page }) => {
  await withStatusProbes(page);
  await openApp(page);
  await expect(statusLabel(page, "Status probe just now")).toHaveText("Just now");
  await expect(statusLabel(page, "Status probe minutes")).toHaveText("59 min ago");
  await expect(statusLabel(page, "Status probe hours")).toHaveText("23 h ago");
  await expect(statusLabel(page, "Status probe yesterday")).toHaveText("Yesterday");
  await expect(statusLabel(page, "Status probe six days")).toHaveText("6 days ago");
  await expect(statusLabel(page, "Status probe same year")).toHaveText("Aug 12");
  // Another year: month and year only, no day — the controller's ruling.
  await expect(statusLabel(page, "Status probe other year")).toHaveText("Aug 2025");
});

test("the Status word starts at the same x whether or not the row has a colored dot", async ({ page }) => {
  await openApp(page);
  // Amazon US seller is running (a colored dot); Sandbox never ran (no
  // colored dot) — the dot's slot is reserved on every row regardless, so
  // both words start at the same x.
  const runningX = (await statusLabel(page, "Amazon US seller").boundingBox())!.x;
  const neverX = (await statusLabel(page, "Sandbox").boundingBox())!.x;
  expect(Math.abs(runningX - neverX)).toBeLessThanOrEqual(0.5);
});

/** The Status column holds its widest pill whole: the pill inside the
 *  cell, its word not cut (Status never truncates). Its own width is 96 px;
 *  with room to spare it stretches with the row (owner, 2026-10-23). */
async function fitsWhole(page: Page, name: string, lang = "en") {
  const cell = statusCell(page, name);
  const cellWidth = await cell.evaluate((el) => el.clientWidth);
  const template = await page.locator("[role='row'][aria-rowindex='1']").evaluate((el) => (el as HTMLElement).style.gridTemplateColumns);
  expect(/--col-status,\s*(?:minmax\()?(\d+)px/.exec(template)?.[1], `column width for ${name} (${lang})`).toBe("96");
  expect(cellWidth, `column width for ${name} (${lang})`).toBeGreaterThanOrEqual(96);
  const pillWidth = (await cell.locator("[data-pill='status']").boundingBox())!.width;
  expect(pillWidth, `the pill of ${name} (${lang})`).toBeLessThanOrEqual(cellWidth);
  const [scroll, client] = await statusLabel(page, name).evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(scroll, `"${await statusLabel(page, name).textContent()}" (${name}, ${lang}) is not cut`).toBeLessThanOrEqual(client);
}

test("the widest en and zh Status values fit the column without truncating", async ({ page }) => {
  await withStatusProbes(page);
  await openApp(page);
  for (const name of ["Status probe minutes", "Status probe hours", "Status probe six days", "Status probe other year", "Sandbox"]) {
    await fitsWhole(page, name);
  }
});

test("the widest pill, Proxy missing, fits whole", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("proxy_delete", { id: "px-jp-1" }));
  await page.reload();
  await waitForIdle(page);
  await expect(pill(page, "FB Ads acc-02")).toHaveText("Proxy missing");
  await fitsWhole(page, "FB Ads acc-02");
});

test("Display > Order > Status puts running profiles first and Sandbox last among unpinned rows", async ({ page }) => {
  await withStatusProbes(page);
  await openApp(page);
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("dialog", { name: "Display" }).getByRole("combobox", { name: "Order" }).click();
  await page.getByRole("option", { name: "Status", exact: true }).click();
  await page.keyboard.press("Escape");
  // Amazon US seller and FB Ads acc-01 are the only pinned rows and always
  // paint first, in their own group; the rest is what this test is about.
  const unpinned = (await names(page)).slice(2);
  expect(unpinned[0]).toBe("eBay DE buyer");
  expect(unpinned[unpinned.length - 1]).toBe("Sandbox");
});

test("a stored column set and View with the removed Last run key still load, showing Status", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("shardx.profiles.columns", JSON.stringify({ folder: true, tags: true, notes: true, lastRun: false }));
    localStorage.setItem(
      "shardx.views",
      JSON.stringify({
        version: 1,
        views: [{
          id: "v-old-columns",
          name: "Old view",
          pinned: true,
          query: {
            folder: "all",
            filters: { status: "all", country: "", proxy: "all", tag: "", lastRun: "any" },
            sort: "added",
            columns: { folder: true, tags: true, notes: true, lastRun: false },
          },
        }],
      }),
    );
  });
  await openApp(page);
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
  await expect(row(page, "Amazon US seller")).toBeVisible();
  await page.locator("aside nav").getByText("Old view", { exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
});

test("Chinese: the header reads 状态, a never-run row reads 从未运行, and the widest values fit", async ({ page }) => {
  await withStatusProbes(page);
  await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
  await openApp(page);
  await expect(page.getByRole("columnheader", { name: "状态" })).toBeVisible();
  await expect(statusLabel(page, "Sandbox")).toHaveText("从未运行");
  await expect(statusLabel(page, "Status probe minutes")).toHaveText("59分钟前");
  await expect(statusLabel(page, "Status probe hours")).toHaveText("23小时前");
  await expect(statusLabel(page, "Status probe six days")).toHaveText("6天前");
  await expect(statusLabel(page, "Status probe other year")).toHaveText("2025年8月");
  // The running-row hover/accessible-name detail, in Chinese too.
  await expect(statusCell(page, "Amazon US seller")).toHaveAccessibleName(/已运行 2\s小时 14\s分钟/);
  for (const name of ["Status probe minutes", "Status probe hours", "Status probe six days", "Status probe other year", "Sandbox"]) {
    await fitsWhole(page, name, "zh");
  }
});

// Live layer, Task 5: the Status cell is a pill; a start from this window
// flashes the row once and swells the halo once; a pinned row carries the
// faint accent tint; a new or restored row slides in.


/** Logs each time the row gains `row-flash` (with its tint layer: the
 *  animation it runs, and whether it lies over the pinned cells) and its
 *  Running dot gains `animate-halo-once`. */
async function watchStart(page: Page, id: string) {
  await page.evaluate((id) => {
    const w = window as unknown as { __startLog: { what: string; pinned?: string[] }[] };
    w.__startLog = [];
    const el = document.querySelector(`[role='row'][data-profile-id='${id}']`)!;
    let had = { flash: false, swell: false };
    new MutationObserver(() => {
      // The flash is a layer of its own, the row's first child (L3 review, N4).
      const host = el.querySelector(":scope > .row-flash");
      const flash = !!host;
      const swell = !!el.querySelector("[data-cell='status'] [data-halo].animate-halo-once");
      if (host && !had.flash) {
        // One layer over the row, above its pinned cells (their fills would hide a tint under them).
        const layer = getComputedStyle(host, "::before");
        const pinZ = Number(getComputedStyle(el.querySelector(".list-pin-check")!).zIndex);
        w.__startLog.push({ what: "flash", pinned: [layer.animationName, Number(getComputedStyle(host).zIndex) > pinZ ? "over pinned cells" : "under"] });
      }
      if (swell && !had.swell) w.__startLog.push({ what: "swell" });
      had = { flash, swell };
    }).observe(el, { attributes: true, attributeFilter: ["class"], subtree: true, childList: true });
  }, id);
}
const startLog = (page: Page) => page.evaluate(() => (window as unknown as { __startLog: { what: string; pinned?: string[] }[] }).__startLog);

test("the Status cell is a pill: Running with the halo dot, Never run with the outline dot", async ({ page }) => {
  await openApp(page);
  await expect(pill(page, "Amazon US seller")).toHaveText("Running");
  await expect(pill(page, "Amazon US seller")).toHaveAttribute("data-state", "running");
  await expect(pill(page, "Amazon US seller").locator("[data-halo]")).toHaveCount(1);
  await expect(pill(page, "Sandbox")).toHaveText("Never run");
  await expect(pill(page, "Sandbox").locator("[data-tone='outline']")).toHaveCount(1);
  // The hover detail and its screen-reader copy stay with the pill. A running
  // profile's pill is also the button that raises its window, so its own name
  // comes first in the cell's.
  await expect(statusCell(page, "Amazon US seller")).toHaveAccessibleName(
    /Show the window of Amazon US seller\s+Running for 2\sh 14\smin/);
});

test.describe("with motion on", () => {
  test.use({ reducedMotion: "no-preference" });

  test("a start from this window flashes the row once, its pinned cells too, and swells the halo once", async ({ page }) => {
    await openApp(page);
    await watchStart(page, "c31d92f1");
    await row(page, "FB Ads acc-02").hover();
    await row(page, "FB Ads acc-02").getByRole("button", { name: "Start" }).click();
    await expect(pill(page, "FB Ads acc-02")).toHaveText("Running");
    // Each plays once and is taken off after, so a row that mounts again never replays it.
    await expect(rowEl(page, "c31d92f1").locator(".row-flash")).toHaveCount(0);
    await expect(rowEl(page, "c31d92f1").locator("[data-halo]")).not.toHaveClass(/animate-halo-once/);
    const log = await startLog(page);
    expect(log.filter((l) => l.what === "flash")).toEqual([{ what: "flash", pinned: ["row-flash", "over pinned cells"] }]);
    expect(log.filter((l) => l.what === "swell")).toHaveLength(1);
  });

  // Tasks 5-6 review, M1: Reduce motion removes the swell's animation with
  // no end event; the swell must come off then, not replay later.
  test("Reduce motion switched on mid-swell takes the swell off, and switching it off does not replay it", async ({ page }) => {
    await openApp(page);
    // A long swell, so the switch lands inside it.
    await page.evaluate(() => document.documentElement.style.setProperty("--motion-halo", "10s"));
    const dot = rowEl(page, "c31d92f1").locator("[data-cell='status'] [data-halo]");
    await row(page, "FB Ads acc-02").hover();
    await row(page, "FB Ads acc-02").getByRole("button", { name: "Start" }).click();
    await expect(dot).toHaveClass(/animate-halo-once/);
    await page.evaluate(() => { document.documentElement.dataset.reduceMotion = "true"; });
    await expect(dot).not.toHaveClass(/animate-halo-once/);
    await page.evaluate(() => { document.documentElement.dataset.reduceMotion = "false"; });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(dot).not.toHaveClass(/animate-halo-once/);
  });
});

// Tasks 5-6 review, M2: one Running dot everywhere, with its halo.
test("the Running dot has its halo in Peek, the pinned sidebar item and the palette too", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("aside [data-pinned='a78a0eea'] [data-halo]")).toHaveCount(1);
  await row(page, "Amazon US seller").locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek] [data-halo]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("Amazon US");
  await expect(page.getByRole("dialog", { name: "Command palette" }).getByRole("option", { name: /Amazon US seller/ }).first().locator("[data-halo]")).toHaveCount(1);
});

test("Start then Stop within a second ends on the idle label, with no flash left", async ({ page }) => {
  await openApp(page);
  await row(page, "FB Ads acc-02").hover();
  await row(page, "FB Ads acc-02").getByRole("button", { name: "Start" }).click();
  await expect(pill(page, "FB Ads acc-02")).toHaveText("Running");
  await row(page, "FB Ads acc-02").getByRole("button", { name: "Stop" }).click();
  await expect(pill(page, "FB Ads acc-02")).toHaveAttribute("data-state", "idle");
  await expect(pill(page, "FB Ads acc-02")).toHaveText("Just now");
  await expect(rowEl(page, "c31d92f1").locator(".row-flash")).toHaveCount(0);
});

// L3 review N4-N6: the flash is a layer of its own, so a row that arrives
// and starts within its second shows both tints; both lie over the pinned
// cells and under the list's sticky header; and while one lies there, the
// row's soft gray takes the sub gray (4.5:1 at the tint's peak).
test("a started row's flash is its own layer: with a slide-in both show, under the header, and gray text stays readable", async ({ page }) => {
  await openApp(page);
  // Hold every animation where it is once the flash appears, so it stays to be read.
  await page.evaluate(() => {
    new MutationObserver(() => { if (document.querySelector(".row-flash")) document.getAnimations().forEach((a) => a.pause()); })
      .observe(document.body, { subtree: true, childList: true });
  });
  await row(page, "FB Ads acc-02").hover();
  await row(page, "FB Ads acc-02").getByRole("button", { name: "Start" }).click();
  await expect(rowEl(page, "c31d92f1").locator(".row-flash")).toHaveCount(1);
  const layers = await rowEl(page, "c31d92f1").evaluate((el) => {
    const gray = (host: Element, cls: string) => {
      const probe = document.createElement("span");
      probe.className = cls;
      host.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    el.classList.add("slide-in");
    const flash = el.querySelector(".row-flash")!;
    const z = (node: Element) => Number(getComputedStyle(node).zIndex);
    const head = el.closest("[role='treegrid']")!.querySelector("[data-list-header]")!;
    return {
      slide: getComputedStyle(el, "::before").animationName,
      flash: getComputedStyle(flash, "::before").animationName,
      overPinned: z(flash) > z(el.querySelector(".list-pin-check")!),
      underHeader: z(flash) < z(head) && Number(getComputedStyle(el, "::before").zIndex) < z(head),
      softIsSub: gray(el, "text-text-soft-400") === gray(el, "text-text-sub-600"),
      softElsewhere: gray(document.body, "text-text-soft-400") === gray(document.body, "text-text-sub-600"),
    };
  });
  expect(layers).toEqual({ slide: "slide-in-tint", flash: "row-flash", overPinned: true, underHeader: true, softIsSub: true, softElsewhere: false });
});

test("a failed start reads the same in the row, the pinned sidebar item and Peek; a start the poll sees clears it", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockLaunchFails: string[] }).__shardxMockLaunchFails = ["c31d92f0"]; });
  await openApp(page);
  await row(page, "FB Ads acc-01").hover();
  await row(page, "FB Ads acc-01").getByRole("button", { name: "Start" }).click();
  await expect(pill(page, "FB Ads acc-01")).toHaveText("Failed to start");
  await fitsWhole(page, "FB Ads acc-01");
  await expect(page.locator("aside [data-pinned='c31d92f0']")).toContainText("Failed to start");
  await row(page, "FB Ads acc-01").locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek] [data-peek-run-status]")).toHaveText("Failed to start");
  // Started where this window cannot see a launch (the API, another window):
  // the poll's first sight of it running settles the failure.
  type Mock = { __shardxMock: { state: { running: Record<string, { pid: number; started: number }> } } };
  await page.evaluate(() => { (window as unknown as Mock).__shardxMock.state.running.c31d92f0 = { pid: 4242, started: Date.now() }; });
  await expect(pill(page, "FB Ads acc-01")).toHaveText("Running");
  await page.evaluate(() => { delete (window as unknown as Mock).__shardxMock.state.running.c31d92f0; });
  await expect(pill(page, "FB Ads acc-01")).toHaveAttribute("data-state", "idle");
  await expect(pill(page, "FB Ads acc-01")).toHaveText("Yesterday");
});

test("a new profile's row slides in once, its pinned cells tinted too, and an Undo brings a row back the same way", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New profile" }).first().click();
  await pressCreate(page, { wait: false });
  const created = page.locator("[role='row'][data-profile-id]").filter({ has: page.locator("[data-cell='name']").getByText(/^Profile \d+$/) });
  await expect(created).toHaveClass(/slide-in/);
  // Its tint is one layer over the row, above the pinned cells, that
  // animates only opacity (merge point 3: nothing inherited is animated).
  const tint = await created.evaluate((el) => {
    const layer = getComputedStyle(el, "::before");
    const pinZ = Number(getComputedStyle(el.querySelector(".list-pin-check")!).zIndex);
    const props = el.getAnimations({ subtree: true })
      .filter((a) => (a.effect as KeyframeEffect).pseudoElement === "::before")
      .flatMap((a) => (a.effect as KeyframeEffect).getKeyframes().flatMap((k) => Object.keys(k).filter((key) => !["offset", "easing", "composite", "computedOffset"].includes(key))));
    return { name: layer.animationName, over: Number(layer.zIndex) > pinZ, props: [...new Set(props)], easing: layer.animationTimingFunction };
  });
  expect(tint.name).toBe("slide-in-tint");
  expect(tint.over).toBe(true);
  expect(tint.props).toEqual(["opacity"]);
  // The tint decays on ease-in-out, so it reads for its length (Tasks 5-6 review, B-I1).
  expect(tint.easing).toBe("cubic-bezier(0.645, 0.045, 0.355, 1)");
  await expect(created).not.toHaveClass(/slide-in/, { timeout: 1500 });
  await page.keyboard.press("Escape");
  await row(page, "eBay DE buyer").locator("[data-cell='status']").click();
  await page.keyboard.press("Delete");
  await expect(row(page, "eBay DE buyer")).toHaveCount(0);
  await page.locator("[data-toast]").getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "eBay DE buyer")).toHaveClass(/slide-in/);
  await expect(row(page, "eBay DE buyer")).not.toHaveClass(/slide-in/, { timeout: 1500 });
});

// Tasks 5-6 review, M6, as merge point 3 rebuilt the tint: it animates only
// opacity, so an engine without registered properties (WebKit before 16.4)
// fades it like any other, never as a hard block.
test("an engine without registered properties still fades a new row's tint", async ({ page }) => {
  await page.addInitScript(() => { delete (CSS as unknown as { registerProperty?: unknown }).registerProperty; });
  await openApp(page);
  await page.getByRole("button", { name: "New profile" }).first().click();
  await pressCreate(page, { wait: false });
  const created = page.locator("[role='row'][data-profile-id].slide-in");
  await expect(created).toHaveCount(1);
  expect(await created.evaluate((el) => getComputedStyle(el, "::before").animationName)).toBe("slide-in-tint");
});
