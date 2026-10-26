import { expect, test, type Page } from "@playwright/test";
import { openApp, openEditForm } from "./support/app";

// Review Focus 1: fast, overlapping input. Every action runs once, on the
// thing the user sees. Tasks 3, 4, 15, 16 and 17 add to this file.
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const profileCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { __shardxMock: { state: { order: string[] } } }).__shardxMock.state.order.length);

test.describe("with motion on", () => {
  // Exits only take time with motion; the suite runs with reduced motion.
  test.use({ reducedMotion: "no-preference" });

  test("a double click on a menu item runs it once", async ({ page }) => {
    await openApp(page);
    const before = await profileCount(page);
    await row(page, "Sandbox").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Clone" }).dblclick();
    await expect.poll(() => profileCount(page)).toBe(before + 1);
    await page.waitForTimeout(600);
    expect(await profileCount(page)).toBe(before + 1);
  });

  test("a click right after Esc lands on the page, not on the closing palette", async ({ page }) => {
    await openApp(page);
    const target = row(page, "FB Ads acc-01").locator("[data-cell='name']");
    const box = (await target.boundingBox())!;
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.keyboard.press("Escape");
    // No actionability wait: the click must land during the palette's fade.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator("aside[data-peek]")).toHaveAttribute("aria-label", "Peek: FB Ads acc-01");
  });

  test("a palette command closes the palette at once", async ({ page }) => {
    await openApp(page);
    await page.keyboard.press("ControlOrMeta+k");
    await page.getByRole("combobox", { name: "Search commands" }).fill("trash");
    await page.keyboard.press("Enter");
    // The palette's fade is 200 ms; after a command it is gone at once.
    await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0, { timeout: 100 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trash");
  });

  test("the second click of a double click on a menu item does not reach the row under it", async ({ page }) => {
    await openApp(page);
    const before = await profileCount(page);
    // Opened near the start of the top row's Name cell, the menu's items sit
    // over the Name cells of the rows below, where a click opens Peek. The
    // row's box has its own slot before the name (owner, 2026-10-07), so the
    // press is on the name and the items still reach no further than the name.
    const name = row(page, "Amazon US seller").locator("[data-cell='name']");
    await name.click({ button: "right", position: { x: 4, y: 18 } });
    const clone = page.getByRole("menuitem", { name: "Clone" });
    const box = (await clone.boundingBox())!;
    const under = await page.evaluate(({ x, y }) => document.elementsFromPoint(x, y).find((el) => !el.closest("[role='menu']"))?.closest("[data-cell]")?.getAttribute("data-cell"), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(under, "a Name cell lies under the item").toBe("name");
    await clone.dblclick();
    await expect.poll(() => profileCount(page)).toBe(before + 1);
    await expect(page.locator("aside[data-peek]")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveCount(0);
  });

  test("the second press of a double click on a menu item does not close what the item opened", async ({ page }) => {
    await openApp(page);
    // The tag picker opens at the row's Tags cell, away from the pointer, so
    // the second press lands outside it, where a press closes it.
    await row(page, "Amazon US seller").locator("[data-cell='name']").click({ button: "right", position: { x: 48, y: 18 } });
    const tags = page.getByRole("menuitem", { name: /^Edit tags/ });
    const box = (await tags.boundingBox())!;
    await tags.dblclick();
    const picker = page.getByRole("dialog");
    await expect(picker).toHaveAttribute("data-state", "open");
    const p = (await picker.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    expect(x < p.x || x > p.x + p.width || y < p.y || y > p.y + p.height, "the second press lands outside the picker").toBe(true);
    await expect(page.locator("aside[data-peek]")).toHaveCount(0);
  });
});

test("a row's More actions opened from the keyboard appears at its button", async ({ page }) => {
  // The first row: the registry's row menu (Pair 38, 452 px with Open in
  // Peek and Change proxy) fits under it.
  await openApp(page);
  const first = page.locator("[role='row'][data-profile-id]").first();
  await first.locator("[data-cell='status']").click();
  const more = first.getByRole("button", { name: "More actions" });
  await more.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const b = (await more.boundingBox())!;
  const m = (await menu.boundingBox())!;
  expect(Math.abs(m.x + m.width - (b.x + b.width))).toBeLessThanOrEqual(1);
  expect(m.y).toBeGreaterThanOrEqual(b.y + b.height);
});

test("the bulk bar's More menu opens at its button", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='checkbox'] input").check({ force: true });
  const more = page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "More bulk actions" });
  await more.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const b = (await more.boundingBox())!;
  const m = (await menu.boundingBox())!;
  // The bar sits at the bottom: the menu opens above it, right edges aligned.
  expect(Math.abs(m.x + m.width - (b.x + b.width))).toBeLessThanOrEqual(1);
  expect(m.y + m.height).toBeLessThanOrEqual(b.y);
});

type Running = { __shardxMock: { state: { running: Record<string, unknown> } } };
const running = (page: Page) => page.evaluate(() => Object.keys((window as unknown as Running).__shardxMock.state.running));

test("list keys pressed on a sidebar button do nothing to the list", async ({ page }) => {
  await openApp(page);
  // eBay DE buyer: the active row, and running. (P20/P21: the Status column
  // is now `[data-cell='status']`, no separate "lastrun" cell.)
  await row(page, "eBay DE buyer").locator("[data-cell='status']").click();
  await page.locator("aside [data-nav='proxies']").focus();
  for (const key of ["ArrowDown", "s", "x", "e", "Backspace", "Delete"]) await page.keyboard.press(key);
  await page.waitForTimeout(300);
  await expect(row(page, "eBay DE buyer")).toHaveCount(1);
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(0);
  // No rename in the list; the click opened Peek, whose title is a Name field (Pair 40).
  await expect(page.locator("[role='row'][data-profile-id]").getByRole("textbox", { name: "Name" })).toHaveCount(0);
  expect(await running(page)).toContain("9828bf28");
  await expect(page.locator("[role='row'][data-active]")).toContainText("eBay DE buyer");
});

test("the row under a moving pointer is the one the keys act on, and the only one drawn (O5)", async ({ page }) => {
  // E13 replaces the pre-O5 model this test pinned (a hovered row was not
  // the target, and drew its own hover fill).
  await openApp(page);
  await row(page, "eBay DE buyer").locator("[data-cell='status']").click();
  // The click opened it in Peek (Pair 40), whose row keeps a quieter fill
  // (ruling 6): Esc closes Peek, so the row is only the one clicked before.
  await page.keyboard.press("Escape");
  await expect(page.locator("aside[data-peek]")).toHaveCount(0);
  await row(page, "TikTok creator").hover();
  await expect(row(page, "TikTok creator")).toHaveAttribute("data-active");
  const bg = (name: string) => row(page, name).evaluate((el) => getComputedStyle(el).backgroundColor);
  const target = await bg("TikTok creator");
  expect(target).not.toBe(await bg("Sandbox"));
  // The row clicked before is no longer drawn: no fill at all.
  expect(await bg("eBay DE buyer")).toBe(await bg("Sandbox"));
});

test("the arrows still step into the list from the page itself", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[role='row'][data-active]")).toBeFocused();
});

for (const theme of ["light", "dark"] as const) {
  test(`the hover-action strip matches the active row's fill, ${theme}`, async ({ page }) => {
    // Fix round 1, finding 1: the strip's own opaque white base used to cut
    // a plain-white band out of the drawn active row. Focus (not hover)
    // shows the strip (`group-focus-within:visible`), so ArrowDown alone —
    // no mouse — is enough to expose it.
    await openApp(page, { theme });
    await page.keyboard.press("ArrowDown");
    const activeRow = page.locator("[role='row'][data-active]");
    await expect(activeRow).toBeFocused();
    const rowBg = await activeRow.evaluate((el) => getComputedStyle(el).backgroundColor);
    const stripBg = await activeRow.locator("[data-hover-strip]").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(stripBg).toBe(rowBg);
  });

  test(`the hover-action strip still matches the active row's fill on hover, ${theme} (fix round 2, finding 1)`, async ({ page }) => {
    // The row's own background has no hover variant on the active tone
    // (a fixed bg-bg-active); the strip must not gain one either,
    // or hovering an active row shows a two-tone band.
    await openApp(page, { theme });
    await page.keyboard.press("ArrowDown");
    const activeRow = page.locator("[role='row'][data-active]");
    await expect(activeRow).toBeFocused();
    await activeRow.hover();
    const rowBg = await activeRow.evaluate((el) => getComputedStyle(el).backgroundColor);
    const stripBg = await activeRow.locator("[data-hover-strip]").evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(stripBg).toBe(rowBg);
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const hover of [false, true] as const) {
    test(`an active row's pinned cells match its own fill, ${theme}${hover ? " on hover" : ""} (Task 2 ruling C5)`, async ({ page }) => {
      // The active tone (`--bg-active`, shared with the row in Peek) has
      // no hover variant; each pinned cell (select box, Name, row actions)
      // paints its row's own fill under itself with a `::before` (an opaque
      // white plus a `--bg-active` gradient layer, so it reaches over the row's side
      // padding and gap without going translucent twice), so its `::before`
      // background must carry the row's own computed background-color, at
      // rest and on hover, never only the fill the plain hover (`--bg-hover`)
      // or Peek (the active rule) rule alone would give it.
      await openApp(page, { theme });
      await page.keyboard.press("ArrowDown");
      const activeRow = page.locator("[role='row'][data-active]");
      await expect(activeRow).toBeFocused();
      if (hover) await activeRow.hover();
      const rowBg = await activeRow.evaluate((el) => getComputedStyle(el).backgroundColor);
      for (const cls of ["list-pin-check", "list-pin-name", "list-pin-end"]) {
        const pinBg = await activeRow.locator(`.${cls}`).evaluate((el) => getComputedStyle(el, "::before").background);
        expect(pinBg).toContain(rowBg);
      }
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`a hovered row's pinned cells lay its fill over the surface, ${theme} (Phase B Task 2)`, async ({ page }) => {
    // The weak fill is translucent now: alone under a pinned cell, what
    // scrolls beneath would show through and the fill would double up.
    await openApp(page, { theme });
    const hovered = row(page, "Etsy craft shop");
    await hovered.hover();
    // The target is the kit's `row-fill-active` (vf-f, merge point 12): the
    // hover layer over the list's own opaque fill, which the pinned cells
    // repeat, so nothing beneath shows through.
    const look = await hovered.evaluate((el) => { const s = getComputedStyle(el); return { image: s.backgroundImage, color: s.backgroundColor }; });
    expect(look.color).not.toBe("rgba(0, 0, 0, 0)");
    for (const cls of ["list-pin-check", "list-pin-name", "list-pin-end"]) {
      const pin = await hovered.locator(`.${cls}`).evaluate((el) => {
        const s = getComputedStyle(el, "::before");
        return { image: s.backgroundImage, color: s.backgroundColor };
      });
      expect(pin.image).toContain(look.image);
      expect(pin.color).toBe(look.color);
    }
  });
}

type Launch = { id: string };
const launched = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __shardxMockLaunches?: Launch[] }).__shardxMockLaunches ?? []).map((l) => l.id));
const pick = (page: Page, name: string) => row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });

test("S with a selection starts the selection, not the active row", async ({ page }) => {
  // Fix round 2, item 2: the row click here used to be a workaround for
  // item 3's bug (a ticked checkbox swallowed the keys, so focus had to move
  // to a row before "s" would do anything). Now that a checkbox is not a
  // text field, "s" reaches the grid straight from the second checkbox.
  await openApp(page);
  await pick(page, "Etsy craft shop");
  await pick(page, "FB Ads acc-02");
  await page.keyboard.press("s");
  await expect.poll(() => launched(page)).toEqual(expect.arrayContaining(["aed41005", "c31d92f1"]));
  expect(await launched(page)).not.toContain("f62a9d43");
});

test("holding S doesn't restart or stop what's already running (fix round 1, finding 4)", async ({ page }) => {
  await openApp(page);
  await pick(page, "Etsy craft shop");
  await pick(page, "FB Ads acc-02");
  await page.keyboard.down("s"); // held the whole test: never released until the end
  await expect.poll(() => running(page), { timeout: 4000 }).toEqual(expect.arrayContaining(["aed41005", "c31d92f1"]));
  // Now that both are running, a repeat re-evaluating the selection would see
  // nothing idle and take the "stop" branch instead — stopping what it just
  // started. A held key must not re-fire the case body at all.
  await page.keyboard.down("s"); // auto-repeat
  await page.keyboard.up("s");
  await page.waitForTimeout(300);
  await expect(row(page, "Etsy craft shop").getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(row(page, "FB Ads acc-02").getByRole("button", { name: "Stop" })).toBeVisible();
});

test("ticking rows with the mouse leaves S (and the other list keys) working", async ({ page }) => {
  // Fix round 1, finding 3: `keyboardIsTaken` treated any `input`, checkboxes
  // included, as a text field, so focus left on a just-ticked checkbox
  // silently swallowed every list key. No other click repositions focus here.
  await openApp(page);
  await pick(page, "Etsy craft shop");
  await pick(page, "FB Ads acc-02");
  await page.keyboard.press("s");
  await expect.poll(() => launched(page)).toEqual(expect.arrayContaining(["aed41005", "c31d92f1"]));
});

test("Shift+Arrow extends the selection from the active row, and back shrinks it", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").locator("[data-cell='status']").click();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  const selected = page.locator("[role='row'][aria-selected='true']");
  await expect(selected).toHaveCount(3);
  // Pinned rows (Amazon US seller, FB Ads acc-01) sort first (P5): from Etsy
  // craft shop the run continues into FB Ads acc-02, then TikTok creator.
  await expect(selected).toContainText(["Etsy craft shop", "FB Ads acc-02", "TikTok creator"]);
  await page.keyboard.press("Shift+ArrowUp");
  await expect(selected).toHaveCount(2);
});

test("bulk Start keeps the whole selection, even when one fails (owner fix 1)", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockLaunchFails: string[] }).__shardxMockLaunchFails = ["aed41005"]; });
  await openApp(page);
  await pick(page, "Etsy craft shop");
  await pick(page, "FB Ads acc-02");
  const bar = page.getByRole("toolbar", { name: /selected/ });
  await bar.getByRole("button", { name: "Start" }).click();
  await expect(bar).toContainText("2 selected");
  // The failure is reported on its own, the selection is never narrowed
  // (replaces Phase A's IFACE-05 narrowing).
  await expect(page.locator("[data-toast]")).toContainText("Engine could not start", { timeout: 6000 });
  // Both launches run one at a time; wait for the whole bulk Start to finish
  // (not just the first, failed one) before checking the selection, or this
  // would pass against the old narrowing code too (it only narrows once the
  // run ends).
  await expect(bar.getByRole("button", { name: "Start" })).toBeEnabled({ timeout: 6000 });
  await expect(bar).toContainText("2 selected");
  await expect(row(page, "Etsy craft shop")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "FB Ads acc-02")).toHaveAttribute("aria-selected", "true");
});

test("changing the selection during a slow bulk Start keeps the new selection", async ({ page }) => {
  await openApp(page);
  await pick(page, "Etsy craft shop");
  await pick(page, "FB Ads acc-02");
  const bar = page.getByRole("toolbar", { name: /selected/ });
  await bar.getByRole("button", { name: "Start" }).click();
  await expect(bar).toContainText("2 selected");
  // Each launch sleeps 900ms in the mock and runs one at a time: plenty of
  // time to change the selection before the run ends (fix round 1, finding
  // 2). The person's choice wins — the run's own result is never applied.
  await pick(page, "TikTok creator");
  await expect(bar).toContainText("3 selected");
  // `running`, not `launched`: the mock pushes to `launched` the instant each
  // launch is *invoked*, well before its 900ms sleep resolves — `running`
  // only flips once the backend actually started it, so this really waits
  // for the whole run (both launches) to finish, not just begin.
  await expect.poll(() => running(page)).toEqual(expect.arrayContaining(["aed41005", "c31d92f1"]));
  await expect(row(page, "Etsy craft shop")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "FB Ads acc-02")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "TikTok creator")).toHaveAttribute("aria-selected", "true");
});

test("a second press on bulk Start while one is running starts nothing more", async ({ page }) => {
  await openApp(page);
  await pick(page, "Etsy craft shop");
  await pick(page, "FB Ads acc-02");
  const bar = page.getByRole("toolbar", { name: /selected/ });
  const startBtn = bar.getByRole("button", { name: "Start" });
  await startBtn.click();
  // Disabled while its own run is in flight (fix round 1, finding 2): a
  // disabled native button never dispatches a second click, so no parallel
  // loop can start.
  await expect(startBtn).toBeDisabled();
  // `running`, not `launched`: see the comment on the slow-Start test above —
  // `launched` flips as soon as each launch is invoked, not once it resolves.
  await expect.poll(() => running(page)).toEqual(expect.arrayContaining(["aed41005", "c31d92f1"]));
  // Only two launches total (no duplicate from a second, parallel run).
  expect(await launched(page)).toHaveLength(2);
  // The selection stays, success or not (owner fix 1, 2026-09-28).
  await expect(bar).toContainText("2 selected");
});

type Gpu = { __shardxMock: { state: { profiles: Record<string, { _meta: { gpu_preset_id: string } }> } } };
const gpu = (page: Page, id: string) => page.evaluate((id) => (window as unknown as Gpu).__shardxMock.state.profiles[id]._meta.gpu_preset_id, id);

test("a click on a field's caption changes nothing", async ({ page }) => {
  await openApp(page);
  // The labelled fields are the profile form's Fingerprint tab (manual save).
  const form = await openEditForm(page, "Amazon US seller", "Fingerprint");
  const save = form.getByRole("button", { name: "Save", exact: true });
  const caption = form.getByText("Operating system", { exact: true });
  const windows = caption.locator("..").getByRole("radio", { name: "Windows", exact: true });
  await expect(windows).toHaveAttribute("aria-checked", "true");
  await caption.click();
  await page.waitForTimeout(800);
  await expect(windows).toHaveAttribute("aria-checked", "true");
  expect(await gpu(page, "a78a0eea")).toBe("win11-rtx4070");
  await expect(form.getByRole("radiogroup", { name: "Operating system" })).toBeVisible();
  // Nothing in the form changed: Save still waits.
  await expect(save).toBeDisabled();

  const canvas = form.getByText("Canvas", { exact: true });
  const auto = canvas.locator("..").getByRole("radio", { name: "Auto noise" });
  await expect(auto).toHaveAttribute("aria-checked", "true");
  await canvas.click();
  await page.waitForTimeout(800);
  await expect(auto).toHaveAttribute("aria-checked", "true");
  await expect(save).toBeDisabled();
});
