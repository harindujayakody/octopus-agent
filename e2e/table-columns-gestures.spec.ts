import { expect, test, type Locator, type Page } from "@playwright/test";
import { appModule, openApp, row, titles } from "./support/app";

// Dragging a title to reorder and an edge to resize (owner feature
// 2026-09-26), and the keyboard's way to both.
const header = (page: Page) => page.locator("[role='row'][aria-rowindex='1']");
const cellOf = (page: Page, id: string) => header(page).locator(`[data-col='${id}']`);
const edge = (page: Page, id: string) => header(page).locator(`[data-col-edge='${id}']`);
const width = (loc: Locator) => loc.evaluate((el) => Math.round(el.getBoundingClientRect().width));
const htmlCursor = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).cursor);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("shardx.profiles.layout") ?? "null"));
const said = (page: Page) => page.locator("[data-column-status]");
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
const DEFAULT = ["Name", "Status", "Folder", "Tags", "Proxy", "Notes"];
const TAGS = { version: 1, tags: [{ id: "t-warm", name: "Warm-up", color: "orange" }], byProfile: { aed41005: ["t-warm"] } };

test.beforeEach(async ({ page }) => {
  await page.addInitScript((v) => { if (localStorage.getItem("shardx.tags") === null) localStorage.setItem("shardx.tags", JSON.stringify(v)); }, TAGS);
});

/** Presses a title and moves past the 4 px that make it a drag. */
async function pressTitle(page: Page, id: string) {
  const b = (await cellOf(page, id).boundingBox())!;
  await page.mouse.move(b.x + 6, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 2 });
}
async function rightPartOf(page: Page, id: string) {
  const b = (await cellOf(page, id).boundingBox())!;
  return { x: b.x + b.width - 4, y: b.y + b.height / 2 };
}
async function dragEdge(page: Page, id: string, dx: number, { release = true } = {}) {
  const e = (await edge(page, id).boundingBox())!;
  await page.mouse.move(e.x + e.width / 2, e.y + e.height / 2);
  await page.mouse.down();
  await page.mouse.move(e.x + e.width / 2 + dx, e.y + e.height / 2, { steps: 6 });
  if (release) await page.mouse.up();
}

test("a title drags to a new place: grab cursor, a marker and a ghost while it moves; the rows follow, it is said and kept", async ({ page }) => {
  await openApp(page);
  expect(await cellOf(page, "tags").evaluate((el) => getComputedStyle(el).cursor)).toBe("grab");
  const to = await rightPartOf(page, "proxy");
  await pressTitle(page, "tags");
  await page.mouse.move(to.x, to.y, { steps: 5 });
  expect(await htmlCursor(page)).toBe("grabbing");
  await expect(header(page).locator("[data-column-drop]")).toBeVisible();
  await expect(page.locator("[data-column-ghost]")).toHaveText("Tags");
  await page.mouse.up();
  expect(await titles(page)).toEqual(["Name", "Status", "Folder", "Proxy", "Tags", "Notes"]);
  expect(await row(page, "Etsy craft shop").locator("[data-cell]").evaluateAll((els) => els.map((e) => e.getAttribute("data-cell"))))
    .toEqual(["checkbox", "name", "status", "folder", "proxy", "tags", "notes", "actions"]);
  await expect(said(page)).toHaveText("Tags moved to position 5 of 6");
  expect(await htmlCursor(page)).toBe("auto");
  await expect(page.locator("[data-column-ghost]")).toHaveCount(0);
  const order: string[] = (await stored(page)).order;
  expect(order.indexOf("tags")).toBeGreaterThan(order.indexOf("proxy"));
});

test("Esc during a drag leaves the order as it was, and only ends the drag (Review Focus 3)", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='checkbox'] input").check({ force: true });
  const to = await rightPartOf(page, "proxy");
  await pressTitle(page, "tags");
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await titles(page)).toEqual(DEFAULT);
  await expect(page.locator("[data-column-ghost]")).toHaveCount(0);
  await expect(header(page).locator("[data-column-drop]")).toHaveCount(0);
  expect(await htmlCursor(page)).toBe("auto");
  expect(await stored(page)).toBeNull();
  // The list's own Esc (clear the selection) never heard it.
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(1);
});

test("a title let go outside the header cancels the drag: over the rows, order unchanged, no marker there (Review Focus 3; fix round 1 item 5)", async ({ page }) => {
  await openApp(page);
  const to = await rightPartOf(page, "proxy");
  await pressTitle(page, "tags");
  await page.mouse.move(to.x, to.y + 150, { steps: 6 });
  // Outside the header there is nowhere to land: the marker hides.
  await expect(header(page).locator("[data-column-drop]")).toHaveCount(0);
  await page.mouse.up();
  expect(await titles(page)).toEqual(DEFAULT);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("a title let go over the sidebar also cancels the drag: order unchanged (fix round 1 item 5)", async ({ page }) => {
  await openApp(page);
  await pressTitle(page, "tags");
  // Well clear of the header and the list, over the sidebar's nav.
  await page.mouse.move(40, 300, { steps: 6 });
  await expect(page.locator("[data-column-ghost]")).toBeVisible();
  await expect(header(page).locator("[data-column-drop]")).toHaveCount(0);
  await page.mouse.up();
  expect(await titles(page)).toEqual(DEFAULT);
});

test("Name can't be dragged, and nothing lands before it", async ({ page }) => {
  await openApp(page);
  expect(await cellOf(page, "name").evaluate((el) => getComputedStyle(el).cursor)).not.toBe("grab");
  const name = (await cellOf(page, "name").boundingBox())!;
  await pressTitle(page, "status");
  await page.mouse.move(name.x + 4, name.y + name.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await titles(page)).toEqual(DEFAULT);
  await pressTitle(page, "tags");
  await page.mouse.move(name.x + 4, name.y + name.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await titles(page)).toEqual(["Name", "Tags", "Status", "Folder", "Proxy", "Notes"]);
});

// The row stretches to the list (owner, 2026-10-23): an edge is the border
// with the next column, which gives the px (past its content, the one after
// it), so the columns before it hold still. Only the dragged column is kept.
test("an edge drags to resize: col-resize cursor, the rows follow, the columns after it give the room; only it is kept; a double click puts it back", async ({ page }) => {
  await openApp(page);
  expect(await edge(page, "tags").evaluate((el) => getComputedStyle(el).cursor)).toBe("col-resize");
  const before = await width(cellOf(page, "tags"));
  const right = (id: string) => cellOf(page, id).evaluate((el) => Math.round(el.getBoundingClientRect().right));
  const folderEnd0 = await right("folder");
  const notesEnd0 = await right("notes");
  // More than Proxy has past its content: Notes gives the rest.
  await dragEdge(page, "tags", 60, { release: false });
  expect(await htmlCursor(page)).toBe("col-resize");
  near(await width(cellOf(page, "tags")), before + 60);
  near(await width(row(page, "Etsy craft shop").locator("[data-cell='tags']")), before + 60);
  near(await right("folder"), folderEnd0);
  near(await right("notes"), notesEnd0);
  await page.mouse.up();
  // Nothing moves when it lets go.
  near(await width(cellOf(page, "tags")), before + 60);
  near(await right("folder"), folderEnd0);
  const kept = (await stored(page)).widths;
  expect(Object.keys(kept)).toEqual(["tags"]);
  near(kept.tags, before + 60);
  expect(await htmlCursor(page)).toBe("auto");
  await edge(page, "tags").dblclick();
  expect((await stored(page)).widths).toEqual({});
  near(await width(cellOf(page, "tags")), before);
});

test("a resize past a column's range stops at its minimum or maximum, and in a full row where the columns before it would have to give; a row with no room to spare scrolls inside its card, never the page (Review Focus 3, 5)", async ({ page }) => {
  await openApp(page);
  // Proxy: its content (a flag, a type and an address) sets it well over its 80 px minimum.
  await dragEdge(page, "proxy", -400);
  expect((await stored(page)).widths.proxy).toBe(80);
  // A stretched row: Status past its 240 px max, as far as the columns after it give; Name stays where it was.
  const name = await width(cellOf(page, "name"));
  await dragEdge(page, "status", 400);
  const status = (await stored(page)).widths.status;
  expect(status).toBeGreaterThan(240);
  near(await width(cellOf(page, "status")), status);
  near(await width(cellOf(page, "name")), name);
  // Name can take no more than the columns after it can give: the row never scrolls for it.
  await dragEdge(page, "name", 900);
  const grid = page.getByRole("treegrid", { name: "Profiles" });
  expect(await grid.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("in a row with no room to spare a column grows as before, to its maximum, and the list scrolls inside its card, never the page", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page);
  const grid = page.getByRole("treegrid", { name: "Profiles" });
  await dragEdge(page, "proxy", 500);
  expect((await stored(page)).widths.proxy).toBe(480);
  expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("an edge answers the keyboard: the arrows, Home and End, by the drag's rule; Shift+F10 opens its column's menu", async ({ page }) => {
  await openApp(page);
  await edge(page, "tags").focus();
  await expect(edge(page, "tags")).toHaveAccessibleName("Resize Tags");
  const v0 = Number(await edge(page, "tags").getAttribute("aria-valuenow"));
  // The value is the width on screen.
  near(v0, await width(cellOf(page, "tags")));
  const folderEnd0 = await cellOf(page, "folder").evaluate((el) => Math.round(el.getBoundingClientRect().right));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(edge(page, "tags")).toHaveAttribute("aria-valuenow", String(v0 + 16));
  near(await width(cellOf(page, "tags")), v0 + 16);
  near(await cellOf(page, "folder").evaluate((el) => Math.round(el.getBoundingClientRect().right)), folderEnd0);
  await page.keyboard.press("Home");
  await expect(edge(page, "tags")).toHaveAttribute("aria-valuenow", "64");
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu", { name: "Tags column" })).toBeVisible();
  // Move left is the first item and has the keyboard.
  await page.keyboard.press("Enter");
  expect(await titles(page)).toEqual(["Name", "Status", "Tags", "Folder", "Proxy", "Notes"]);
  await expect(said(page)).toHaveText("Tags moved to position 3 of 6");
  await expect(edge(page, "tags")).toBeFocused();
  // End: as wide as the columns after it can make room for, in a row that still fits.
  await page.keyboard.press("End");
  await expect.poll(async () => Number(await edge(page, "tags").getAttribute("aria-valuenow"))).toBeGreaterThan(64);
  near(Number(await edge(page, "tags").getAttribute("aria-valuenow")), await width(cellOf(page, "tags")));
  const grid = page.getByRole("treegrid", { name: "Profiles" });
  expect(await grid.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

// The last column's edge is the row's end in a stretched row: no pointer
// handle there (its width comes from the border before it); the keys still
// size it, from the border on its left.
test("the last column's edge takes no drag in a full row; its keys move the border before it", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 800 });
  await openApp(page);
  const notes = edge(page, "notes");
  expect(await notes.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  const proxyStart = await cellOf(page, "proxy").evaluate((el) => Math.round(el.getBoundingClientRect().left));
  const w0 = await width(cellOf(page, "notes"));
  await notes.focus();
  await page.keyboard.press("ArrowRight");
  near(await width(cellOf(page, "notes")), w0 + 8);
  near(await cellOf(page, "proxy").evaluate((el) => Math.round(el.getBoundingClientRect().left)), proxyStart);
  expect(Object.keys((await stored(page)).widths)).toEqual(["notes"]);
});

test("Esc during a resize puts the width back (Review Focus 3)", async ({ page }) => {
  await openApp(page);
  const before = await width(cellOf(page, "tags"));
  await dragEdge(page, "tags", 80, { release: false });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  near(await width(cellOf(page, "tags")), before);
  expect(await stored(page)).toBeNull();
  expect(await htmlCursor(page)).toBe("auto");
});

test("a drag that loses its element (the list's section changes mid-gesture) ends: the cursor lock is gone (fix round 1 item 4)", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/shared/model/navigation.ts", "__nav");
  await pressTitle(page, "tags");
  await page.mouse.move(200, 100, { steps: 3 });
  expect(await htmlCursor(page)).toBe("grabbing");
  // The list (and the drag hook with it) unmounts mid-gesture, without the
  // pointer ever letting go.
  await page.evaluate(() => {
    const w = window as unknown as { __nav: { useNav: { getState: () => { setSection: (s: string) => void } } } };
    w.__nav.useNav.getState().setSection("proxies");
  });
  await expect(page.getByRole("treegrid", { name: "Proxies" })).toBeVisible();
  expect(await htmlCursor(page)).toBe("auto");
  await expect(page.locator("html[data-column-gesture]")).toHaveCount(0);
});

test("a resize that loses its element (the list's section changes mid-gesture) ends: the cursor lock is gone (fix round 1 item 4)", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/shared/model/navigation.ts", "__nav");
  await dragEdge(page, "tags", 60, { release: false });
  expect(await htmlCursor(page)).toBe("col-resize");
  await page.evaluate(() => {
    const w = window as unknown as { __nav: { useNav: { getState: () => { setSection: (s: string) => void } } } };
    w.__nav.useNav.getState().setSection("proxies");
  });
  await expect(page.getByRole("treegrid", { name: "Proxies" })).toBeVisible();
  expect(await htmlCursor(page)).toBe("auto");
  await expect(page.locator("html[data-column-gesture]")).toHaveCount(0);
});

test("Shift+F10 on an edge, then hiding that column from its own menu: the menu closes and focus lands on the neighbor edge (fix round 1 item 3)", async ({ page }) => {
  await openApp(page);
  await edge(page, "tags").focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Tags column" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitemcheckbox", { name: "Tags" }).click();
  await expect(menu).toHaveCount(0);
  // Tags stood between Folder and Proxy: Proxy now stands where it did.
  await expect(edge(page, "proxy")).toBeFocused();
  // The header still behaves: the neighbor edge answers its own keys
  // normally, nothing is left stuck by the menu that just closed.
  const v0 = Number(await edge(page, "proxy").getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowRight");
  await expect(edge(page, "proxy")).toHaveAttribute("aria-valuenow", String(v0 + 8));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});
