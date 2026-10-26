import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle } from "./support/app";
import { boxOf, expectApart } from "./support/geometry";

// F2: floating layers belong to the column they act on (LAYOUT-02). Task 10 appends.
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const bar = (page: Page) => page.locator("[data-bulk-bar]");
const peek = (page: Page) => page.locator("aside[data-peek]");
async function select(page: Page, ...names: string[]) {
  for (const n of names) await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
}

for (const [w, h] of [[1280, 800], [1024, 680]] as const) {
  test(`at ${w} x ${h} the bar sits in the list's own space, never on Peek`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openApp(page);
    await select(page, "Etsy craft shop", "FB Ads acc-01", "Sandbox");
    await row(page, "Sandbox").locator("[data-cell='name']").click();
    await expect(peek(page)).toBeVisible();
    await expect(bar(page)).toBeVisible();
    await expectApart(bar(page), peek(page));
    const list = await boxOf(page.locator("[data-list-column]"));
    const b = await boxOf(bar(page));
    expect(b.x).toBeGreaterThanOrEqual(list.x);
    // Its buttons fit inside it: nothing spills out onto Peek.
    expect(await bar(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}

test("the last rows scroll up above the bar (LAYOUT-02)", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __shardxMockProfiles: 60 }));
  await openApp(page);
  await select(page, "Sandbox");
  const grid = page.locator("[data-list-column] [aria-label='Profiles']").first();
  await grid.evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); });
  const last = page.locator("[role='row'][data-profile-id]").last();
  expect((await boxOf(last)).y + 36).toBeLessThanOrEqual((await boxOf(bar(page))).y);
});

test("arrowing down never leaves the focused row under the bar (A11Y-15)", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __shardxMockProfiles: 60 }));
  await openApp(page);
  await select(page, "Sandbox");
  await row(page, "Amazon US seller").focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowDown");
  const active = page.locator("[role='row'][data-active]");
  expect((await boxOf(active)).y + 36).toBeLessThanOrEqual((await boxOf(bar(page))).y);
});

test("in a narrow column the bar's longer buttons fold to icons", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page);
  await select(page, "Etsy craft shop", "Sandbox");
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  const move = bar(page).getByRole("button", { name: "Move to folder" });
  await expect(move).toBeVisible();
  await expect(move).not.toContainText("Move");
});

test("arrow keys move along the bar; closing it with focus inside keeps focus in the list (PC-036)", async ({ page }) => {
  await openApp(page);
  // One idle and one running (the mock's eBay DE buyer): Start and Stop both
  // act, so neither is disabled with its reason.
  await select(page, "Etsy craft shop", "eBay DE buyer");
  const first = bar(page).getByRole("button").first();
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(bar(page).getByRole("button").nth(1)).toBeFocused();
  await bar(page).getByRole("button", { name: "Clear selection" }).focus();
  await page.keyboard.press("Enter");
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator("[role='row'][data-profile-id]:focus")).toHaveCount(1);
});

test("the Proxies bar keeps off Proxy Peek too", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const prow = (name: string) => page.locator("[role='row'][data-proxy-id]", { hasText: name });
  await prow("DC Tokyo").locator("[data-cell='checkbox'] input").check({ force: true });
  await prow("DC Tokyo").locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek='proxy']")).toBeVisible();
  await expectApart(bar(page), page.locator("aside[data-peek='proxy']"));
});

const toast = (page: Page) => page.locator("[data-toast]").first();
const say = (page: Page, text: string) =>
  page.evaluate((t) => (window as unknown as { __shardxToast: { ok: (s: string) => void } }).__shardxToast.ok(t), text);

for (const [w, h] of [[1280, 800], [1024, 680]] as const) {
  test(`at ${w} x ${h} a toast sits above the bar, off Peek (ruling 11)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openApp(page);
    await select(page, "Etsy craft shop", "Sandbox");
    await row(page, "Sandbox").locator("[data-cell='name']").click();
    await say(page, "Saved");
    await expect(toast(page)).toBeVisible();
    await expectApart(toast(page), peek(page));
    await expectApart(toast(page), bar(page));
    expect((await boxOf(toast(page))).y + (await boxOf(toast(page))).height).toBeLessThanOrEqual((await boxOf(bar(page))).y);
  });
}

test("with no selection a toast centers on the list column's visible part", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  await say(page, "Saved");
  const t = await boxOf(toast(page));
  const col = await boxOf(page.locator("[data-toast-anchor]"));
  expect(Math.abs(t.x + t.width / 2 - (col.x + col.width / 2))).toBeLessThanOrEqual(2);
  await expectApart(toast(page), peek(page));
});

test("on a page without a list a toast centers on the page", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await say(page, "Saved");
  const t = await boxOf(toast(page));
  const main = await boxOf(page.locator("main"));
  expect(Math.abs(t.x + t.width / 2 - (main.x + main.width / 2))).toBeLessThanOrEqual(2);
});

test("a lasting error never covers the bar's Tags popover, and a press on it keeps the popover open (Pair 14 review)", async ({ page }) => {
  const names = ["Warm-up", "VIP", "Payout", "Ads", "Shop"];
  await page.addInitScript((tags) => localStorage.setItem("shardx.tags", JSON.stringify({ version: 1, tags, byProfile: {} })),
    names.map((name, i) => ({ id: `t-${i}`, name, color: "orange" })));
  await openApp(page);
  const idle = page.locator("[role='row'][data-profile-id]").filter({ hasNot: page.getByRole("button", { name: "Stop" }) });
  for (const i of [0, 1, 2]) await idle.nth(i).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.evaluate(() => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = { launch: 1 }; });
  await bar(page).getByRole("button", { name: "Start" }).click();
  const error = page.locator("[data-toast]").filter({ hasText: "1 failed" });
  await expect(error).toBeVisible({ timeout: 10000 });
  await bar(page).getByRole("button", { name: "Edit tags" }).click();
  const picker = page.getByRole("dialog", { name: "Tags" });
  await expect(picker.getByRole("option").first()).toBeVisible();
  // Every tag row answers a press at its start, middle and end.
  const covered = await picker.evaluate((pop) =>
    [...pop.querySelectorAll("[role='option']")].flatMap((li) => {
      const r = li.getBoundingClientRect();
      return [r.left + 4, r.left + r.width / 2, r.right - 4]
        .map((x) => document.elementFromPoint(x, r.top + r.height / 2))
        .filter((hit) => !pop.contains(hit));
    }).length);
  expect(covered).toBe(0);
  // The stack and the popover do not meet, or the popover is on top.
  await expect(error).toBeVisible();
  // A press on the toast is not a press outside the popover.
  const box = await boxOf(error);
  const pop = await boxOf(picker);
  const spot = box.x + 8 < pop.x ? { x: 8, y: 8 } : { x: box.width - 8, y: 8 };
  await error.click({ position: spot });
  await expect(picker).toBeVisible();
});

test("the list can scroll its last row clear of a lasting error (Pair 14 review)", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __shardxMockProfiles: 60 }));
  await openApp(page);
  await page.evaluate(() => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = { launch: 1 }; });
  await row(page, "Sandbox").hover();
  await row(page, "Sandbox").getByRole("button", { name: "Start" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn’t start “Sandbox”" })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  const grid = page.locator("[data-list-column] [aria-label='Profiles']").first();
  await grid.evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); });
  // The scroll is synthetic: wait until the last rendered row is the list's
  // last profile (its row index is the grid's row count), or the check below
  // would measure some middle row and pass for nothing.
  const lastRow = page.locator("[role='row'][data-profile-id]").last();
  const count = Number(await grid.getAttribute("aria-rowcount"));
  expect(count).toBeGreaterThan(60);
  await expect(lastRow).toHaveAttribute("aria-rowindex", String(count));
  const last = await boxOf(lastRow);
  const stack = await boxOf(page.getByRole("region", { name: "Notifications" }));
  expect(last.y + last.height).toBeLessThanOrEqual(stack.y);
});

test("a toast action that opens a dialog closes the open menu; the other toasts stay pressable (Pair 17 review)", async ({ page }) => {
  await openApp(page);
  // FB Ads acc-02's proxy goes: its Start is refused with "Assign a proxy".
  await page.evaluate(() => (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("proxy_delete", { id: "px-jp-1" }));
  await page.reload();
  await waitForIdle(page);
  await page.evaluate(() => (window as unknown as { __shardxToast: { err: (s: string) => void } }).__shardxToast.err("Sync failed"));
  await row(page, "FB Ads acc-02").hover();
  await row(page, "FB Ads acc-02").getByRole("button", { name: "Start" }).click();
  const refused = page.locator("[data-toast]").filter({ hasText: "its proxy was deleted" });
  await expect(refused).toBeVisible();
  await select(page, "Etsy craft shop");
  await bar(page).getByRole("button", { name: "More bulk actions" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await refused.getByRole("button", { name: "Assign a proxy" }).click();
  await expect(page.getByRole("dialog", { name: "Assign a proxy" })).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
  // The toast left up is above the dialog's backdrop: a press at its center reaches it.
  const other = page.locator("[data-toast]").filter({ hasText: "Sync failed" });
  const b = await boxOf(other);
  expect(await other.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), { x: b.x + b.width / 2, y: b.y + b.height / 2 })).toBe(true);
});
