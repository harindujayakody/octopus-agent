import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// IFACE-11: every list page keeps one keyboard contract. Rows: one Tab stop,
// ArrowDown (ArrowRight in a card grid) moves it, Home and End reach the
// ends. Tables: the standard header on the card color, framed by a real border
// (owner rule) or, borderless (owner, 2026-10-01), sitting on a tile. Every list as it is now: the Profiles and Proxies treegrids and the
// DataList pages (tables and card grids).
const LISTS = [
  { section: "profiles", role: "treegrid", row: "[role='row'][data-profile-id]" },
  { section: "proxies", role: "treegrid", row: "[role='row'][data-proxy-id]" },
  { section: "trash", role: "treegrid", row: "[role='row'][data-row-id]" },
  { section: "bookmarks", role: "treegrid", row: "[role='row'][data-row-id]" },
  { section: "extensions", role: "list", row: "[role='listitem'][data-row-id]" },
  { section: "fingerprints", role: "list", row: "[role='listitem'][data-row-id]" },
] as const;

const tabStops = (page: Page, sel: string) => page.locator(`main ${sel}[tabindex='0']`).count();

for (const l of LISTS) {
  test(`${l.section}: one Tab stop, arrows move it, Home and End reach the ends`, async ({ page }) => {
    await openApp(page, { section: l.section });
    const rows = page.locator(`main ${l.row}`);
    await expect(rows.first()).toBeVisible();
    expect(await rows.count(), "a list of two or more").toBeGreaterThan(1);
    expect(await tabStops(page, l.row)).toBe(1);
    await rows.first().focus();
    await page.keyboard.press(l.role === "list" ? "ArrowRight" : "ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    expect(await tabStops(page, l.row)).toBe(1);
    await page.keyboard.press("End");
    await expect(rows.last()).toBeFocused();
    await page.keyboard.press("Home");
    await expect(rows.first()).toBeFocused();
  });
}

// The header row is the standard header (owner, 2026-10-01: "remove grey bg
// under tables headers rows"): the sticky material in the list's own color,
// translucent over the card, that reads as the card at rest. Composited over
// the card, it must be the card. Every list is a kit list tile now, with no
// border (borderless, owner 2026-10-01; Profiles and Proxies since vf-f).
const FRAMED: string[] = [];
for (const section of ["profiles", "proxies", "trash", "bookmarks"] as const) {
  test(`${section}: the table has the standard header on the card color, under a real border or on a tile (owner rule)`, async ({ page }) => {
    await openApp(page, { section });
    const grid = page.locator("main [role='treegrid']").first();
    const header = grid.getByRole("row").first();
    // At rest a selecting list's select column shows no box (selection
    // mode, owner 2026-10-01): its first visible header cell is enough.
    await expect(header.getByRole("columnheader").filter({ visible: true }).first()).toBeVisible();
    const colors = await page.evaluate(() => {
      const g = document.querySelector("main [role='treegrid']")!;
      const h = g.querySelector("[role='row']")! as HTMLElement;
      const frame = (g.closest(".list-tile, [class*='border']") as HTMLElement | null) ?? (g as HTMLElement);
      const panel = getComputedStyle(document.querySelector("main")!).backgroundColor;
      const card = getComputedStyle(frame).backgroundColor;
      const fill = getComputedStyle(h).backgroundColor;
      const paint = (...layers: string[]) => {
        const c = document.createElement("canvas");
        c.width = 1;
        c.height = 1;
        const x = c.getContext("2d")!;
        for (const layer of layers) { x.fillStyle = layer; x.fillRect(0, 0, 1, 1); }
        return [...x.getImageData(0, 0, 1, 1).data].join(",");
      };
      const tile = frame.classList.contains("list-tile");
      return {
        fill,
        header: paint(panel, card, fill),
        card: paint(panel, card),
        edge: tile ? `tile ${getComputedStyle(frame).borderTopLeftRadius}` : getComputedStyle(frame).borderTopWidth,
      };
    });
    expect(colors.fill, "the header has a fill of its own").not.toBe("rgba(0, 0, 0, 0)");
    expect(colors.header).toBe(colors.card);
    expect(colors.edge).toBe(FRAMED.includes(section) ? "1px" : "tile 10px");
  });
}
