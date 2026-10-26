import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// Clarity fixes, item 5: an extension card keeps its text inside itself, says
// when the same extension is installed twice, and names an extension the way
// the card does (never a temp-file path) when it is removed.
type Ext = { id: string; name: string; version: string; description: string; icon: string; path: string; size_bytes: number; added_at: string };
type Mock = { __shardxMock: { state: { extensions: Ext[] }; emit(event: string, payload: unknown): void } };

const ext = (id: string, name: string, over: Partial<Ext> = {}): Ext => ({
  id, name, version: "1.1.0", description: "HTTP/HTTPS & SOCKS5 proxy manager with geo-detection.", icon: "",
  path: `/Users/you/Library/Application Support/ShardX/extensions/${id}`, size_bytes: 786_000, added_at: "@1788000000", ...over,
});

const LONG_TITLE = "Proxy with Login & Password — HTTP/HTTPS proxy manager for every profile you open";
const LONG_DESCRIPTION = "Set an HTTP or HTTPS proxy with username and password, switch proxies, check your IP and stop WebRTC leaks "
  + "https://example.com/a/very/long/address/with/no/spaces/at/all/anywhere/in/it/that/keeps/going/and/going/and/going";

/** Adds extensions the way the backend does out of band: into its state, then the change signal. */
async function add(page: Page, entries: Ext[]) {
  await page.evaluate((entries) => {
    const m = (window as unknown as Mock).__shardxMock;
    m.state.extensions.push(...entries);
    m.emit("store-changed", "extensions");
  }, entries);
  await expect(card(page, entries[entries.length - 1].id)).toBeVisible();
}

const card = (page: Page, id: string) => page.locator(`[role='listitem'][data-row-id='${id}']`);
const toasts = (page: Page) => page.locator("[data-toast]");

async function box(loc: Locator) {
  const b = await loc.boundingBox();
  if (!b) throw new Error("no box");
  return b;
}

test("a long title stays inside its card", async ({ page }) => {
  await openApp(page, { section: "extensions" });
  await add(page, [
    ext("long-1", LONG_TITLE, { description: LONG_DESCRIPTION, version: "1.0.9" }),
    ext("long-2", "ProxyShard – Smart Proxy Manager"),
    ext("long-3", "ProxyShard – Smart Proxy Manager with a second long name that runs on", { description: LONG_DESCRIPTION }),
  ]);
  const ids = ["long-1", "long-2", "long-3"];
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  for (const id of ids) {
    const tile = card(page, id);
    const t = await box(tile);
    boxes.push(t);
    const title = tile.locator("h2");
    const text = await box(title);
    expect(text.x + text.width, `${id}: the title ends inside its card`).toBeLessThanOrEqual(t.x + t.width + 0.5);
    const body = await box(tile.locator("article p"));
    expect(body.x + body.width, `${id}: the description ends inside its card`).toBeLessThanOrEqual(t.x + t.width + 0.5);
    // The article, and what it holds, is no wider than the tile around it.
    expect(await tile.locator("article").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  // The long name really is cut (the test would pass with short names too).
  expect(await card(page, "long-1").locator("h2").evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  // No card runs over the next one in its row.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const sameRow = Math.abs(boxes[i].y - boxes[j].y) < 1;
      if (!sameRow) continue;
      const [a, b] = boxes[i].x < boxes[j].x ? [boxes[i], boxes[j]] : [boxes[j], boxes[i]];
      expect(a.x + a.width).toBeLessThanOrEqual(b.x + 0.5);
    }
  }
  // Cards are at least 280 px wide: a name and its version fit on a line.
  for (const b of boxes) expect(b.width).toBeGreaterThanOrEqual(279.5);
});

test("the full title is in the tooltip", async ({ page }) => {
  await openApp(page, { section: "extensions" });
  await add(page, [ext("long-1", LONG_TITLE)]);
  await card(page, "long-1").locator("h2").hover();
  await expect(page.getByRole("tooltip")).toHaveText(LONG_TITLE);
});

test("two imports of one extension show \"Installed twice\", each with its own Remove", async ({ page }) => {
  await openApp(page, { section: "extensions" });
  await add(page, [
    ext("dup-1", "ProxyShard – Smart Proxy Manager"),
    ext("dup-2", "ProxyShard – Smart Proxy Manager"),
    // The same name at another version is another extension.
    ext("other", "ProxyShard – Smart Proxy Manager", { version: "1.2.0" }),
  ]);
  await expect(card(page, "dup-1").getByText("Installed twice", { exact: true })).toBeVisible();
  await expect(card(page, "dup-2").getByText("Installed twice", { exact: true })).toBeVisible();
  await expect(page.getByText("Installed twice", { exact: true })).toHaveCount(2);
  await expect(card(page, "other").getByText("Installed twice")).toHaveCount(0);
  await expect(card(page, "ublock").getByText("Installed twice")).toHaveCount(0);

  // Each card has its own Remove.
  for (const id of ["dup-1", "dup-2"]) {
    await card(page, id).click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Remove extension" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  }
  await card(page, "dup-1").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove extension" }).click();
  await expect(card(page, "dup-1")).toHaveCount(0);
  // The one left is not a copy of anything any more.
  await expect(card(page, "dup-2")).toBeVisible();
  await expect(page.getByText("Installed twice", { exact: true })).toHaveCount(0);
});

test("removing shows the name, not a path", async ({ page }) => {
  await openApp(page, { section: "extensions" });
  await add(page, [
    ext("tmp-mac", "/var/folders/zz/abc/T/shardx-ext-4fd2c1.crx"),
    ext("tmp-win", "C:\\Users\\you\\AppData\\Local\\Temp\\shardx-ext-9a8b7c.crx"),
  ]);
  await expect(card(page, "tmp-mac").locator("h2")).toHaveText("shardx-ext-4fd2c1");
  await expect(card(page, "tmp-win").locator("h2")).toHaveText("shardx-ext-9a8b7c");
  for (const [id, name] of [["tmp-mac", "shardx-ext-4fd2c1"], ["tmp-win", "shardx-ext-9a8b7c"]]) {
    await card(page, id).click({ button: "right" });
    // The menu names what it acts on, in the card's words.
    await expect(page.getByRole("menu", { name })).toBeVisible();
    await page.getByRole("menuitem", { name: "Remove extension" }).click();
    await expect(toasts(page).getByText(`Removed “${name}”`, { exact: true })).toBeVisible();
  }
  await expect(toasts(page).filter({ hasText: /\/var\/folders|AppData/ })).toHaveCount(0);
});
