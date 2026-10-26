import { expect, test, type Page } from "@playwright/test";
import { openApp, seedATag } from "./support/app";
import { openSearch } from "./support/search";

// Task 5e: a Profiles or Proxies row shows its main actions on hover, not
// only under More. Both lists share the same overlay component
// (src/shared/ui/RowHoverActions.tsx). Fix round 1 (task-5e-fix1.md) added
// the double-click guard, the inline-edit-hides-the-overlay rule, the
// click-through fade/gaps, the opaque background, dropping the sticky
// header's z-index fight, and the shared show rule (hover, focus-within, or
// the row's own menu open — never "active" alone).

// Exact match on the name cell: `hasText` is a substring match, and would
// also catch a freshly cloned "Etsy craft shop copy" once one exists.
const profileRow = (page: Page, name: string) =>
  page.locator("[role='row'][data-profile-id]").filter({ has: page.locator("[data-cell='name']").getByText(name, { exact: true }) });
const proxyRow = (page: Page, name: string) =>
  page.locator("[role='row'][data-proxy-id]").filter({ has: page.locator("[data-cell='name']").getByText(name, { exact: true }) });
const peek = (page: Page) => page.locator("aside[data-peek]");
const undoToast = (page: Page) => page.locator("[data-toast]").filter({ has: page.getByRole("button", { name: "Undo" }) });
const profileCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { __shardxMock: { state: { order: string[] } } }).__shardxMock.state.order.length);
type MockProfiles = { state: { profiles: Record<string, { _meta: { pinned: boolean } }> } };
const isPinned = (page: Page, id: string) =>
  page.evaluate((id) => (window as unknown as { __shardxMock: MockProfiles }).__shardxMock.state.profiles[id]._meta.pinned, id);

/** Arrows the active row to `name` from wherever it starts. A step at a time,
 *  each confirmed before the next: the list moves the active row and focuses
 *  it on a deferred frame, and firing every ArrowDown back to back can race
 *  ahead of that (unrelated to this task; the same list keyboard as
 *  profiles-keys.spec.ts, which only ever waits between presses too). The
 *  pointer may already have made a row the target (O5, E13): the walk starts
 *  there, and a row that is already the target is stepped off and back, so
 *  the keyboard lands on it. */
/** The pointer resting at (x, y) while the keys drive: focus in a row shows
 *  its hover actions only then (owner bug, 2026-10-01), so the upper row's,
 *  which the tooltip lies over, stay shown with the pointer on the tooltip.
 *  A key that does nothing in the list. */
async function keysDriveAt(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.keyboard.press("ArrowLeft");
}

async function makeActive(page: Page, name: string) {
  const order = await page.locator("[role='row'] [data-cell='name']").allTextContents();
  const idx = order.indexOf(name);
  const active = page.locator("[role='row'][data-active]");
  const current = (await active.count()) > 0 ? await active.locator("[data-cell='name']").textContent() : null;
  let at = current === null ? -1 : order.indexOf(current);
  const step = async (dir: 1 | -1) => {
    await page.keyboard.press(dir > 0 ? "ArrowDown" : "ArrowUp");
    at += dir;
    await expect(active).toContainText(order[at]);
  };
  if (at === idx) await step(idx > 0 ? -1 : 1);
  while (at !== idx) await step(at < idx ? 1 : -1);
  // The row itself takes DOM focus on a deferred frame; wait for it, or a
  // Tab right after can race ahead of it and land one control early.
  await expect(active).toBeFocused();
}

test.describe("Profiles", () => {
  test("hovering a row shows Pin, Open in Peek, Clone and Move to Trash; another row shows none", async ({ page }) => {
    await openApp(page);
    const row = profileRow(page, "Etsy craft shop");
    await row.hover();
    await expect(row.getByRole("button", { name: "Pin" })).toBeVisible();
    // exact: Task 8 gave editable cells their own "Edit … for {name}" buttons.
    await expect(row.getByRole("button", { name: "Open in Peek", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Clone" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Move to Trash" })).toBeVisible();

    const other = profileRow(page, "Sandbox");
    await expect(other.getByRole("button", { name: "Pin" })).not.toBeVisible();
    await expect(other.getByRole("button", { name: "Open in Peek", exact: true })).not.toBeVisible();
    await expect(other.getByRole("button", { name: "Clone" })).not.toBeVisible();
    await expect(other.getByRole("button", { name: "Move to Trash" })).not.toBeVisible();
  });

  test("Clone adds one profile per click; a double click still adds only one", async ({ page }) => {
    await openApp(page);
    const row = profileRow(page, "Etsy craft shop");
    const before = await profileCount(page);
    await row.hover();
    await row.getByRole("button", { name: "Clone" }).click();
    await expect.poll(() => profileCount(page)).toBe(before + 1);

    // The button stays put after a click (unlike the row menu's Clone, which
    // closes and so a double click's second click lands on nothing): the
    // second click of a genuine double click is `e.detail > 1` and is
    // ignored, so the count still rises by only one, not two. The clone
    // that arrived moved the rows under the pointer: back onto this one, as
    // its actions show only there (owner bug, 2026-10-01).
    await row.hover();
    await row.getByRole("button", { name: "Clone" }).dblclick();
    await page.waitForTimeout(300);
    expect(await profileCount(page)).toBe(before + 2);
  });

  test("a double click on Move to Trash trashes exactly one profile, not the row that slides under the pointer", async ({ page }) => {
    await openApp(page);
    const before = await profileCount(page);
    const row = profileRow(page, "Etsy craft shop");
    await row.hover();
    // The first click removes this row; a real double click's second click
    // then lands, at the same screen point, on whatever row slid up to fill
    // it — this reproduces that exactly (Playwright fires both clicks at one
    // fixed point, as a real double click does).
    await row.getByRole("button", { name: "Move to Trash" }).dblclick();
    await expect.poll(() => profileCount(page)).toBe(before - 1);
    await expect(undoToast(page)).toHaveCount(1);
  });

  test("Pin moves an unpinned row into the pinned group and stays Pin, pressed", async ({ page }) => {
    await openApp(page);
    const row = profileRow(page, "Etsy craft shop");
    await row.hover();
    const pin = row.getByRole("button", { name: "Pin", exact: true });
    await pin.click();
    // Fix round 1, finding 10: the row button keeps one stable label,
    // "Pin" — only aria-pressed says "on" now ("Unpin" is menu-only). The
    // row moved out from under the pointer, its hover actions with it
    // (owner bug, 2026-10-01): the button, shown or not.
    await expect(row.getByRole("button", { name: "Pin", exact: true, includeHidden: true })).toHaveAttribute("aria-pressed", "true");
    // The pinned group is the data, not just a screen position: this is
    // "aed41005" in the fixtures (Etsy craft shop).
    // The row shows the pin before the backend has it (PERF-13).
    await expect.poll(() => isPinned(page, "aed41005")).toBe(true);
    const names = await page.locator("[role='row'][data-profile-id] [data-cell='name']").allTextContents();
    expect(names.indexOf("Etsy craft shop")).toBeLessThan(names.indexOf("Sandbox"));
  });

  test("a press on a tooltip lying over the row above goes to the button under it, once, never to the tooltip's own row (Pair 36 review, Important 3)", async ({ page }) => {
    await openApp(page);
    const names = await page.locator("[role='row'][data-profile-id] [data-cell='name']").allTextContents();
    const [upper, lower] = [names[2], names[3]];
    // The upper row has the keyboard, so its hover actions show without the pointer.
    await makeActive(page, upper);
    // Shown or not: the pointer on the row below takes them away until the keys drive (keysDriveAt).
    const upperPin = profileRow(page, upper).getByRole("button", { name: "Pin", exact: true, includeHidden: true });
    await expect(upperPin).toBeVisible();
    // The pointer takes the target to the lower row (O5, E13); focus inside
    // the upper row keeps its hover actions shown there. Its box shows on
    // hover at rest, and stays while it has focus (selection mode).
    await profileRow(page, upper).hover({ position: { x: 4, y: 18 } });
    await profileRow(page, upper).locator("[data-cell='checkbox'] input").focus();
    const lowerRow = profileRow(page, lower);
    await lowerRow.hover();
    await lowerRow.getByRole("button", { name: "Pin", exact: true }).hover();
    const tip = page.getByRole("tooltip");
    await expect(tip).toHaveText("Pin");
    // A point where the lower row's tooltip lies over the upper row's Pin.
    const t = (await tip.boundingBox())!;
    const b = (await upperPin.boundingBox())!;
    const left = Math.max(t.x, b.x), right = Math.min(t.x + t.width, b.x + b.width);
    const top = Math.max(t.y, b.y), bottom = Math.min(t.y + t.height, b.y + b.height);
    expect(right > left && bottom > top).toBe(true);
    const [x, y] = [(left + right) / 2, (top + bottom) / 2];
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[role='tooltip']"), [x, y])).toBe(true);
    const id = (await profileRow(page, upper).getAttribute("data-profile-id"))!;
    await keysDriveAt(page, x, y);
    await page.mouse.click(x, y);
    // The press reached the upper row's Pin, once (twice would unpin it).
    // Pinned, the row moves up to the pinned group.
    await expect.poll(() => isPinned(page, id)).toBe(true);
    await expect(profileRow(page, upper).getByRole("button", { name: "Pin", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await isPinned(page, id)).toBe(true);
    // The tooltip's own row never saw it: its Pin was not pressed.
    expect(await isPinned(page, (await lowerRow.getAttribute("data-profile-id"))!)).toBe(false);
  });

  test("a press on a tooltip held until the tooltip is gone still clicks the button under it, once (Pair 36 re-review, Important 3a)", async ({ page }) => {
    await openApp(page);
    const names = await page.locator("[role='row'][data-profile-id] [data-cell='name']").allTextContents();
    const [upper, lower] = [names[2], names[3]];
    await makeActive(page, upper);
    // Shown or not: the pointer on the row below takes them away until the keys drive (keysDriveAt).
    const upperPin = profileRow(page, upper).getByRole("button", { name: "Pin", exact: true, includeHidden: true });
    await expect(upperPin).toBeVisible();
    // The pointer takes the target to the lower row (O5, E13); focus inside
    // the upper row keeps its hover actions shown there. Its box shows on
    // hover at rest, and stays while it has focus (selection mode).
    await profileRow(page, upper).hover({ position: { x: 4, y: 18 } });
    await profileRow(page, upper).locator("[data-cell='checkbox'] input").focus();
    const lowerRow = profileRow(page, lower);
    await lowerRow.hover();
    await lowerRow.getByRole("button", { name: "Pin", exact: true }).hover();
    const tip = page.getByRole("tooltip");
    await expect(tip).toHaveText("Pin");
    const t = (await tip.boundingBox())!;
    const b = (await upperPin.boundingBox())!;
    const left = Math.max(t.x, b.x), right = Math.min(t.x + t.width, b.x + b.width);
    const top = Math.max(t.y, b.y), bottom = Math.min(t.y + t.height, b.y + b.height);
    expect(right > left && bottom > top).toBe(true);
    const [x, y] = [(left + right) / 2, (top + bottom) / 2];
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[role='tooltip']"), [x, y])).toBe(true);
    const id = (await profileRow(page, upper).getAttribute("data-profile-id"))!;
    // Every click sent to a button of the upper row, however it got there
    // (capture: the row's buttons stop their clicks from bubbling).
    await page.evaluate((id) => {
      const w = window as unknown as { __upperClicks: number };
      w.__upperClicks = 0;
      window.addEventListener("click", (e) => {
        const button = e.target instanceof Element ? e.target.closest("button") : null;
        if (button?.closest("[data-profile-id]")?.getAttribute("data-profile-id") === id) w.__upperClicks++;
      }, true);
    }, id);
    // A real press lasts longer than the bubble's exit: the browser sends no
    // click once the node it was pressed on is gone.
    await keysDriveAt(page, x, y);
    await page.mouse.down();
    await expect(page.locator("[role='tooltip']")).toHaveCount(0);
    await page.mouse.up();
    await expect.poll(() => isPinned(page, id)).toBe(true);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => (window as unknown as { __upperClicks: number }).__upperClicks)).toBe(1);
    expect(await isPinned(page, id)).toBe(true);
    expect(await isPinned(page, (await lowerRow.getAttribute("data-profile-id"))!)).toBe(false);
  });

  /** The lower row's Pin tooltip lying over the upper row's Pin: the point
   *  under both, and a count of the clicks that reach the upper row. */
  const tipOverUpperPin = async (page: Page) => {
    await openApp(page);
    const names = await page.locator("[role='row'][data-profile-id] [data-cell='name']").allTextContents();
    const [upper, lower] = [names[2], names[3]];
    await makeActive(page, upper);
    // Shown or not: the pointer on the row below takes them away until the keys drive (keysDriveAt).
    const upperPin = profileRow(page, upper).getByRole("button", { name: "Pin", exact: true, includeHidden: true });
    await expect(upperPin).toBeVisible();
    // The pointer takes the target to the lower row (O5, E13); focus inside
    // the upper row keeps its hover actions shown there. Its box shows on
    // hover at rest, and stays while it has focus (selection mode).
    await profileRow(page, upper).hover({ position: { x: 4, y: 18 } });
    await profileRow(page, upper).locator("[data-cell='checkbox'] input").focus();
    const lowerRow = profileRow(page, lower);
    await lowerRow.hover();
    await lowerRow.getByRole("button", { name: "Pin", exact: true }).hover();
    const tip = page.getByRole("tooltip");
    await expect(tip).toHaveText("Pin");
    const t = (await tip.boundingBox())!;
    const b = (await upperPin.boundingBox())!;
    const left = Math.max(t.x, b.x), right = Math.min(t.x + t.width, b.x + b.width);
    const top = Math.max(t.y, b.y), bottom = Math.min(t.y + t.height, b.y + b.height);
    expect(right > left && bottom > top).toBe(true);
    const [x, y] = [(left + right) / 2, (top + bottom) / 2];
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest("[role='tooltip']"), [x, y])).toBe(true);
    const id = (await profileRow(page, upper).getAttribute("data-profile-id"))!;
    await page.evaluate((id) => {
      const w = window as unknown as { __upperClicks: number };
      w.__upperClicks = 0;
      window.addEventListener("click", (e) => {
        if (e.target instanceof Element && e.target.closest("[data-profile-id]")?.getAttribute("data-profile-id") === id) w.__upperClicks++;
      }, true);
    }, id);
    const upperClicks = () => page.evaluate(() => (window as unknown as { __upperClicks: number }).__upperClicks);
    await keysDriveAt(page, x, y);
    return { x, y, id, upper, lowerRow, upperClicks };
  };

  test("a right press on a tooltip clicks nothing under it (Pair 36 fix2 re-review, Minor 3)", async ({ page }) => {
    const { x, y, id, lowerRow, upperClicks } = await tipOverUpperPin(page);
    await page.mouse.move(x, y);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await page.waitForTimeout(100);
    expect(await upperClicks()).toBe(0);
    expect(await isPinned(page, id)).toBe(false);
    expect(await isPinned(page, (await lowerRow.getAttribute("data-profile-id"))!)).toBe(false);
  });

  test("a press on a tooltip dragged off the button before its release clicks nothing, not even the row (Pair 36 fix2 re-review, Minor 1)", async ({ page }) => {
    const { x, y, id, upper, lowerRow, upperClicks } = await tipOverUpperPin(page);
    // Let go on the same row's name: a click there would reach the row the
    // two ends share.
    const name = (await profileRow(page, upper).locator("[data-cell='name']").boundingBox())!;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(name.x + 8, name.y + name.height / 2, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect(await upperClicks()).toBe(0);
    expect(await isPinned(page, id)).toBe(false);
    expect(await isPinned(page, (await lowerRow.getAttribute("data-profile-id"))!)).toBe(false);
  });

  test("clicking a hover button leaves the selection and this row's own fields untouched", async ({ page }) => {
    await openApp(page);
    await profileRow(page, "Sandbox").locator("[data-cell='checkbox'] input").check({ force: true });
    await profileRow(page, "FB Ads acc-02").locator("[data-cell='checkbox'] input").check({ force: true });

    const row = profileRow(page, "Etsy craft shop");
    await row.hover();
    await row.getByRole("button", { name: "Pin", exact: true }).click();

    // The selection made before this click is exactly what it was.
    expect(await page.locator("[role='row'][aria-selected='true']").count()).toBe(2);
    await expect(profileRow(page, "Sandbox")).toHaveAttribute("aria-selected", "true");
    await expect(profileRow(page, "FB Ads acc-02")).toHaveAttribute("aria-selected", "true");
    // Pin did not also select this row, or start an inline edit on it.
    await expect(row).toHaveAttribute("aria-selected", "false");
    await expect(row.getByRole("textbox")).toHaveCount(0);
  });

  test("Open in Peek opens Peek on that profile", async ({ page }) => {
    await openApp(page);
    const row = profileRow(page, "Etsy craft shop");
    await row.hover();
    await row.getByRole("button", { name: "Open in Peek", exact: true }).click();
    await expect(peek(page)).toHaveAttribute("aria-label", "Peek: Etsy craft shop");
  });

  test("Clicking Clone does not open Peek for a different action", async ({ page }) => {
    await openApp(page);
    const row = profileRow(page, "Etsy craft shop");
    await row.hover();
    await row.getByRole("button", { name: "Clone" }).click();
    await expect(peek(page)).toHaveCount(0);
  });

  test("Move to Trash removes the row at once, with Undo bringing it back", async ({ page }) => {
    await openApp(page);
    const row = profileRow(page, "Etsy craft shop");
    await row.hover();
    await row.getByRole("button", { name: "Move to Trash" }).click();
    await expect(profileRow(page, "Etsy craft shop")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(undoToast(page)).toContainText('Moved “Etsy craft shop” to Trash');
    await undoToast(page).getByRole("button", { name: "Undo" }).click();
    await expect(profileRow(page, "Etsy craft shop")).toHaveCount(1);
  });

  test("the overlay never covers an open inline edit, even while the row is hovered", async ({ page }) => {
    await openApp(page);
    const row = profileRow(page, "Sandbox");
    // Near the cell's left edge: see profiles-inline-edit.spec.ts for why
    // (the Notes column is narrower here than the overlay it hovers under).
    // A raw mouse click, not a locator click: Notes is the last column, so
    // its own edit button lives in the row actions (a sibling, not a
    // descendant of the cell) and covers this same point once shown (Task 8).
    // E14 (EMIL-12): a plain click opens Peek; the edit starts from the
    // cell's edit button, shown once the pointer is on the cell.
    const notesCell = row.locator("[data-cell='notes']");
    const notesBox = (await notesCell.boundingBox())!;
    await page.mouse.move(notesBox.x + 4, notesBox.y + 8);
    await row.getByRole("button", { name: /^Edit notes/ }).click();
    const input = row.getByRole("textbox", { name: "Notes" });
    await expect(input).toBeVisible();
    await row.hover();
    const box = (await input.boundingBox())!;
    // Near the input's right edge: exactly where the overlay would sit if
    // it were shown (it must not be, while this row has an inline edit open).
    const hitTag = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
      { x: box.x + box.width - 6, y: box.y + box.height / 2 },
    );
    expect(hitTag).toBe("INPUT");
  });

  test("the overlay never paints over or takes clicks from the sticky header", async ({ page }) => {
    // 2000 profiles so the list actually scrolls (8 fit on screen already).
    await page.addInitScript(() => { (window as unknown as { __shardxMockProfiles: number }).__shardxMockProfiles = 2000; });
    await openApp(page);
    const grid = page.getByRole("treegrid");
    const header = page.locator("[role='row'][aria-rowindex='1']");
    const headerBox = (await header.boundingBox())!;
    // Half a row (18 of 36 px): the topmost rendered row now sits half
    // behind the sticky header.
    await grid.evaluate((el) => { el.scrollTop = 18; });
    const topRow = page.locator("[role='row'][data-profile-id]").first();
    await topRow.hover({ force: true });
    const point = { x: headerBox.x + headerBox.width / 2, y: headerBox.y + headerBox.height / 2 };
    const underHeader = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest("[role='row'][aria-rowindex='1']") !== null,
      point,
    );
    expect(underHeader).toBe(true);
  });

  test("keyboard: Tab from the active row reaches its action buttons, Pin first among them", async ({ page }) => {
    // Tags shows once a tag exists (Pair 27, F20): its edit button is one stop.
    await seedATag(page);
    await openApp(page);
    await makeActive(page, "Etsy craft shop");
    const row = profileRow(page, "Etsy craft shop");
    // The Folder, Tags and Proxy edit buttons, and the Notes one that leads
    // the row actions (owner feature 2026-09-26), then Pin. The select box
    // is out of the Tab order at rest (selection mode, owner 2026-10-01).
    for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
    await expect(row.getByRole("button", { name: "Pin" })).toBeFocused();
  });

  test("keyboard-active alone (no live hover or focus) does not show the hover actions", async ({ page }) => {
    await openApp(page);
    await makeActive(page, "Etsy craft shop");
    // Move focus elsewhere (the filter), so the row is still "active" (the
    // list keys act on it) but has neither live hover nor focus-within.
    await openSearch(page);
    const row = profileRow(page, "Etsy craft shop");
    await expect(row.getByRole("button", { name: "Pin" })).not.toBeVisible();
  });

  test("the row's menu keeps its Start/Stop and More, and the hover icons, in view while it is open", async ({ page }) => {
    await openApp(page);
    const row = profileRow(page, "Etsy craft shop");
    await row.hover();
    await row.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    // Move the pointer off the row entirely; the menu is still open.
    await page.mouse.move(1, 1);
    await expect(row.getByRole("button", { name: "More actions" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Pin" })).toBeVisible();
  });
});

test.describe("Proxies", () => {
  test("hovering a row shows Open in Peek, Copy address, Delete and Test; another row shows none of the new three", async ({ page }) => {
    await openApp(page, { section: "proxies" });
    const row = proxyRow(page, "DC Tokyo");
    await row.hover();
    await expect(row.getByRole("button", { name: "Open in Peek" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Copy address" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Test" })).toBeVisible();

    const other = proxyRow(page, "ISP Frankfurt");
    await expect(other.getByRole("button", { name: "Open in Peek" })).not.toBeVisible();
    await expect(other.getByRole("button", { name: "Copy address" })).not.toBeVisible();
    await expect(other.getByRole("button", { name: "Delete" })).not.toBeVisible();
  });

  test("Open in Peek opens that proxy's Peek", async ({ page }) => {
    await openApp(page, { section: "proxies" });
    const row = proxyRow(page, "DC Tokyo");
    await row.hover();
    await row.getByRole("button", { name: "Open in Peek" }).click();
    await expect(peek(page)).toHaveAttribute("aria-label", "Peek: DC Tokyo");
  });

  test("Copy address shows the copied toast", async ({ page }) => {
    await openApp(page, { section: "proxies" });
    const row = proxyRow(page, "DC Tokyo");
    await row.hover();
    await row.getByRole("button", { name: "Copy address" }).click();
    await expect(page.locator("[data-toast]").filter({ hasText: "Copied address" })).toBeVisible();
  });

  test("Delete runs the same flow as the menu's Delete: the row leaves behind an Undo toast", async ({ page }) => {
    await openApp(page, { section: "proxies" });
    const row = proxyRow(page, "DC Tokyo");
    await row.hover();
    await row.getByRole("button", { name: "Delete" }).click();
    // Nothing is asked (ruling 18).
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(proxyRow(page, "DC Tokyo")).toHaveCount(0);
    await expect(page.locator("[data-toast]").filter({ has: page.getByRole("button", { name: "Undo" }) })).toContainText("Deleted “DC Tokyo”");
  });

  // Controller ruling (merge point 3): the 64 px track Test and More held
  // cut "Frankfurt am Main" at 1280 once the Test result became a pill. They
  // float in the strip over the row's end now, as Profiles' hover actions do.
  test("Test and More take no track: they float over the row's end with the rest, on hover and on keyboard focus, clear of the row's ring", async ({ page }) => {
    await openApp(page, { section: "proxies" });
    const row = proxyRow(page, "DC Tokyo");
    const test_ = row.getByRole("button", { name: "Test" });
    const more = row.getByRole("button", { name: "More actions" });
    await page.mouse.move(1, 1);
    await expect(test_).toBeHidden();
    await expect(more).toBeHidden();

    await row.hover();
    await expect(test_).toBeVisible();
    await expect(more).toBeVisible();
    // Over the last column, not beside it.
    const last = await row.locator("[data-cell='test']").boundingBox();
    const edit = await row.getByRole("button", { name: "Open in Peek" }).boundingBox();
    expect(edit!.x).toBeLessThan(last!.x + last!.width);

    // Keyboard focus on the row shows them too, and the strip leaves the
    // row's inset ring whole above and below it.
    await page.mouse.move(1, 1);
    await makeActive(page, "DC Tokyo");
    await expect(row).toBeFocused();
    await expect(more).toBeVisible();
    const ring = await row.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth));
    expect(ring).toBeGreaterThan(0);
    const [rowBox, strip] = await Promise.all([row.boundingBox(), row.locator("[data-hover-strip]").boundingBox()]);
    expect(strip!.y).toBeGreaterThanOrEqual(rowBox!.y + ring - 0.5);
    expect(strip!.y + strip!.height).toBeLessThanOrEqual(rowBox!.y + rowBox!.height - ring + 0.5);
  });

  test("keyboard: Tab from the active row reaches its first action button", async ({ page }) => {
    await openApp(page, { section: "proxies" });
    await makeActive(page, "DC Tokyo");
    const row = proxyRow(page, "DC Tokyo");
    // As Profiles: the row's own checkbox is out of the Tab order at rest
    // (selection mode, owner 2026-10-01), so the first stop is an action.
    await page.keyboard.press("Tab");
    await expect(row.getByRole("button", { name: "Open in Peek" })).toBeFocused();
  });
});

// Owner feedback 5k (2026-09-26): "delete has color on hover but the other
// buttons don't have it at all on hovering" — every row button now answers
// the pointer with the same translucent neutral fill (RowHoverActions'
// shared `rowButtonHoverClass`/`rowButtonDangerHoverClass`), not only Delete.
//
// Fix round 1, finding 11: the kit's own ghost-neutral hover fill
// (`bg-bg-weak-50`) is already non-transparent, so "transparent to
// non-transparent" passes whether or not the owner's actual bug (the
// button's fill being the same color as the row's own hover tint) is
// fixed. Every fill assertion below composites the button's own hovered
// background over the row's hover overlay first, and asserts the result
// differs from the overlay alone — a real "is there a visible button fill
// on top of the row's own tint," not just "is it not literally see-through".
function parseColor(s: string): [number, number, number, number] {
  // Only rgb()/rgba(): an oklab()/color() computed value carries numbers too,
  // and pulling them out the same way would let a browser that starts
  // resolving to a different color space silently pass this check.
  if (!/^rgba?\(/.test(s)) throw new Error(`expected rgb()/rgba(), got ${s}`);
  const m = s.match(/[\d.]+/g)!.map(Number);
  return [m[0], m[1], m[2], m[3] ?? 1];
}
function composite(fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] {
  const [r, g, b, a] = fg;
  return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
}
const sameRgb = (a: [number, number, number], b: [number, number, number]) =>
  Math.round(a[0]) === Math.round(b[0]) && Math.round(a[1]) === Math.round(b[1]) && Math.round(a[2]) === Math.round(b[2]);

const TRANSPARENT = /^(rgba\(0, ?0, ?0, ?0\)|transparent)$/;
async function computedBg(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}
async function computedColor(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((el) => getComputedStyle(el).color);
}
/** The row's own hover/selected overlay directly behind a hover-overlay
 *  button: the two `aria-hidden` stacked layers RowHoverActions paints in
 *  the strip that holds the button (an opaque white/dark base, then the
 *  row's tint on top), composited in DOM/paint order. The strip, not the
 *  button's parent: the kit's IconButton sits inside its Tooltip's wrapper
 *  span (audit Phase B Task 4: with no layers found, the helper used to
 *  composite over a white fallback, which in dark only differed because
 *  Tailwind's `white/8` computed to an `oklab()` string). */
async function rowOverlayBg(button: ReturnType<Page["locator"]>): Promise<[number, number, number]> {
  const layers = await button.evaluate((el) => {
    const strip = el.closest(":has(> [data-hover-strip])");
    const out: string[] = [];
    for (const sib of Array.from(strip?.children ?? [])) {
      if (sib.getAttribute("aria-hidden") === "true") out.push(getComputedStyle(sib).backgroundColor);
    }
    return out;
  });
  expect(layers, "the strip's base and tint layers").toHaveLength(2);
  let acc = parseColor(layers[0]).slice(0, 3) as [number, number, number];
  for (let i = 1; i < layers.length; i++) acc = composite(parseColor(layers[i]), acc);
  return acc;
}
/** The button's own (possibly translucent) hovered/focused fill,
 *  composited over the row overlay behind it. */
async function buttonFillOverOverlay(button: ReturnType<Page["locator"]>): Promise<[number, number, number]> {
  const overlay = await rowOverlayBg(button);
  const own = parseColor(await computedBg(button));
  return composite(own, overlay);
}
async function errorTextRgb(page: Page): Promise<string> {
  return page.evaluate(() => {
    const v = getComputedStyle(document.body).getPropertyValue("--color-error-text").trim();
    const probe = document.createElement("span");
    probe.style.color = v;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`row button hover feedback (${theme})`, () => {
    test("Profiles: Pin, Open in Peek, Clone, Move to Trash and More each answer hover with a fill visibly different from the row's own tint", async ({ page }) => {
      await openApp(page, { theme });
      const row = profileRow(page, "Etsy craft shop");
      await row.hover();
      const overlay = await rowOverlayBg(row.getByRole("button", { name: "Pin", exact: true }));
      for (const name of ["Pin", "Open in Peek", "Clone"] as const) {
        const button = row.getByRole("button", { name, exact: true });
        const atRest = await computedBg(button);
        expect(atRest, `${name} at rest`).toMatch(TRANSPARENT);
        const restColor = await computedColor(button);
        await button.hover();
        // The fill and icon color transition in (`transition duration-200`);
        // wait for it to settle before reading the computed style (same
        // pattern as e2e/dark-state-fills.spec.ts).
        await page.waitForTimeout(250);
        expect(sameRgb(await buttonFillOverOverlay(button), overlay), `${name} hovered fill vs row overlay`).toBe(false);
        expect(await computedColor(button), `${name} hovered color`).not.toBe(restColor);
        // Keyboard focus shows the same fill as hover.
        await button.focus();
        await page.waitForTimeout(250);
        expect(sameRgb(await buttonFillOverOverlay(button), overlay), `${name} focus-visible fill vs row overlay`).toBe(false);
        await page.mouse.move(0, 0); // clear hover before the next iteration
        // Back on the row, off the button: its actions show only while the
        // pointer is on it (owner bug, 2026-10-01).
        await row.hover();
      }
      const trash = row.getByRole("button", { name: "Move to Trash" });
      await trash.hover();
      await page.waitForTimeout(250);
      expect(sameRgb(await buttonFillOverOverlay(trash), overlay), "Move to Trash hovered fill vs row overlay").toBe(false);
      const errorRgb = await errorTextRgb(page);
      expect(await computedColor(trash), "Move to Trash hovered icon color").toBe(errorRgb);

      // The fixed group (More) sits outside the hover overlay's own two
      // aria-hidden layers (it paints no background of its own), so this
      // checks the simpler "answers the pointer at all" — not equal to the
      // row overlay's compositing, which doesn't apply to it.
      const more = row.getByRole("button", { name: "More actions" });
      const moreAtRest = await computedBg(more);
      expect(moreAtRest, "More at rest").toMatch(TRANSPARENT);
      await more.hover();
      await page.waitForTimeout(250);
      expect(await computedBg(more), "More hovered").not.toMatch(TRANSPARENT);
    });

    test("Profiles: Pin keeps its stable label and toggles aria-pressed once the row is pinned", async ({ page }) => {
      await openApp(page, { theme });
      const row = profileRow(page, "Etsy craft shop");
      await row.hover();
      const pin = row.getByRole("button", { name: "Pin", exact: true });
      await expect(pin).toHaveAttribute("aria-pressed", "false");
      await pin.click();
      // Fix round 1, finding 10: one stable label, "Pin" — only
      // aria-pressed says "on" now; "Unpin" stays a menu-only wording. The
      // pinned row moved out from under the pointer, its hover actions with
      // it (owner bug, 2026-10-01): the button, shown or not.
      await expect(row.getByRole("button", { name: "Pin", exact: true, includeHidden: true })).toHaveAttribute("aria-pressed", "true");
    });

    test("Proxies: Open in Peek, Copy address, Delete and Test each answer hover with a fill visibly different from the row's own tint", async ({ page }) => {
      await openApp(page, { theme, section: "proxies" });
      const row = proxyRow(page, "DC Tokyo");
      await row.hover();
      const overlay = await rowOverlayBg(row.getByRole("button", { name: "Open in Peek" }));
      for (const name of ["Open in Peek", "Copy address"] as const) {
        const button = row.getByRole("button", { name, exact: true });
        expect(await computedBg(button), `${name} at rest`).toMatch(TRANSPARENT);
        await button.hover();
        await page.waitForTimeout(250);
        expect(sameRgb(await buttonFillOverOverlay(button), overlay), `${name} hovered fill vs row overlay`).toBe(false);
      }
      const del = row.getByRole("button", { name: "Delete" });
      await del.hover();
      await page.waitForTimeout(250);
      expect(sameRgb(await buttonFillOverOverlay(del), overlay), "Delete hovered fill vs row overlay").toBe(false);
      const errorRgb = await errorTextRgb(page);
      expect(await computedColor(del), "Delete hovered icon color").toBe(errorRgb);

      // The fixed group (Test, then More) sits outside the hover overlay's
      // own two aria-hidden layers, so this checks the simpler "answers
      // the pointer at all".
      const test_ = row.getByRole("button", { name: "Test" });
      expect(await computedBg(test_), "Test at rest").toMatch(TRANSPARENT);
      await test_.hover();
      await page.waitForTimeout(250);
      expect(await computedBg(test_), "Test hovered").not.toMatch(TRANSPARENT);
      const more = row.getByRole("button", { name: "More actions" });
      await more.hover();
      await page.waitForTimeout(250);
      expect(await computedBg(more), "More hovered").not.toMatch(TRANSPARENT);
    });
  });
}

// Owner feedback 5m (2026-09-26): "make sure to add icons to menu items same
// as in quick hover buttons." Every row menu item (⋮ and right-click, same
// `menu()`) gets an icon, using the same `rowActionIcons` map the hover
// buttons already use — proven here by comparing each item's own
// `data-icon` to its hover button's, not just checking "has an svg".
async function iconOf(locator: ReturnType<Page["locator"]>) {
  return locator.locator("svg").first().getAttribute("data-icon");
}

test.describe("menu items carry the same icons as the row's hover buttons", () => {
  test("Profiles: the ⋮ menu — every item has an icon; Pin, Open in Peek, Clone and Move to Trash match their hover buttons", async ({ page }) => {
    await openApp(page);
    const row = profileRow(page, "Etsy craft shop"); // unpinned
    await row.hover();
    const pinIcon = await iconOf(row.getByRole("button", { name: "Pin", exact: true }));
    const editIcon = await iconOf(row.getByRole("button", { name: "Open in Peek", exact: true }));
    const cloneIcon = await iconOf(row.getByRole("button", { name: "Clone" }));
    const trashIcon = await iconOf(row.getByRole("button", { name: "Move to Trash" }));

    await row.getByRole("button", { name: "More actions" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const items = menu.getByRole("menuitem");
    const n = await items.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await expect(items.nth(i).locator("svg")).toHaveCount(1);
    }
    expect(await iconOf(menu.getByRole("menuitem", { name: "Pin", exact: true }))).toBe(pinIcon);
    expect(await iconOf(menu.getByRole("menuitem", { name: "Open in Peek" }))).toBe(editIcon);
    expect(await iconOf(menu.getByRole("menuitem", { name: "Clone" }))).toBe(cloneIcon);
    expect(await iconOf(menu.getByRole("menuitem", { name: "Move to Trash" }))).toBe(trashIcon);
  });

  test("Profiles: right-click gives the same menu (and icons) as ⋮", async ({ page }) => {
    await openApp(page);
    const row = profileRow(page, "Etsy craft shop");
    await row.click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(iconOf(menu.getByRole("menuitem", { name: "Open in Peek" }))).resolves.toBe("open-peek");
  });

  test("Profiles: a pinned profile's menu shows Unpin with the unpin icon", async ({ page }) => {
    await openApp(page); // Amazon US seller is pinned by default
    await profileRow(page, "Amazon US seller").click({ button: "right" });
    const menu = page.getByRole("menu");
    const unpin = menu.getByRole("menuitem", { name: "Unpin" });
    await expect(unpin).toBeVisible();
    await expect(unpin.locator("svg")).toHaveAttribute("data-icon", "unpin");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`Profiles: the danger item's icon color equals its label color (${theme})`, async ({ page }) => {
      await openApp(page, { theme });
      await profileRow(page, "Etsy craft shop").click({ button: "right" });
      const menu = page.getByRole("menu");
      const del = menu.getByRole("menuitem", { name: "Move to Trash" });
      const labelColor = await del.locator("span", { hasText: "Move to Trash" }).evaluate((el) => getComputedStyle(el).color);
      const iconColor = await del.locator("svg").evaluate((el) => getComputedStyle(el).color);
      expect(iconColor).toBe(labelColor);
    });
  }

  test("Proxies: the ⋮ menu items match the row's hover buttons (Test, Copy address); Delete's icon follows its red label", async ({ page }) => {
    await openApp(page, { section: "proxies" });
    const row = proxyRow(page, "DC Tokyo");
    await row.hover();
    const testIcon = await iconOf(row.getByRole("button", { name: "Test" }));
    const copyIcon = await iconOf(row.getByRole("button", { name: "Copy address" }));

    await row.getByRole("button", { name: "More actions" }).click();
    const menu = page.getByRole("menu");
    const items = menu.getByRole("menuitem");
    // Fix round 1, finding 9: wait for the menu and prove it actually has
    // items — `count()` alone would pass just as well against an empty menu.
    await expect(items.first()).toBeVisible();
    const n = await items.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) await expect(items.nth(i).locator("svg")).toHaveCount(1);
    expect(await iconOf(menu.getByRole("menuitem", { name: "Test" }))).toBe(testIcon);
    expect(await iconOf(menu.getByRole("menuitem", { name: "Copy address" }))).toBe(copyIcon);

    const del = menu.getByRole("menuitem", { name: "Delete" });
    const labelColor = await del.locator("span", { hasText: "Delete" }).evaluate((el) => getComputedStyle(el).color);
    const iconColor = await del.locator("svg").evaluate((el) => getComputedStyle(el).color);
    expect(iconColor).toBe(labelColor);
  });

  test("the pinned sidebar item's menu has icons for Start/Stop, Show in list and Unpin", async ({ page }) => {
    await openApp(page);
    // "a78a0eea" (Amazon US seller) is pinned and running by default.
    const pinned = page.locator("aside [data-pinned='a78a0eea']");
    await pinned.click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Stop" }).locator("svg")).toHaveAttribute("data-icon", "stop");
    await expect(menu.getByRole("menuitem", { name: "Show in list" }).locator("svg")).toHaveAttribute("data-icon", "show-in-list");
    await expect(menu.getByRole("menuitem", { name: "Unpin" }).locator("svg")).toHaveAttribute("data-icon", "unpin");
  });
});
