import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, seedATag, type Theme } from "./support/app";
import { openSearch } from "./support/search";

// Audit Phase B, Task 14 fix round (owner, 2026-09-28): nothing is larger
// than it was before the grid (at the launcher's 14 px
// root), rounded down to a whole pixel. This guards every hold at 1280 x 800
// in both themes, to 0.5 px. Pre-grid values are in the comments.

const TOL = 0.5;
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });

async function box(loc: Locator) {
  await expect(loc.first()).toBeVisible();
  return (await loc.first().boundingBox())!;
}
async function expectSize(loc: Locator, size: { w?: number; h?: number }, what: string) {
  const b = await box(loc);
  if (size.w !== undefined) expect(Math.abs(b.width - size.w), `${what} width ${b.width}`).toBeLessThanOrEqual(TOL);
  if (size.h !== undefined) expect(Math.abs(b.height - size.h), `${what} height ${b.height}`).toBeLessThanOrEqual(TOL);
}
async function expectAtMost(loc: Locator, size: { w?: number; h?: number }, what: string) {
  const b = await box(loc);
  if (size.w !== undefined) expect(b.width, `${what} width`).toBeLessThanOrEqual(size.w + TOL);
  if (size.h !== undefined) expect(b.height, `${what} height`).toBeLessThanOrEqual(size.h + TOL);
}
const css = (loc: Locator, prop: string) => loc.first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
/** The element hit at a point, as the element itself or one inside it. */
const hits = (page: Page, loc: Locator, x: number, y: number) =>
  loc.first().evaluate((el, [px, py]) => {
    const at = document.elementFromPoint(px, py);
    return !!at && (at === el || el.contains(at));
  }, [x, y] as const);

for (const theme of ["dark", "light"] as const satisfies readonly Theme[]) {
  test.describe(`density holds, ${theme}`, () => {
    test("Profiles: header, list, menus, bulk bar, filters, empty state", async ({ page }) => {
      // Tags shows once a tag exists (Pair 27, F20); its header is right-clicked below.
      await seedATag(page);
      await openApp(page, { theme });
      const header = page.locator("main header");
      await expectSize(header, { h: 52 }, "page header"); // 52
      // xsmall controls: 30 (31.5).
      await expectSize(header.getByRole("button", { name: /New profile/ }), { h: 30 }, "New profile");
      await expectSize(header.getByRole("button", { name: "More actions" }), { w: 30, h: 30 }, "header More");
      await expectSize(header.getByRole("button", { name: "Filters", exact: true }), { h: 30 }, "Filters");
      await expectSize(header.getByRole("button", { name: "Display", exact: true }), { h: 30 }, "Display");
      await openSearch(page);
      const search = header.getByRole("searchbox").locator("xpath=..");
      await expectSize(search, { h: 30 }, "search frame");
      await expectAtMost(search, { w: 210 }, "search frame"); // 208 (210)
      await expectSize(header.locator("[data-filter]"), { w: 208 }, "header search"); // 208 (210)
      expect(await css(header.locator("[data-filter]"), "min-width")).toBe("126px"); // 126
      // The launcher's spacing steps are the pre-grid 3.5 px steps, floored
      // (src/app/styles/index.css): the header's gap-3 10 (10.5). The page
      // gutter is 16 inside the page panel (borderless, owner 2026-10-01;
      // 21 on the bare canvas before), the body under it on the same gutter.
      expect(await css(header, "padding-left")).toBe("16px");
      expect(await css(header, "column-gap")).toBe("10px");
      expect(await css(page.locator("main header + div"), "padding-left")).toBe("16px");

      // List select boxes 17 (17.5), tick and dash 12 (12.25). At rest a
      // row's box shows on its hover, and Select all in selection mode
      // (owner, 2026-10-01).
      const first = row(page, "Amazon US seller");
      await first.locator("[data-cell='status']").hover();
      const check = first.locator("[data-cell='checkbox'] input");
      await expectSize(check, { w: 17, h: 17 }, "row box");
      // FEEL-23: the box's target reaches 6 px past it on each side, inside
      // the 28 px select column (a 29 px target).
      const cb = await box(check);
      const label = first.locator("[data-cell='checkbox'] label");
      expect(await hits(page, label, cb.x - 5, cb.y + cb.height / 2)).toBe(true);
      expect(await hits(page, label, cb.x + cb.width + 5, cb.y + cb.height / 2)).toBe(true);
      expect(await hits(page, label, cb.x + cb.width / 2, cb.y - 5)).toBe(true);
      await check.check({ force: true });
      const all = page.locator("[role='row']:has([role='columnheader'])").first().locator("input[type=checkbox]");
      await expectSize(all, { w: 17, h: 17 }, "select-all box");
      await expectSize(first.locator("[data-cell='checkbox'] svg"), { w: 12, h: 12 }, "row tick");
      await expectSize(page.locator("[role='row']:has([role='columnheader'])").first().locator("svg").first(), { w: 12, h: 12 }, "select-all dash");
      await expectSize(page.getByRole("toolbar", { name: /selected/ }), { h: 35 }, "bulk bar"); // 35
      await page.keyboard.press("Escape");

      // The row menu: items 30 (30.5), at least 154 wide (its old 154).
      await first.locator("[data-cell='name']").click({ button: "right" });
      const menu = page.getByRole("menu");
      await expectSize(menu.getByRole("menuitem").first(), { h: 30 }, "menu item");
      expect(await css(menu, "min-width")).toBe("154px");
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);

      // The column menu's group label: 22 (22.75).
      await page.locator("[role='row']:has([role='columnheader'])").first().locator("[data-col='tags']").click({ button: "right" });
      await expectSize(page.getByRole("menu").getByText("Columns", { exact: true }), { h: 22 }, "menu group label");
      await page.keyboard.press("Escape");

      // Filters: an applied filter's chip (the kit Tag), 21 (21), side
      // padding 7 (7), gap 5 (5.25). The popover's country chips are gone (F19).
      await header.getByRole("button", { name: "Filters", exact: true }).click();
      await page.getByRole("option", { name: /^Status/ }).click();
      await page.getByRole("option", { name: /^Idle/ }).click();
      const chip = page.locator("[data-filter-chips] [data-chip]");
      await expectSize(chip, { h: 21 }, "filter chip");
      expect(await css(chip, "padding-left")).toBe("7px");
      expect(await css(chip, "column-gap")).toBe("5px");
      await page.locator("[data-filter-chips]").getByRole("button", { name: "Clear filters" }).click();

      // A filter with no match: the EmptyState tile 48 (49), its 14 px icon on a whole pixel.
      await (await openSearch(page)).fill("zzzz");
      await expectSize(page.locator("[data-empty-state] > div").first(), { w: 48, h: 48 }, "empty-state tile");
      // Its icon draws at 21 (owner: empty screens want a readable icon).
      await expectSize(page.locator("[data-empty-state] > div svg").first(), { w: 21, h: 21 }, "empty-state icon");
    });

    test("Trash: rows no taller than before Phase B, and the standard column header", async ({ page }) => {
      await openApp(page, { theme, section: "trash" });
      const grid = page.getByRole("treegrid", { name: "Trash" });
      // A row: 50 before the grid; the 13 px name made it 53. On
      // the list recipe (F25a) it is the lists' 36.
      await expectAtMost(grid.locator("[role='row'][data-row-id]"), { h: 50 }, "Trash row");
      // The column header: the standard one every table shares, Profiles'
      // 32 (owner, 2026-10-01: "all top rows need to be standartized"; 27
      // before Phase B).
      await expectSize(grid.locator("[role='row'][aria-rowindex='1']"), { h: 32 }, "Trash column header");
    });

    test("Sidebar group heading draws its pre-grid 24 px", async ({ page }) => {
      await openApp(page, { theme });
      // A sidebar group heading row: 24 (24.5; the h-7 step drew 28).
      const heading = page.locator("aside [data-group]").first().locator(":scope > div").first();
      await expectSize(heading, { h: 24 }, "sidebar group heading");
    });

    test("Peek: title, rows, notes, and the profile form's fingerprint editor", async ({ page }) => {
      await openApp(page, { theme });
      await row(page, "Amazon US seller").locator("[data-cell='name']").click();
      const peek = page.locator("aside[data-peek]");
      // Manual save: Peek only shows. The name is the title in the 40 px
      // header, and each property a 32 px row.
      await expectSize(peek.locator("[data-peek-header]"), { h: 40 }, "header");
      await expect(peek.locator("[data-peek-header]").getByRole("heading", { name: "Amazon US seller", level: 2 })).toBeVisible();
      const profile = peek.locator("[data-peek-section='profile']");
      await expectSize(profile.locator("[data-property='folder']"), { h: 32 }, "property row");
      // Notes is a row of the sheet (merge point 4 review, I7): never taller
      // than the old 91 px frame for a note of two lines.
      await expectAtMost(profile.locator("[data-property='notes']"), { h: 91 }, "notes row");
      await expectAtMost(profile, { h: 563 }, "profile section"); // the old overview's 563.25
      await expectSize(peek.locator("[data-peek-section='fingerprint'] [data-property='os']"), { h: 32 }, "fingerprint row");
      // The editor is the profile form's Fingerprint tab, opened by the section's Edit.
      await peek.locator("[data-peek-section='fingerprint']").getByRole("button", { name: "Edit", exact: true }).click();
      const form = page.getByRole("dialog", { name: "Edit Amazon US seller", exact: true });
      // Measured once it has scaled in (it opens from 0.96).
      await expect(form).toHaveAttribute("data-state", "open");
      await expect(form.getByRole("tab", { name: "Fingerprint" })).toHaveAttribute("aria-selected", "true");
      // The OS segment: frame 30 (31.5), tabs 24 (24.5).
      const os = form.getByRole("radiogroup", { name: "Operating system" });
      await expectSize(os, { h: 30 }, "segment frame");
      await expectSize(os.getByRole("radio").first(), { h: 24 }, "segment tab");
      // Ports to block: one line is 30 (31.5), the xsmall field's own frame
      // (C15, UI-34: it matches the fields beside it); its tags 21 (21).
      const ports = form.locator("label:has-text('Ports to block') > div");
      expect(await css(ports, "min-height")).toBe("30px");
      await expectSize(ports.locator("span").first(), { h: 21 }, "port tag");
    });

    test("New folder dialog: header, close, fields, swatches", async ({ page }) => {
      await openApp(page, { theme });
      await page.locator("aside").getByRole("button", { name: "New folder" }).click();
      const dialog = page.getByRole("dialog", { name: /New folder/ });
      // Measured once it has scaled in (it opens from 0.96).
      await expect(dialog).toHaveAttribute("data-state", "open");
      // The one shell (C20a): 14 above the title row and no divider under
      // it, so the row is its 35 px icon circle and the body's own 14 top
      // follows (64 with the old divider and bottom inset).
      await expectSize(dialog.locator(":scope > div").first(), { h: 49 }, "title row");
      // The whole dialog: 291, no taller than its 325 before the grid (its
      // Name field was 31.5 then, 30 now; its icon choices are 28, as then).
      // Borderless (owner, 2026-10-01) took 15 off its 306: the 1 px border
      // top and bottom, the footer's rule and 12 of the footer's 14 on top.
      // Its body's gap-4 is 14 (14) and each label-to-field gap-1.5 is 5 (5.25).
      await expectAtMost(dialog, { h: 325 }, "New folder dialog");
      await expectSize(dialog, { h: 291 }, "New folder dialog");
      const form = dialog.locator("form > div").first().locator(":scope > div").first();
      expect(await css(form, "row-gap")).toBe("14px");
      expect(await css(form, "padding-top")).toBe("14px");
      expect(await css(form.locator(":scope > div").nth(1), "row-gap")).toBe("5px");
      await expectSize(dialog.locator("span.rounded-full").first(), { w: 35, h: 35 }, "icon circle"); // 35
      // The close button draws at 21 (21) with a 24 px hit area.
      const close = dialog.getByRole("button", { name: "Close" });
      const c = await box(close);
      expect(Math.abs(c.width - 21)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(c.height - 21)).toBeLessThanOrEqual(TOL);
      expect(await hits(page, close, c.x - 1, c.y + c.height / 2)).toBe(true);
      expect(await hits(page, close, c.x + c.width + 1, c.y + c.height / 2)).toBe(true);
      expect(await hits(page, close, c.x - 3, c.y + c.height / 2)).toBe(false);
      // The body: the dialog's 14 px sides (the controller's ruling
      // on Pair 29), so the field is no wider than 451 in the same dialog.
      const field = dialog.getByRole("textbox").first().locator("xpath=..");
      await expectSize(field, { h: 30 }, "name field");
      await expectAtMost(field, { w: 451 }, "name field");
      await expectSize(dialog.getByRole("button", { name: "Cancel" }), { h: 30 }, "Cancel");
      // Folder icon choices 28 (28).
      await expectSize(dialog.getByRole("radiogroup", { name: "Icon" }).getByRole("radio").first(), { w: 28, h: 28 }, "icon choice");
      // Colour swatches draw at 21 (21) with a 24 px hit area; a point
      // between two swatches is neither's, so a click lands on the nearest.
      const swatches = dialog.getByRole("radiogroup", { name: "Color" }).getByRole("radio");
      const a = await box(swatches.nth(1));
      const b = await box(swatches.nth(2));
      expect(Math.abs(a.width - 21)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(a.height - 21)).toBeLessThanOrEqual(TOL);
      expect(await hits(page, swatches.nth(1), a.x + a.width + 1, a.y + a.height / 2)).toBe(true);
      expect(await hits(page, swatches.nth(2), b.x - 1, b.y + b.height / 2)).toBe(true);
      const mid = (a.x + a.width + b.x) / 2;
      expect(await hits(page, swatches.nth(1), mid, a.y + a.height / 2)).toBe(false);
      expect(await hits(page, swatches.nth(2), mid, a.y + a.height / 2)).toBe(false);
    });

    test("Shortcut sheet, command palette, tag picker", async ({ page }) => {
      await page.addInitScript(() => {
        if (localStorage.getItem("shardx.tags") === null) {
          localStorage.setItem("shardx.tags", JSON.stringify({ version: 1, tags: [{ id: "t-vip", name: "VIP", color: "violet" }], byProfile: {} }));
        }
      });
      await openApp(page, { theme });
      await row(page, "Sandbox").locator("[data-cell='status']").click();
      // The one close button (C20a, owner): 21 with a 24 px hit area.
      await page.keyboard.type("?");
      const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
      await expect(sheet).toHaveAttribute("data-state", "open");
      await expectSize(sheet.getByRole("button", { name: "Close" }), { w: 21, h: 21 }, "modal close");
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      // The tag picker's box (the kit Combobox draws the Checkbox's): 17, tick 12.
      await page.keyboard.press("t");
      const picker = page.getByRole("dialog").filter({ has: page.getByRole("combobox", { name: "Find or create a tag" }) });
      await expect(picker).toHaveAttribute("data-state", "open");
      const option = picker.getByRole("option", { name: /VIP/ });
      const tick = option.locator("span[aria-hidden='true']").first();
      await expectSize(tick, { w: 17, h: 17 }, "picker checkbox");
      // Ticked as a user would, by its row's tag name.
      await picker.getByText("VIP", { exact: true }).click();
      await expect(option).toHaveAttribute("aria-selected", "true");
      await expectSize(tick.locator("svg"), { w: 12, h: 12 }, "picker tick");
      await page.keyboard.press("Escape");
      // The bare search (C15, UI-31): no box of its own, 40 px, the old
      // row's 3 + 34 + 3 (35), so the panel does not grow.
      await page.keyboard.press("ControlOrMeta+k");
      const palette = page.getByRole("combobox", { name: "Search commands" });
      await expect(page.getByRole("dialog").filter({ has: palette })).toHaveAttribute("data-state", "open");
      await expectSize(palette.locator("xpath=.."), { h: 40 }, "palette field");
    });

    test("Settings: card inset, tabs, Select, Switch, chips", async ({ page }) => {
      await openApp(page, { theme, section: "settings" });
      // A setting row inside the card's 14 px sides at least. The column runs
      // to the page's edge (owner, 2026-10-23; settings-rows.spec), so the
      // row's width is the window's, not 612 px.
      const setting = page.locator("main [data-setting]").first();
      const [rowBox, cardBox] = [await box(setting), await box(setting.locator("xpath=.."))];
      expect(cardBox.width - rowBox.width, "settings row inset").toBeGreaterThanOrEqual(28 - TOL);
      const tabs = page.getByRole("tablist", { name: "Settings sections" });
      // Vertical tabs 30 (30.5), px-2 like menu items.
      await expectSize(tabs.getByRole("tab").first(), { h: 30 }, "vertical tab");
      expect(await css(tabs.getByRole("tab").first(), "padding-left")).toBe("8px");
      await tabs.getByRole("tab", { name: "Appearance" }).click();
      const trigger = page.getByRole("combobox", { name: "Interface size" });
      await expectSize(trigger, { h: 30 }, "select trigger");
      await trigger.click();
      const option = page.getByRole("option").first();
      await expectSize(option, { h: 30 }, "select option"); // 30 (34)
      expect(await css(option, "padding-left")).toBe("8px");
      await page.keyboard.press("Escape");
      // Switch 17 x 28 (17.5 x 28), knob 13 (14): the kit Switch, Reduce motion.
      const sw = page.getByRole("switch", { name: "Reduce motion" });
      await expectSize(sw, { w: 28, h: 17 }, "switch");
      await expectSize(sw.locator("xpath=following-sibling::span[1]"), { w: 13, h: 13 }, "switch knob");
      // Helper: small chips 24 (24.5), side padding 7 (7), gap 3 (3.5).
      await tabs.getByRole("tab", { name: /Helper/ }).click();
      const chip = page.getByRole("button", { name: "First name", exact: true });
      await expectSize(chip, { h: 24 }, "chip small");
      expect(await css(chip, "padding-left")).toBe("7px");
      expect(await css(chip, "column-gap")).toBe("3px");
    });
  });
}

// Owner live feedback (2026-09-29): the flag sat visibly above the proxy
// text. The flag's box centre must match the text's cap-height centre.
/** Vertical centre of a text element's capital letters: its real baseline
 * minus half the font's cap height (canvas font metrics). */
async function capCentre(loc: Locator) {
  return loc.first().evaluate((el) => {
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = ctx.measureText("H");
    // The baseline, read off a zero-height inline-block probe inside the text.
    const probe = document.createElement("span");
    probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    el.appendChild(probe);
    const baseline = probe.getBoundingClientRect().bottom;
    probe.remove();
    return baseline - m.actualBoundingBoxAscent / 2;
  });
}
test("Profiles: the proxy flag and its name share one centre", async ({ page }) => {
  await openApp(page, { theme: "dark" });
  // F7 (Task 17): the cell names the proxy; the type and address moved to its tooltip.
  const cell = page.locator("[role='row'][data-profile-id] [data-cell='proxy']")
    .filter({ has: page.locator("[data-flag]") }).filter({ has: page.locator("[data-proxy-name]") }).first();
  const fb = (await box(cell.locator("[data-flag]")))!;
  const flagCentre = fb.y + fb.height / 2;
  const off = flagCentre - (await capCentre(cell.locator("[data-proxy-name]")));
  console.log(`flag vs name: ${off.toFixed(2)} px`);
  expect(Math.abs(off), "flag centre vs name cap centre").toBeLessThanOrEqual(TOL);
});
