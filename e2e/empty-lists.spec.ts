import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { openSearch } from "./support/search";

// Owner feedback (2026-09-26): an empty list shows no column header, and its
// state is centered on the list's own visible area, not on the (possibly
// wider) content wrapper. Centered multi-line text never leaves a one-word
// orphan line (`text-balance` in the kit's EmptyState).

const sidebar = (page: Page) => page.locator("aside nav");
const setMock = (page: Page, knobs: Record<string, unknown>) =>
  page.addInitScript((k) => { Object.assign(window, k); }, knobs);

/** The container's client box (content box: border and scrollbar excluded),
 *  in viewport pixels. */
async function clientBox(loc: Locator) {
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      left: r.left + parseFloat(cs.borderLeftWidth || "0"),
      top: r.top + parseFloat(cs.borderTopWidth || "0"),
      width: el.clientWidth,
      height: el.clientHeight,
    };
  });
}

/** The empty/no-match/error state's bounding box center is within 2 px of
 *  `container`'s visible client box center, on both axes, and the state sits
 *  fully inside that box (so it is visible without scrolling to see it). */
async function assertCentered(container: Locator, state: Locator) {
  const box = await clientBox(container);
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const s = await state.boundingBox();
  if (!s) throw new Error("empty state has no bounding box (not rendered?)");
  const sx = s.x + s.width / 2;
  const sy = s.y + s.height / 2;
  expect(Math.abs(sx - cx)).toBeLessThanOrEqual(2);
  expect(Math.abs(sy - cy)).toBeLessThanOrEqual(2);
  // Fully inside the visible box: never needs horizontal (or vertical)
  // scrolling of the container to be seen.
  expect(s.x).toBeGreaterThanOrEqual(box.left - 0.5);
  expect(s.y).toBeGreaterThanOrEqual(box.top - 0.5);
  expect(s.x + s.width).toBeLessThanOrEqual(box.left + box.width + 0.5);
  expect(s.y + s.height).toBeLessThanOrEqual(box.top + box.height + 0.5);
}

/** A centered block's text never leaves a lone-word orphan on its last
 *  line: with 2+ lines, the last line is at least half the widest line's
 *  width. Reads real line boxes (`getClientRects`), not CSS class names.
 *  A hint that fits on one line trivially has no orphan to leave, so that's
 *  fine too — UNLESS `minLines` says the caller expects it to wrap (fix
 *  round 1, M9): owner O1's 13px body text left the Proxies hint fitting on
 *  one line at the default width, which made that one test vacuous; a copy
 *  change could quietly do the same to the Profiles one, so both now pin
 *  down how many lines they expect. */
async function assertBalancedText(el: Locator, { minLines = 1 }: { minLines?: number } = {}) {
  const widths = await el.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rows = new Map<number, number>();
    for (const r of Array.from(range.getClientRects())) {
      const top = Math.round(r.top);
      rows.set(top, Math.max(rows.get(top) ?? 0, r.width));
    }
    return Array.from(rows.values());
  });
  expect(widths.length).toBeGreaterThanOrEqual(minLines);
  if (widths.length < 2) return;
  const widest = Math.max(...widths);
  const last = widths[widths.length - 1];
  expect(last).toBeGreaterThanOrEqual(widest * 0.5);
}

test("Profiles: an empty Folder shows no column header, and its state is centered", async ({ page }) => {
  await page.addInitScript(() => { if (localStorage.getItem("shardx-folders") === null) localStorage.setItem("shardx-folders", JSON.stringify(["Empty1"])); });
  await openApp(page);
  await sidebar(page).locator("[data-folder='Empty1']").click();
  const list = page.locator("[aria-label='Profiles']");
  await expect(page.getByText("No profiles in Empty1")).toBeVisible();
  await expect(list.getByRole("columnheader")).toHaveCount(0);
  await assertCentered(list, list.locator("[data-empty-state]"));
});

test("Profiles: a filter with no match shows no column header, and its state is centered", async ({ page }) => {
  await openApp(page);
  await (await openSearch(page)).fill("zzzz");
  const list = page.locator("[aria-label='Profiles']");
  await expect(page.getByText("No profiles match")).toBeVisible();
  await expect(list.getByRole("columnheader")).toHaveCount(0);
  await assertCentered(list, list.locator("[data-empty-state]"));
});

test("Profiles: a fresh install shows no column header, and its state is centered", async ({ page }) => {
  await setMock(page, { __shardxMockEmpty: true });
  // Past onboarding (finished elsewhere, or an install too old to have it):
  // the list's own empty state shows.
  await page.addInitScript(() => localStorage.setItem("shardx.onboarding", JSON.stringify({ version: 2, state: "done", welcomeDone: true, tour: "done", pagesSeen: [], tipsOff: true })));
  await openApp(page);
  const list = page.locator("[aria-label='Profiles']");
  await expect(page.getByText("No profiles yet")).toBeVisible();
  await expect(list.getByRole("columnheader")).toHaveCount(0);
  await assertCentered(list, list.locator("[data-empty-state]"));
});

// Owner feedback 5o (2026-09-26): "remove border from those empty states
// icons" (screenshot: the Bookmarks icon tile's violet outline). The kit
// EmptyState's icon tile keeps its tint and radius but drops the ring
// (Tailwind rings render as a box-shadow), in both themes.
for (const theme of ["light", "dark"] as const) {
  test(`Profiles: the empty-state icon tile has no ring, ${theme} theme`, async ({ page }) => {
    await setMock(page, { __shardxMockEmpty: true });
    await page.addInitScript(() => localStorage.setItem("shardx.onboarding", JSON.stringify({ version: 2, state: "done", welcomeDone: true, tour: "done", pagesSeen: [], tipsOff: true })));
    await openApp(page, { theme });
    const tile = page.locator("[aria-label='Profiles'] [data-empty-state] > div").first();
    await expect(tile).toBeVisible();
    await expect(tile).toHaveCSS("box-shadow", "none");
  });
}

test("Proxies: no proxies shows no column header, and its state is centered", async ({ page }) => {
  await setMock(page, { __shardxMockEmpty: true });
  await openApp(page, { section: "proxies" });
  const list = page.locator("[aria-label='Proxies']");
  await expect(page.getByText("No proxies yet")).toBeVisible();
  await expect(list.getByRole("columnheader")).toHaveCount(0);
  await assertCentered(list, list.locator("[data-empty-state]"));
});

test("Trash: nothing in it shows no column header, and its state is centered", async ({ page }) => {
  await setMock(page, { __shardxMockEmpty: true });
  await openApp(page, { section: "trash" });
  await expect(page.getByText("Trash is empty")).toBeVisible();
  const region = page.getByRole("region", { name: "Trash" });
  // The Trash is a DataList treegrid (F25a): empty, it draws no header row
  // at all, and none of its column labels show.
  await expect(region.getByRole("columnheader")).toHaveCount(0);
  for (const label of ["Name", "Folder", "Deleted", "Size"]) {
    await expect(region.getByText(label, { exact: true })).toHaveCount(0);
  }
  await assertCentered(region, region.locator("[data-empty-state]"));
});

test("Profiles: an empty Folder centers at a wide window, where the table's min-width is narrower than the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 1117 });
  await page.addInitScript(() => { if (localStorage.getItem("shardx-folders") === null) localStorage.setItem("shardx-folders", JSON.stringify(["Empty1"])); });
  await openApp(page);
  await sidebar(page).locator("[data-folder='Empty1']").click();
  const list = page.locator("[aria-label='Profiles']");
  await expect(page.getByText("No profiles in Empty1")).toBeVisible();
  await assertCentered(list, list.locator("[data-empty-state]"));
});

test("Profiles: an empty Folder centers at a narrow window, where the table's min-width exceeds the viewport", async ({ page }) => {
  // Every chosen column stays (owner decision 2026-09-26): at 600 px the
  // list's min-width exceeds the visible area, and the list scrolls inside
  // its card.
  await page.setViewportSize({ width: 600, height: 700 });
  await page.addInitScript(() => { if (localStorage.getItem("shardx-folders") === null) localStorage.setItem("shardx-folders", JSON.stringify(["Empty1"])); });
  await openApp(page);
  await sidebar(page).locator("[data-folder='Empty1']").click();
  const list = page.locator("[aria-label='Profiles']");
  await expect(page.getByText("No profiles in Empty1")).toBeVisible();
  // The table's content is wider than the viewport (min-width kicks in),
  // yet the state sits centered on the visible area and needs no scroll.
  const listWidth = (await clientBox(list)).width;
  const contentWidth = await list.locator("[style*='min-width']").first().evaluate((el) => el.scrollWidth);
  expect(contentWidth).toBeGreaterThan(listWidth);
  await assertCentered(list, list.locator("[data-empty-state]"));
});

test("Profiles: a list with rows still shows its column header", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("All profiles");
  await expect(page.getByRole("columnheader")).not.toHaveCount(0);
});

test("Proxies: the empty hint's text is balanced (no lone-word last line)", async ({ page }) => {
  await setMock(page, { __shardxMockEmpty: true });
  await openApp(page, { section: "proxies" });
  const hint = page.locator("[data-empty-state] p", { hasText: "Add a SOCKS5" });
  await expect(hint).toBeVisible();
  // Fix round 1 (M9): at 13px this hint now fits on one line inside the
  // kit's own max-w-[420px], which let the test pass vacuously. Force the
  // wrap the check actually needs, on the real element.
  await hint.evaluate((el) => { el.style.maxWidth = "280px"; });
  await assertBalancedText(hint, { minLines: 2 });
});

test("Profiles: the empty-Folder hint's text is balanced (no lone-word last line)", async ({ page }) => {
  await page.addInitScript(() => { if (localStorage.getItem("shardx-folders") === null) localStorage.setItem("shardx-folders", JSON.stringify(["Empty1"])); });
  await openApp(page);
  await sidebar(page).locator("[data-folder='Empty1']").click();
  const hint = page.locator("[data-empty-state] p", { hasText: "New profiles made here land in it" });
  await expect(hint).toBeVisible();
  await assertBalancedText(hint, { minLines: 2 });
});
