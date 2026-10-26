import { expect, test } from "@playwright/test";
import { arrowDown, arrowDownHandler, cpu, createShowsAfterMs, filterTyping, firstRowsMs, idleLongTasks, peekBlankFrames, renameShowsAfterMs, scrollScriptPerFrame, twoThousandByName } from "./support/perf";

// The speed budget (overview section 2; PERF gaps 1 to 9): ArrowDown, filter
// typing, idle, scroll, Assign with 1,000 proxies, the palette's typing, and
// edits and Peek that never wait for the backend. Cmd+K on the first frame
// joins with C1. Checked at full speed with the targets' own numbers, so a
// slower machine still has room; the probe records the 4x numbers for the
// phase reports. 2,000 profiles in name order, the production build of the
// mock (the `perf` project). A number older than merge point 5's measure
// takes that measure as its floor (Pair 63 ruling); beyond that, never raise
// a number here to make a run pass: find the work instead.
const BUDGET = {
  /** ArrowDown's handlers (the key's synchronous work), p50. Target: under 4 ms at 4x. */
  arrowDownHandlerMs: 4,
  /** ArrowDown to the rendered result, p50: inside one 60 Hz frame. */
  arrowDownRenderMs: 16,
  /** Filter keys, of 10, whose next paint came later than one frame. Target: none. */
  filterSlowKeys: 0,
  /** Long tasks (over 50 ms) in 10 s on an idle Profiles page. */
  idleLongTasks: 0,
  /** Script per frame while the list scrolls. Target: under 2 ms at 4x. At
   *  1x the plan's 2 ms is older than merge point 5's 2.6 ms, its floor. */
  scrollScriptMsPerFrame: 2.6,
  /** From Enter to the new name in the row: before the backend answers. */
  renameShowsMs: 50,
  /** From New profile to Peek open on it: before the backend answers. */
  createShowsMs: 100,
  /** Frames that showed Peek without its form, over 10 arrow presses. */
  peekBlankFrames: 0,
  /** Window open (navigation start) to the first Profiles rows painted, ms,
   *  at 1x and 4x (speed lane 2026-10-02): recorded, no target (neither the
   *  plan nor the owner gave one). Speed lane AFTER: see
   *  reports/speed-lane-report.md. */
  firstRowsMs: "recorded",
};

test("ArrowDown: the handler and the next render fit the budget", async ({ page }) => {
  test.setTimeout(120_000);
  await twoThousandByName(page);
  const handler = await arrowDownHandler(page);
  const render = await arrowDown(page);
  expect(handler.p50Ms, JSON.stringify(handler)).toBeLessThan(BUDGET.arrowDownHandlerMs);
  expect(render.p50Ms, JSON.stringify(render)).toBeLessThan(BUDGET.arrowDownRenderMs);
});

test("typing in the filter never waits for the list", async ({ page }) => {
  test.setTimeout(120_000);
  await twoThousandByName(page);
  const typing = await filterTyping(page, "profile 01");
  // A list that never loads or a filter that finds the wrong rows fails here.
  await expect(page.locator("[role='row'][data-profile-id]").first()).toContainText("Profile 01");
  expect(typing.slow, JSON.stringify(typing)).toBeLessThanOrEqual(BUDGET.filterSlowKeys);
});

test("Assign with 1,000 proxies opens within a frame, its list windowed", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => { (window as unknown as { __shardxMockProxies: number }).__shardxMockProxies = 1000; });
  await twoThousandByName(page);
  await page.locator("[role='row'][data-profile-id]").first().locator("[data-cell='checkbox'] input").check({ force: true });
  // Click to the painted frame (Phase D ruling F12: a paint, not a
  // setTimeout(0)). The click runs at the start of a frame, inside a
  // requestAnimationFrame callback, so React's render and the browser's
  // style, layout and paint all land in that frame; the time ends in the
  // first task after it. Timing to the next callback instead would add the
  // idle wait for the next vsync (0 to 16.7 ms) to every sample.
  const clickToFrame = (name: string) => page.evaluate((name) => new Promise<number>((resolve) => {
    const re = new RegExp(name);
    requestAnimationFrame(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => re.test(b.textContent ?? ""))!;
      const t0 = performance.now();
      button.click();
      setTimeout(() => resolve(performance.now() - t0), 0);
    });
  }), name);
  const open = await clickToFrame("^Change proxy");
  const dialog = page.getByRole("dialog", { name: /Assign/ });
  await expect(dialog).toBeVisible();
  // One dialog, no Spread switch (F12): the proxies list is there at once.
  await expect(dialog.getByRole("option").first()).toBeVisible();
  expect(await dialog.getByRole("option").count()).toBeLessThanOrEqual(40);
  expect(open, "open").toBeLessThan(16);
});

test("the palette follows typing inside a frame with 2,000 profiles", async ({ page }) => {
  test.setTimeout(120_000);
  await twoThousandByName(page);
  await page.keyboard.press("ControlOrMeta+k");
  const field = page.getByRole("combobox", { name: "Search commands" });
  await expect(field).toBeFocused();
  const slow = await field.evaluate(async (el: HTMLInputElement) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    let over = 0;
    for (const ch of "profile 01") {
      const t0 = performance.now();
      set.call(el, el.value + ch);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (performance.now() - t0 > 2 * 16.7) over++;
    }
    return over;
  });
  // At most two of ten keys may take longer than the next frame (the filter's budget, D Task 2).
  expect(slow).toBeLessThanOrEqual(2);
});

test("an idle Profiles page does no work", async ({ page }) => {
  test.setTimeout(120_000);
  await twoThousandByName(page);
  const idle = await idleLongTasks(page, 10_000);
  expect(idle.count, JSON.stringify(idle)).toBeLessThanOrEqual(BUDGET.idleLongTasks);
});

test("scrolling 2,000 profiles fits the script budget", async ({ page }) => {
  test.setTimeout(120_000);
  await twoThousandByName(page);
  const cdp = await cpu(page, 1);
  expect(await scrollScriptPerFrame(page, cdp)).toBeLessThan(BUDGET.scrollScriptMsPerFrame);
});

test("edits and Peek never wait for the backend", async ({ page }) => {
  test.setTimeout(180_000);
  await twoThousandByName(page);
  expect(await peekBlankFrames(page), "Peek frames without a form").toBeLessThanOrEqual(BUDGET.peekBlankFrames);
  expect(await renameShowsAfterMs(page), "rename").toBeLessThan(BUDGET.renameShowsMs);
  expect(await createShowsAfterMs(page), "create").toBeLessThan(BUDGET.createShowsMs);
});

test("startup: the first rows paint, and how soon is recorded", async ({ page }) => {
  test.setTimeout(180_000);
  await twoThousandByName(page);
  const ms = { "1x": await firstRowsMs(page, 1), "4x": await firstRowsMs(page, 4) };
  // Recorded, not judged (BUDGET.firstRowsMs): a list that never paints fails here.
  test.info().annotations.push({ type: "firstRowsMs", description: JSON.stringify(ms) });
  console.log("firstRowsMs", JSON.stringify(ms));
  expect(ms["1x"]).toBeGreaterThan(0);
  expect(ms["4x"]).toBeGreaterThan(0);
});
