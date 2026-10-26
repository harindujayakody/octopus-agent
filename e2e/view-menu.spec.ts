import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// The list's View menu (owner, 2026-10-24): on Windows its Order field did not
// open, and the Tags column's note was drawn over its label.

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const load = (lang: string) => JSON.parse(readFileSync(new URL(`../src/shared/i18n/locales/${lang}.json`, import.meta.url), "utf8")) as Record<string, string>;
const EN = load("en");

const PROFILE_SORTS = ["orderAdded", "orderNameAsc", "orderNameDesc", "orderNewest", "orderOldest", "orderLaunched", "orderRuntime", "orderStatus"]
  .map((k) => EN[`profileFilterBar.${k}`]);
const PROXY_SORTS = [EN["profileFilterBar.orderAdded"], ...["orderName", "orderLatency", "orderTested", "orderProfiles"].map((k) => EN[`proxyDisplay.${k}`])];

const drags = (page: Page) => page.evaluate(() =>
  (window as unknown as { __shardxMock: { windowCalls: string[] } }).__shardxMock.windowCalls.filter((c) => c === "plugin:window|start_dragging").length);

/** Windows' move loop: once a press starts a window drag, the system takes the
 *  release, and the page gets neither the mouseup nor the click (as on the owner's report). */
const windowsMoveLoop = (page: Page) => page.addInitScript(() => {
  const count = () => (window as unknown as { __shardxMock?: { windowCalls: string[] } }).__shardxMock?.windowCalls
    .filter((c) => c === "plugin:window|start_dragging").length ?? 0;
  let atPress = 0;
  addEventListener("mousedown", () => { atPress = count(); }, true);
  const eat = (e: Event) => { if (count() > atPress) { e.stopImmediatePropagation(); e.preventDefault(); } };
  for (const type of ["mouseup", "pointerup", "click"]) addEventListener(type, eat, true);
});

async function openView(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Display" }).click();
  const view = page.getByRole("dialog", { name: "Display" });
  await expect(view).toBeVisible();
  return view;
}

/** Presses and releases the primary button at a point, with nothing else in between. */
async function pressAt(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe("on Windows", () => {
  test.use({ userAgent: WINDOWS_UA });
  test.beforeEach(async ({ page }) => { await windowsMoveLoop(page); });

  for (const [section, sorts] of [["profiles", PROFILE_SORTS], ["proxies", PROXY_SORTS]] as const) {
    test(`${section}: the View menu's Order opens and picks every order with the mouse, and never moves the window`, async ({ page }) => {
      await openApp(page, { section });
      const view = await openView(page);
      const order = view.getByRole("combobox", { name: "Order" });
      for (const name of [...sorts.slice(1), sorts[0]]) {
        await order.click();
        await expect(page.getByRole("listbox")).toBeVisible();
        await page.getByRole("listbox").getByRole("option", { name, exact: true }).click();
        await expect(order).toHaveText(name);
        await expect(page.getByRole("listbox")).toHaveCount(0);
      }
      expect(await drags(page)).toBe(0);
    });
  }

  test("the Order picks every order from the keys", async ({ page }) => {
    await openApp(page);
    const view = await openView(page);
    const order = view.getByRole("combobox", { name: "Order" });
    for (const [i, name] of [...PROFILE_SORTS.entries()].reverse()) {
      await order.focus();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("listbox")).toBeVisible();
      await page.keyboard.press("Home");
      for (let n = 0; n < i; n++) await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(order).toHaveText(name);
    }
    expect(await drags(page)).toBe(0);
  });

  test("the press rule holds for a pen too", async ({ page }) => {
    await openApp(page);
    const view = await openView(page);
    const order = view.getByRole("combobox", { name: "Order" });
    const cdp = await page.context().newCDPSession(page);
    const pen = async (loc: Locator) => {
      const b = (await loc.boundingBox())!;
      const at = { x: b.x + b.width / 2, y: b.y + b.height / 2, button: "left" as const, clickCount: 1, pointerType: "pen" as const };
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
    };
    await pen(order);
    await expect(page.getByRole("listbox")).toBeVisible();
    await pen(page.getByRole("option", { name: PROFILE_SORTS[1], exact: true }));
    await expect(order).toHaveText(PROFILE_SORTS[1]);
    expect(await drags(page)).toBe(0);
  });

  test("a press inside the View and Filters popovers never moves the window; the bare header still does", async ({ page }) => {
    await openApp(page);
    const header = (await page.locator("main header").first().boundingBox())!;
    const view = await openView(page);
    const box = (await view.boundingBox())!;
    // The popover's own padding, the Order caption, the Columns legend, a note and a disabled box's label.
    await pressAt(page, box.x + box.width / 2, box.y + 4);
    for (const loc of [
      view.getByText("Order", { exact: true }),
      view.locator("legend"),
      view.locator("[data-column-note]").first(),
      view.getByText("Name", { exact: true }),
    ]) {
      const b = (await loc.boundingBox())!;
      await pressAt(page, b.x + b.width / 2, b.y + b.height / 2);
    }
    await expect(view).toBeVisible();
    expect(await drags(page)).toBe(0);
    await page.keyboard.press("Escape");
    await expect(view).toHaveCount(0);

    await page.getByRole("button", { name: "Filters" }).click();
    const filters = page.getByRole("dialog").last();
    await expect(filters).toBeVisible();
    const f = (await filters.boundingBox())!;
    await pressAt(page, f.x + f.width / 2, f.y + 4);
    expect(await drags(page)).toBe(0);
    await page.keyboard.press("Escape");
    await expect(filters).toHaveCount(0);

    // The header's bare ground, left of its actions: the window moves.
    await pressAt(page, header.x + header.width / 2, header.y + 4);
    await expect.poll(() => drags(page)).toBe(1);
  });
});

test.describe("on a touch screen on Windows", () => {
  test.use({ userAgent: WINDOWS_UA, hasTouch: true });

  test("a tap opens the Order and picks every order, and never moves the window", async ({ page }) => {
    await windowsMoveLoop(page);
    await openApp(page);
    await page.getByRole("button", { name: "Display" }).tap();
    const view = page.getByRole("dialog", { name: "Display" });
    await expect(view).toBeVisible();
    const order = view.getByRole("combobox", { name: "Order" });
    for (const name of [...PROFILE_SORTS.slice(1), PROFILE_SORTS[0]]) {
      await order.tap();
      await expect(page.getByRole("listbox")).toBeVisible();
      await page.getByRole("listbox").getByRole("option", { name, exact: true }).tap();
      await expect(order).toHaveText(name);
    }
    expect(await drags(page)).toBe(0);
  });
});

/** Each column row's label and note boxes, and the menu's, in the page's own px. */
const rowBoxes = (view: Locator) => view.evaluate((menu) => {
  const r = (el: Element) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  const pad = parseFloat(getComputedStyle(menu).paddingRight);
  return {
    menu: { ...r(menu), right: menu.getBoundingClientRect().right - pad },
    rows: [...menu.querySelectorAll("fieldset > div")].map((row) => {
      const label = row.querySelector("label > span:last-child")!;
      const note = row.querySelector("[data-column-note]");
      return { text: label.textContent, label: r(label), note: note ? r(note) : null, noteText: note?.textContent ?? null };
    }),
  };
});

type Box = { left: number; right: number; top: number; bottom: number };
const meet = (a: Box, b: Box) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

for (const lang of ["en", "ru", "zh"] as const) {
  for (const size of [100, 150]) {
    test(`${lang} at ${size}%: no column note lies over its label, and none runs out of the menu`, async ({ page }) => {
      const L = load(lang);
      await page.addInitScript(([l, s]) => {
        localStorage.setItem("shardx.lang", l);
        localStorage.setItem("shardx.interfaceSize", s);
      }, [lang, String(size)] as const);
      // Profiles (no tag yet: Tags waits for one), the same inside a folder (Folder is gone there), and Proxies.
      for (const where of ["profiles", "folder", "proxies"] as const) {
        if (where === "proxies") await openApp(page, { section: "proxies" });
        else if (where === "profiles") await openApp(page);
        else await page.locator("aside [data-folder='Ads']").click();
        await page.getByRole("button", { name: L["profileDisplay.title"], exact: true }).click();
        const view = page.getByRole("dialog", { name: L["profileDisplay.title"] });
        await expect(view).toBeVisible();
        const { menu, rows } = await rowBoxes(view);
        const noted = rows.filter((r) => r.note);
        expect(noted.length, where).toBeGreaterThan(0);
        for (const r of rows) {
          expect(r.label.right, `${where}: ${r.text}`).toBeLessThanOrEqual(menu.right + 0.5);
          if (!r.note) continue;
          expect(meet(r.label, r.note), `${where}: ${r.text}'s note over its label`).toBe(false);
          expect(r.note.right, `${where}: ${r.text}'s note`).toBeLessThanOrEqual(menu.right + 0.5);
        }
        // The owner's case: Tags' long note in Profiles, Folder's inside a folder.
        if (where !== "proxies") expect(noted.map((r) => r.noteText)).toContain(L[where === "folder" ? "tableColumns.inFolder" : "tableColumns.noTags"]);
        await page.keyboard.press("Escape");
        await expect(view).toHaveCount(0);
      }
    });
  }
}
