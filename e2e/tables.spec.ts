import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, reloadApp, type Theme } from "./support/app";

// Borderless (owner, 2026-10-01): a table sits on a tile, the weak fill and
// the tile's corner, no border, and its header is not the page's own grey.

const style = (l: Locator, prop: string) => l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const pageBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

for (const theme of ["light", "dark"] as Theme[]) {
  // Step 2 (owner, 2026-10-01): the lists' frames are tiles too: a wrapper
  // round the scroll box with no border, and the header's first label in from
  // the tile's edge by the tile's inset (4), the cell padding (12) and, since
  // the select box has its own slot before Name (owner, 2026-10-07), that
  // slot (38): 54. The select box's own header cell starts 6 px in.
  for (const [section, name] of [["profiles", undefined], ["proxies", "Proxies"]] as const) {
    test(`the ${section} table sits on a tile with no border, its header label 54 px in, after the select slot (${theme})`, async ({ page }) => {
      await openApp(page, { section, theme });
      const grid = name ? page.getByRole("treegrid", { name }) : page.getByRole("treegrid");
      const tile = grid.locator("xpath=..");
      const header = grid.locator("[role='row'][aria-rowindex='1']");
      await expect(tile).toHaveClass(/list-tile/);
      expect(await style(tile, "border-top-width")).toBe("0px");
      expect(await style(tile, "border-top-left-radius")).toBe("10px");
      expect(await style(header, "background-color")).not.toBe(await pageBg(page));
      const slot = (await header.getByRole("columnheader").filter({ visible: true }).first().boundingBox())!;
      expect(Math.round(slot.x - (await tile.boundingBox())!.x)).toBe(6);
      const label = (await header.locator("[data-col-title]").first().boundingBox())!;
      expect(Math.round(label.x - (await tile.boundingBox())!.x)).toBe(54);
    });
  }

  for (const [section, column] of [["trash", "Name"]] as const) {
    test(`the ${section} table sits on a tile with no border, its header not the page grey (${theme})`, async ({ page }) => {
      await openApp(page, { section, theme });
      const header = page.locator("main :is(.tile, .list-tile) > div", { hasText: column }).first();
      const frame = header.locator("xpath=..");
      // No visible edge: a list tile's inset is a transparent border.
      expect(["0px", "rgba(0, 0, 0, 0)"]).toContain(await frame.evaluate((el) => {
        const cs = getComputedStyle(el);
        return cs.borderTopWidth === "0px" ? "0px" : cs.borderTopColor;
      }));
      expect(await style(frame, "border-top-left-radius")).toBe("10px");
      // In light the white tile floats on the softest shadow (light flip); never a ring.
      expect(await style(frame, "box-shadow")).not.toMatch(/0px 0px 0px [1-9]/);
      expect(await style(header, "background-color")).not.toBe(await pageBg(page));
    });
  }
}

// The Phase B paper cut, pulled forward from F24 Step 3 (Pair 2 review,
// Important 1): a bottom border left 35 px for a row's content, which
// centred it on a half pixel. The line now takes no layout. Variant b
// (borderless, owner 2026-10-01): it is inset 12 px from both ends of the
// row, in the hairline color.
for (const [section, rowSel] of [["profiles", "[role='row'][data-profile-id]"], ["proxies", "[role='row'][data-proxy-id]"]] as const) {
  test(`${section}: a row's content centers in its 36 px, under a line that takes no layout`, async ({ page }) => {
    await openApp(page, { section, theme: "light" });
    const row = page.locator(rowSel).first();
    await expect(row).toHaveCSS("border-bottom-width", "0px");
    const r = (await row.boundingBox())!;
    expect(r.height).toBe(36);
    const name = (await row.locator("[data-cell='name']").boundingBox())!;
    expect(Math.abs(name.y + name.height / 2 - (r.y + r.height / 2))).toBeLessThanOrEqual(0.5);
    const line = await row.evaluate((el) => {
      const cs = getComputedStyle(el, "::after");
      // The hairline is the stroke token, whatever its alpha (the owner's
      // lighter borders took it from 10 to 7 percent at merge point 7),
      // laid over the tile's own fill: opaque, so it reads the same over every
      // row fill (owner bug, 2026-10-01: never heavier on hover).
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--stroke-soft-200)";
      el.appendChild(probe);
      const hairline = getComputedStyle(probe).backgroundColor;
      probe.remove();
      // Under the line: the tile's own opaque fill (`--list-fill`), whatever the row's.
      probe.style.backgroundColor = "var(--bg-tile)";
      el.appendChild(probe);
      const card = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { h: cs.height, w: parseFloat(cs.width), inset: [cs.left, cs.right], top: cs.top, under: cs.backgroundColor, over: cs.backgroundImage, card, hairline, rowW: parseFloat(getComputedStyle(el).width) };
    });
    // On the row's top edge (merge point 11: the line between two rows is the lower one's).
    expect(line).toEqual({ h: "1px", w: line.rowW - 24, inset: ["12px", "12px"], top: "0px", under: line.card, over: `linear-gradient(${line.hairline}, ${line.hairline})`, card: line.card, hairline: line.hairline, rowW: line.rowW });
    expect(line.hairline).not.toBe("rgba(0, 0, 0, 0)");
  });
}

// Pair 3 review, Minor 4: the line belongs to these two lists' rows. Any
// other row that carries a selection state (the kit DataList draws its own
// separator) gets none from them, or it would wear two.
test("the row line is only the Profiles and Proxies rows'", async ({ page }) => {
  await openApp(page, { theme: "light" });
  const after = await page.evaluate(() => {
    const other = document.createElement("div");
    other.setAttribute("role", "row");
    other.setAttribute("aria-selected", "false");
    document.querySelector("main")!.append(other);
    const content = getComputedStyle(other, "::after").content;
    other.remove();
    return content;
  });
  expect(after).toBe("none");
  expect(await page.locator("[role='row'][data-profile-id]").first().evaluate((el) => getComputedStyle(el, "::after").content)).toBe('""');
});

// F24 (A11Y-08, ruling 14): the lists are treegrids of rows; the header's
// cells are named by their own text (the select-all box by its own name);
// the placeholder rows are hidden inside the busy list.
test("the lists are treegrids of rows, with named header cells and states outside them (A11Y-08)", async ({ page }) => {
  await openApp(page);
  const grid = page.getByRole("treegrid", { name: "Profiles" });
  await expect(grid.getByRole("row").nth(1)).toHaveAttribute("aria-level", "1");
  // The select column's cell holds Select all, hidden at rest (selection
  // mode, owner 2026-10-01): a box, though not one a screen reader meets yet.
  const empties = grid.getByRole("columnheader").filter({ hasText: /^$/ }).filter({ hasNot: page.locator("input[type='checkbox']") });
  await expect(empties).toHaveCount(0);
  await openApp(page, { section: "proxies" });
  await expect(page.getByRole("treegrid", { name: "Proxies" }).getByRole("row").nth(1)).toHaveAttribute("aria-level", "1");
});

test("a row's content centers in its 36 px, with no half-pixel border (Phase B paper cut)", async ({ page }) => {
  await openApp(page);
  const row = page.locator("[role='row'][data-profile-id]").first();
  await expect(row).toHaveCSS("border-bottom-width", "0px");
  const r = (await row.boundingBox())!;
  const name = (await row.locator("[data-cell='name']").boundingBox())!;
  expect(Math.abs(name.y + name.height / 2 - (r.y + r.height / 2))).toBeLessThanOrEqual(0.5);
});

// F26 (CRAFT-27, LAYOUT-13, CRAFT-03, IFACE-11): Bookmarks is a real table:
// a header row, 36 px rows, the address without its scheme, no red Delete on
// every row (Delete is in the row's menu), and a row opens from the keyboard.
test("Bookmarks has a header row, 36 px rows, addresses without the scheme and quiet actions (CRAFT-27)", async ({ page }) => {
  await openApp(page, { section: "bookmarks" });
  const grid = page.getByRole("treegrid", { name: "Bookmarks" });
  await expect(grid.getByRole("columnheader")).toContainText(["Name", "Address", "Shows in"]);
  const row = grid.locator("[role='row'][data-row-id]").first();
  expect((await row.boundingBox())!.height).toBe(36);
  await expect(row.locator("[data-cell='address']")).not.toContainText("https://");
  await expect(row.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Edit bookmark" })).toBeVisible();
});

// Owner (2026-09-30): every list's layout is saved, Bookmarks' too.
test("a Bookmarks sort chosen in a column's menu comes back after a restart (owner: layouts persist)", async ({ page }) => {
  await openApp(page, { section: "bookmarks" });
  const grid = page.getByRole("treegrid", { name: "Bookmarks" });
  await grid.locator("[data-col='name']").click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Descending" }).click();
  await expect(grid.locator("[data-col='name']")).toHaveAttribute("aria-sort", "descending");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("shardx.bookmarks.layout") ?? "null")?.sort)).toEqual({ id: "name", dir: "descending" });
  await reloadApp(page);
  await expect(grid.locator("[data-col='name']")).toHaveAttribute("aria-sort", "descending");
});

// F27 (CRAFT-03, UI-39): an extension card's Remove is in its menu, not a red
// button on every card; every card in a row lines up at the bottom.
test("extension cards: Remove in the card's menu, the action row lined up (CRAFT-03, UI-39)", async ({ page }) => {
  await openApp(page, { section: "extensions" });
  const cards = page.getByRole("list", { name: "Extensions" }).getByRole("listitem");
  await expect(cards.first().getByRole("button", { name: "Remove" })).toHaveCount(0);
  const bottoms = await cards.evaluateAll((els) => {
    const rows = new Map<number, number[]>();
    for (const el of els) {
      const r = el.firstElementChild!.getBoundingClientRect();
      rows.set(Math.round(r.top), [...(rows.get(Math.round(r.top)) ?? []), Math.round(r.bottom)]);
    }
    return [...rows.values()];
  });
  for (const row of bottoms) expect(new Set(row).size).toBe(1);
  await cards.first().hover();
  await cards.first().getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: /Remove/ })).toBeVisible();
});

// F27 (IFACE-11, CRAFT-30): the fingerprint grid is one Tab stop, arrows
// move, Enter opens Peek; a card does not repeat the engine's own Chrome.
test("fingerprint cards: one Tab stop, arrows move, Enter opens Peek; no repeated lines (IFACE-11, CRAFT-30)", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  const cards = page.locator("main").getByRole("listitem");
  await expect(page.locator("main [role='listitem'][tabindex='0']")).toHaveCount(1);
  await cards.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("aside[data-peek='fingerprint']")).toBeVisible();
  await expect(cards.nth(1)).toHaveAttribute("aria-current", "true");
  // The engine's own Chrome version (the mock's gpu_caps.engine_version) is not repeated on every card.
  await expect(page.locator("[data-fingerprint-id]").filter({ hasText: "Chrome 152.0.7977.65" })).toHaveCount(0);
});
