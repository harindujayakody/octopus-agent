import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";

// The row model (O5, EMIL-03, IFACE-05): the row under a moving pointer is
// the target; the target is always drawn; the selection is the subject.
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const active = (page: Page) => page.locator("[role='row'][data-profile-id][data-active]");
const peek = (page: Page) => page.locator("aside[data-peek]");
type Launch = { id: string };
const launches = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __shardxMockLaunches?: Launch[] }).__shardxMockLaunches ?? []).map((l) => l.id));
/** A row's painted fill: its color and any overlay laid over it. */
const fill = (page: Page, name: string) =>
  row(page, name).evaluate((el) => `${getComputedStyle(el).backgroundColor} ${getComputedStyle(el).backgroundImage}`);
const pick = (page: Page, name: string) => row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });

test("moving the pointer onto a row makes it the one S acts on, and draws it", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").focus();
  await row(page, "Sandbox").hover();
  await expect(active(page)).toContainText("Sandbox");
  // The keyboard was on a row, so it follows to the new target.
  await expect(row(page, "Sandbox")).toBeFocused();
  await page.keyboard.press("s");
  await expect.poll(() => launches(page)).toContain("f62a9d43");
  expect(await launches(page)).not.toContain("aed41005");
  expect(await fill(page, "Sandbox")).not.toBe(await fill(page, "Scraper pricing"));
});

test("a list that scrolls under a still pointer keeps its target (ruling 7)", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockProfiles: number }).__shardxMockProfiles = 300; });
  await openApp(page);
  const target = row(page, "Profile 0005");
  await target.hover();
  await expect(target).toHaveAttribute("data-active");
  const box = (await target.boundingBox())!;
  await page.mouse.wheel(0, 360); // ten rows scroll under the resting pointer
  await page.waitForTimeout(150);
  await expect(active(page)).toContainText("Profile 0005");
  await page.mouse.move(box.x + 40, box.y + box.height / 2 + 3); // a real move
  await expect(active(page)).not.toContainText("Profile 0005");
});

test("the arrows move the target away from the row under the pointer; only the target is drawn", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").hover();
  await page.keyboard.press("ArrowUp");
  await expect(active(page)).not.toContainText("Sandbox");
  // No hover fill any more: the row under the resting pointer looks like any
  // other row that is not the target, in Peek or selected.
  const plain = await page.locator("[role='row'][data-profile-id]:not([data-active], [data-peek-open], [aria-selected='true'])")
    .filter({ hasNotText: "Sandbox" }).first()
    .evaluate((el) => `${getComputedStyle(el).backgroundColor} ${getComputedStyle(el).backgroundImage}`);
  expect(await fill(page, "Sandbox")).toBe(plain);
});

test("Peek stays on its profile while the pointer picks another target; the two are drawn apart", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").focus();
  await page.keyboard.press("Enter");
  await expect(peek(page)).toHaveAttribute("aria-label", /Etsy craft shop/);
  await row(page, "Sandbox").hover();
  await expect(active(page)).toContainText("Sandbox");
  await expect(peek(page)).toHaveAttribute("aria-label", /Etsy craft shop/);
  // Both wear the hover gray (active equals hover, and the Peek row is marked
  // with the same gray: owner, 2026-10-01), now one opaque token each
  // (`--row-fill`, owner, 2026-10-07), so they no longer differ by how they are
  // painted, only from the rows that are neither.
  const peekRow = await fill(page, "Etsy craft shop");
  const plain = await fill(page, "Scraper pricing");
  expect(peekRow).not.toBe(plain);
  expect(await fill(page, "Sandbox")).not.toBe(plain);
});

test("a selected target is drawn apart from a selected row that is not the target", async ({ page }) => {
  await openApp(page);
  await pick(page, "Etsy craft shop");
  await pick(page, "Sandbox");
  await row(page, "Sandbox").hover();
  await expect(active(page)).toContainText("Sandbox");
  expect(await fill(page, "Sandbox")).not.toBe(await fill(page, "Etsy craft shop"));
  // The same look reaches its pinned cells (select box, Name, row actions):
  // each paints the row's own solid fill, not a layer stack of its own.
  const rowBg = await row(page, "Sandbox").evaluate((el) => getComputedStyle(el).backgroundColor);
  for (const cls of ["list-pin-check", "list-pin-name", "list-pin-end"]) {
    expect(await row(page, "Sandbox").locator(`.${cls}`).evaluate((el) => getComputedStyle(el, "::before").backgroundColor), cls).toBe(rowBg);
  }
});

test("the lists are treegrids whose rows take focus (overview ruling 14)", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("treegrid", { name: "Profiles" })).toBeVisible();
  await expect(row(page, "Sandbox")).toHaveAttribute("aria-level", "1");
  await openApp(page, { section: "proxies" });
  await expect(page.getByRole("treegrid", { name: "Proxies" })).toBeVisible();
  await expect(page.locator("[role='row'][data-proxy-id='px-us-2']")).toHaveAttribute("aria-level", "1");
});

test("on Proxies, the pointer picks the target too", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id='px-us-2']").focus();
  await page.locator("[role='row'][data-proxy-id='px-jp-1']").hover();
  await expect(page.locator("[role='row'][data-proxy-id][data-active]")).toHaveAttribute("data-proxy-id", "px-jp-1");
  await expect(page.locator("[role='row'][data-proxy-id='px-jp-1']")).toBeFocused();
});

// E14 (O5, EMIL-12, WIG-08, EMIL-14): a click opens Peek, Cmd/Ctrl+click
// selects, an edit is deliberate, and a list cell's tooltip only reveals.
test("a click anywhere on a row opens it in Peek; a click on the Peek row keeps it open (O5)", async ({ page }) => {
  await openApp(page);
  // Each click with Peek closed, so the columns sit where they do at rest (an
  // open Peek narrows the list and the row actions cover its last columns).
  // Notes near its left edge: the row actions float over its end.
  await row(page, "Sandbox").locator("[data-cell='notes']").click({ position: { x: 8, y: 18 } });
  await expect(peek(page)).toHaveAttribute("aria-label", /Sandbox/);
  await expect(row(page, "Sandbox").getByRole("textbox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(peek(page)).toHaveCount(0);
  await row(page, "Etsy craft shop").locator("[data-cell='proxy']").click();
  await expect(peek(page)).toHaveAttribute("aria-label", /Etsy craft shop/);
  await expect(page.getByRole("dialog", { name: "Proxy" })).toHaveCount(0);
  await row(page, "Etsy craft shop").locator("[data-cell='status']").click();
  await expect(peek(page)).toHaveAttribute("aria-label", /Etsy craft shop/);
});

test("Cmd/Ctrl+click adds and removes rows; Shift+click extends from it (WIG-08)", async ({ page }) => {
  await openApp(page);
  const selected = page.locator("[role='row'][data-profile-id][aria-selected='true']");
  await row(page, "Etsy craft shop").locator("[data-cell='status']").click({ modifiers: ["ControlOrMeta"] });
  await row(page, "Sandbox").locator("[data-cell='status']").click({ modifiers: ["ControlOrMeta"] });
  await expect(selected).toHaveCount(2);
  await expect(peek(page)).toHaveCount(0);
  await row(page, "Sandbox").locator("[data-cell='status']").click({ modifiers: ["ControlOrMeta"] });
  await expect(selected).toHaveCount(1);
  // A Cmd-click sets the anchor a Shift-click extends from (Finder, Explorer).
  await page.keyboard.press("Escape");
  await row(page, "Etsy craft shop").locator("[data-cell='status']").click({ modifiers: ["ControlOrMeta"] });
  await row(page, "Sandbox").locator("[data-cell='status']").click({ modifiers: ["Shift"] });
  await expect(selected).toContainText(["Etsy craft shop", "FB Ads acc-02", "Sandbox"]);
});

test("edits start from a key, a double-click or the cell's edit button, never a plain click (EMIL-12)", async ({ page }) => {
  await openApp(page);
  const proxyCell = row(page, "Sandbox").locator("[data-cell='proxy']");
  // The first press opens Peek, which narrows the list under the pointer:
  // the double-click still edits the cell it began on.
  await proxyCell.dblclick();
  await expect(page.getByRole("dialog", { name: "Proxy" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Proxy" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(peek(page)).toHaveCount(0);
  // Notes is the last column: its edit button rides in the row actions.
  const notes = row(page, "Sandbox").locator("[data-cell='notes']");
  await notes.hover({ position: { x: 8, y: 18 } });
  await row(page, "Sandbox").getByRole("button", { name: /^Edit notes/ }).click();
  await expect(row(page, "Sandbox").getByRole("textbox", { name: "Notes" })).toBeFocused();
  await page.keyboard.press("Escape");
  // A double-click on the name opens the profile form (manual save); E renames in place.
  await row(page, "Sandbox").locator("[data-cell='name']").dblclick();
  await expect(page.getByRole("dialog", { name: "Edit Sandbox" })).toBeVisible();
});

test("list cells narrate nothing: no Change proxy tooltip; a note shows only when it is cut (EMIL-14)", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/entities/profile/index.ts", "__profile");
  await page.evaluate(() => (window as unknown as { __profile: { useProfile: { getState: () => { setNotes: (id: string, n: string) => Promise<unknown> } } } })
    .__profile.useProfile.getState().setNotes("a78a0eea", "A very long note ".repeat(20)));
  await row(page, "Sandbox").locator("[data-cell='proxy']").hover();
  await page.waitForTimeout(900);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await row(page, "Etsy craft shop").locator("[data-cell='notes']").hover(); // "Payout Tuesday" fits
  await page.waitForTimeout(900);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await row(page, "Amazon US seller").locator("[data-cell='notes']").hover();
  await expect(page.getByRole("tooltip")).toContainText("A very long note", { timeout: 2000 });
});

test("on Proxies a click opens Peek and Cmd/Ctrl+click selects", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const r = page.locator("[role='row'][data-proxy-id='px-us-2']");
  await r.locator("[data-cell='address']").click();
  await expect(peek(page)).toBeVisible();
  await page.locator("[role='row'][data-proxy-id='px-jp-1'] [data-cell='address']").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator("[role='row'][data-proxy-id='px-jp-1']")).toHaveAttribute("aria-selected", "true");
});

// Pair 40 review, I1: a Proxies row opens Peek from every cell, and the Peek
// narrows the list under the pointer; the second press of a double-click
// must not land in it (Show password, Close, Test now).
test("on Proxies a double-click's second press never reaches the Peek its first opened", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const b = (await page.locator("[role='row'][data-proxy-id='px-us-2']").boundingBox())!;
  // Toward the row's end, clear of the hover strip: Peek opens over it.
  const [x, y] = [b.x + b.width - 260, b.y + b.height / 2];
  await page.evaluate(() => {
    const w = window as unknown as { __peekPresses: number };
    w.__peekPresses = 0;
    for (const type of ["pointerdown", "mousedown", "click"]) {
      document.addEventListener(type, (e) => { if ((e.target as Element).closest("aside[data-peek]")) w.__peekPresses++; });
    }
  });
  await page.mouse.dblclick(x, y);
  await expect(peek(page)).toBeVisible();
  // The press did land where Peek now is: the check means something.
  expect(await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest("aside[data-peek]"), [x, y])).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __peekPresses: number }).__peekPresses)).toBe(0);
});

// Pair 40 review, I3: on macOS a Ctrl-click is the secondary click (the
// menu's). It never arms a cell's double-click edit, so the next click (a
// menu item under the pointer, counted as click 2) is never taken for one.
test.describe("on macOS", () => {
  test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" });
  test("a Ctrl-click never arms a cell's double-click edit", async ({ page }) => {
    await openApp(page);
    const b = (await row(page, "Sandbox").locator("[data-cell='notes']").boundingBox())!;
    await page.mouse.move(b.x + 8, b.y + b.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up("Control");
    // Whatever the Ctrl-click opened goes; then a press the system counts as click 2.
    await page.keyboard.press("Escape");
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await expect(page.locator("[role='row'][data-profile-id='f62a9d43']").getByRole("textbox", { name: "Notes" })).toHaveCount(0);
  });
});

// E15 (IFACE-05): a drag carries the selection when the dragged row is part
// of it. The selection stays as it was after the move (owner rule; ORDER
// R26 a strikes the plan's narrowing to the failed ids).
test("dragging one of three selected rows onto a Folder moves all three (IFACE-05)", async ({ page }) => {
  await openApp(page);
  for (const n of ["Etsy craft shop", "Sandbox", "Scraper pricing"]) await pick(page, n);
  await row(page, "Sandbox").locator("[data-cell='name']").dragTo(page.locator("aside [data-folder='Ads']"));
  await expect(page.locator("[role='row'][data-profile-id][aria-selected='true']")).toHaveCount(3);
  await page.locator("aside [data-folder='Ads']").click();
  for (const n of ["Etsy craft shop", "Sandbox", "Scraper pricing"]) await expect(row(page, n)).toHaveCount(1);
});

test("dragging a row that is not selected moves only that row", async ({ page }) => {
  await openApp(page);
  await pick(page, "Etsy craft shop");
  await row(page, "Sandbox").locator("[data-cell='name']").dragTo(page.locator("aside [data-folder='Ads']"));
  await page.locator("aside [data-folder='Ads']").click();
  await expect(row(page, "Sandbox")).toHaveCount(1);
  await expect(row(page, "Etsy craft shop")).toHaveCount(0);
});
