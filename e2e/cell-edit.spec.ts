import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, seedATag } from "./support/app";

// Edit on hover (owner feature 2026-09-26): an editable cell's edit button
// opens that field's editor at the cell; the column the row actions float
// over carries its button at their front.
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const cellOf = (page: Page, name: string, id: string) => row(page, name).locator(`[data-cell='${id}']`);
const seed = (page: Page, key: string, value: unknown) => page.addInitScript(([k, v]) => {
  if (localStorage.getItem(k) === null) localStorage.setItem(k, JSON.stringify(v));
}, [key, value] as const);
/** Nothing covers the button: the point at its middle hits it. */
const reachable = (button: Locator) => button.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("button") === el;
});
const toast = (page: Page, text: string) => page.locator("[data-toast]").getByText(text, { exact: true });
const TAGS = {
  version: 1,
  tags: [{ id: "t-warm", name: "Warm-up", color: "orange" }, { id: "t-vip", name: "VIP", color: "violet" }],
  byProfile: { f62a9d43: ["t-warm"], aed41005: ["t-warm", "t-vip"] },
};

test("hovering an editable cell shows its edit button after its content, inside the cell, with a hover state; it opens the tag picker under the cell, not Peek", async ({ page }) => {
  await seed(page, "shardx.tags", TAGS);
  await openApp(page);
  const tags = cellOf(page, "Etsy craft shop", "tags");
  const edit = tags.getByRole("button", { name: "Edit tags for Etsy craft shop" });
  // Collapsed (fix round 1, I1): a real Tab stop even hidden, so its own
  // bounding box is not empty — `toBeHidden()` cannot see the clip its
  // wrapper applies, but nothing is painted (or hit-testable) at its point.
  expect(await reachable(edit)).toBe(false);
  await tags.hover({ position: { x: 4, y: 18 } });
  await expect(edit).toBeVisible();
  const cell = (await tags.boundingBox())!;
  const button = (await edit.boundingBox())!;
  const chips = (await tags.locator("[data-tag]").last().boundingBox())!;
  expect(button.x + button.width).toBeLessThanOrEqual(cell.x + cell.width + 1);
  expect(button.x).toBeGreaterThanOrEqual(Math.min(chips.x + chips.width, cell.x + cell.width - 24) - 1);
  const rest = await edit.evaluate((el) => getComputedStyle(el).backgroundColor);
  await edit.hover();
  await expect.poll(() => edit.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(rest);
  await edit.click();
  const picker = page.getByRole("dialog", { name: "Tags" });
  await expect(picker).toBeVisible();
  expect((await picker.boundingBox())!.y).toBeGreaterThanOrEqual(cell.y + cell.height - 1);
  await expect(page.locator("aside[data-peek]")).toHaveCount(0);
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(0);
});

// A stretched row (owner, 2026-10-23) makes cells wider than what they show:
// the button stays beside the text it edits, not at the far end of the cell.
test("in a wide row the edit button sits right after the cell's text, not at the cell's far end", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openApp(page);
  const proxy = cellOf(page, "FB Ads acc-01", "proxy");
  await proxy.hover({ position: { x: 4, y: 18 } });
  const edit = proxy.getByRole("button", { name: "Edit proxy for FB Ads acc-01" });
  await expect(edit).toBeVisible();
  const text = (await proxy.locator("[data-proxy-name]").boundingBox())!;
  const button = (await edit.boundingBox())!;
  const cell = (await proxy.boundingBox())!;
  // The 14 px fade, then the button.
  expect(button.x - (text.x + text.width)).toBeGreaterThanOrEqual(0);
  expect(button.x - (text.x + text.width)).toBeLessThanOrEqual(20);
  expect(cell.x + cell.width - (button.x + button.width)).toBeGreaterThan(60);
  expect(await reachable(edit)).toBe(true);
});

test("an empty Folder cell offers Add: a menu under the cell with No folder, every Folder and New folder", async ({ page }) => {
  await openApp(page);
  const folder = cellOf(page, "Sandbox", "folder");
  await folder.hover({ position: { x: 4, y: 18 } });
  await folder.getByRole("button", { name: "Add folder for Sandbox" }).click();
  const menu = page.getByRole("menu", { name: "Folder for Sandbox" });
  await expect(menu).toBeVisible();
  const cell = (await folder.boundingBox())!;
  expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(cell.y + cell.height - 1);
  await expect(menu.getByRole("menuitemradio", { name: "No folder" })).toHaveAttribute("aria-checked", "true");
  await expect(menu.getByRole("menuitem", { name: "New folder" })).toBeVisible();
  await menu.getByRole("menuitemradio", { name: "Ads" }).click();
  await expect(folder).toHaveText("Ads");
  await expect(page.locator("aside[data-peek]")).toHaveCount(0);
  // A move shows itself: the row stays in the list here, so it says so in a toast (one, never two).
  await expect(toast(page, "Moved “Sandbox” to “Ads”")).toBeVisible();
  await expect(page.locator("[data-toast]")).toHaveCount(1);
});

test("the Proxy cell's button opens the proxy picker at the cell", async ({ page }) => {
  await openApp(page);
  const proxy = cellOf(page, "Sandbox", "proxy");
  await proxy.hover({ position: { x: 4, y: 18 } });
  await proxy.getByRole("button", { name: "Edit proxy for Sandbox" }).click();
  await expect(page.getByRole("dialog", { name: "Proxy" })).toBeVisible();
});

// Manual save (Task 7): picking a proxy applies at once, and says it saved.
test("picking a proxy in the Proxy cell toasts", async ({ page }) => {
  await openApp(page);
  const proxy = cellOf(page, "Sandbox", "proxy");
  await proxy.hover({ position: { x: 4, y: 18 } });
  await proxy.getByRole("button", { name: "Edit proxy for Sandbox" }).click();
  const picker = page.getByRole("dialog", { name: "Proxy" });
  await picker.getByRole("combobox", { name: "Proxy", exact: true }).click();
  await page.getByRole("option", { name: /DC Tokyo/ }).click();
  await expect(proxy).toContainText("DC Tokyo");
  await expect(toast(page, "Sandbox saved")).toBeVisible();
  await expect(page.locator("[data-toast]")).toHaveCount(1);
});

// Ruling 2: the cell's tag picker keeps applying at once; closing it after a
// change says so once, and closing it unchanged says nothing.
test("the tag picker toasts once when it closes with a change, never for an unchanged close", async ({ page }) => {
  await seed(page, "shardx.tags", TAGS);
  await openApp(page);
  const tags = cellOf(page, "Scraper pricing", "tags");
  await tags.hover({ position: { x: 4, y: 18 } });
  await tags.getByRole("button", { name: "Add tags for Scraper pricing" }).click();
  await expect(page.getByRole("dialog", { name: "Tags" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Tags" })).toHaveCount(0);
  await expect(page.locator("[data-toast]")).toHaveCount(0);

  await tags.hover({ position: { x: 4, y: 18 } });
  await tags.getByRole("button", { name: "Add tags for Scraper pricing" }).click();
  await page.getByRole("option", { name: /Warm-up/ }).click();
  await page.getByRole("option", { name: /VIP/ }).click();
  // Each pick applies at once and is quiet; the toast comes with the close.
  await expect(tags.locator("[data-tag]").first()).toBeVisible();
  await expect(page.locator("[data-toast]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(toast(page, "Tags saved")).toBeVisible();
  await expect(page.locator("[data-toast]")).toHaveCount(1);
});

test("the Notes edit button stays clickable while the row actions show (Review Focus 5)", async ({ page }) => {
  await openApp(page);
  const r = row(page, "Etsy craft shop");
  // Notes is last: the row actions float over it and carry its button, whose
  // own DOM lives in the actions cell (a sibling of Notes, not its
  // descendant) — once the lead expands it legitimately covers all of
  // Notes at this width, so a locator-based hover (which requires the
  // receiving element to be the target or its descendant) can never
  // settle here. A raw mouse move triggers the same real :hover state
  // without that requirement.
  const notesBox = (await cellOf(page, "Etsy craft shop", "notes").boundingBox())!;
  await page.mouse.move(notesBox.x + 4, notesBox.y + 18);
  const edit = r.locator("[data-row-lead]").getByRole("button", { name: "Edit notes for Etsy craft shop" });
  await expect(edit).toBeVisible();
  await expect(r.getByRole("button", { name: "Pin" })).toBeVisible();
  expect(await reachable(edit)).toBe(true);
  await edit.click();
  await expect(r.getByRole("textbox", { name: "Notes" })).toBeFocused();
});

test("whatever column is last carries its button in the row actions; the one before it keeps its own, uncovered (Review Focus 5)", async ({ page }) => {
  await seed(page, "shardx.profiles.layout", { v: 2, order: ["name", "status", "folder", "tags", "notes", "proxy"], hidden: [], widths: {} });
  await openApp(page);
  const r = row(page, "Sandbox");
  await cellOf(page, "Sandbox", "proxy").hover({ position: { x: 4, y: 18 } });
  await expect(r.locator("[data-row-lead]").getByRole("button", { name: "Edit proxy for Sandbox" })).toBeVisible();
  const notes = cellOf(page, "Sandbox", "notes");
  await notes.hover({ position: { x: 4, y: 18 } });
  const own = notes.getByRole("button", { name: "Edit notes for Sandbox" });
  await expect(own).toBeVisible();
  await expect(r.getByRole("button", { name: "Pin" })).toBeVisible();
  expect(await reachable(own)).toBe(true);
});

test("a narrow column placed last never lets the row actions cover the button before it (Review Focus 5)", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await seed(page, "shardx.profiles.layout", {
    v: 2,
    order: ["name", "status", "folder", "tags", "proxy", "notes", "device", "lastRun", "created", "runTime", "extensions"],
    hidden: ["lastRun", "created", "runTime", "extensions"],
    widths: {},
  });
  await openApp(page);
  const notes = cellOf(page, "Sandbox", "notes");
  await notes.hover({ position: { x: 4, y: 18 } });
  const own = notes.getByRole("button", { name: "Edit notes for Sandbox" });
  await expect(own).toBeVisible();
  expect(await reachable(own)).toBe(true);
});

// C7: nothing may cover a focused button (`toBeVisible()` alone cannot see
// occlusion), at the default width and at the smallest window the list
// supports (fix round 1, I3).
for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 680 }]) {
  test(`from the active row, Tab reaches the edit buttons, shown and reachable, before the row actions (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await seed(page, "shardx.tags", TAGS);
    await openApp(page);
    // The row becomes the one the keys act on without opening Peek: a click
    // opens it (Pair 40), and at 1024 Peek lies over the list's end.
    await row(page, "Etsy craft shop").hover();
    await row(page, "Etsy craft shop").focus();
    await page.keyboard.press("Tab"); // the select box
    for (const name of ["Edit folder for Etsy craft shop", "Edit tags for Etsy craft shop", "Edit proxy for Etsy craft shop", "Edit notes for Etsy craft shop", "Pin"]) {
      await page.keyboard.press("Tab");
      const focused = row(page, "Etsy craft shop").getByRole("button", { name, exact: true });
      await expect(focused).toBeFocused();
      await expect(focused).toBeVisible();
      expect(await reachable(focused)).toBe(true);
    }
  });
}

// Merge point 1 (WCAG 2.4.11), the left side: with every column shown the
// list scrolls far enough at 1024 x 680 for a cell's edit button to sit under
// the pinned Name. Taking focus brings it clear; the select box before it,
// pinned, does not scroll the list.
test("at 1024x680 an edit button waiting under the pinned Name comes clear when Tab reaches it", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  // Tags shows once a tag exists (Pair 27, F20): every column, as before.
  await seedATag(page);
  await seed(page, "shardx.profiles.layout", {
    v: 2,
    order: ["name", "status", "folder", "tags", "proxy", "lastRun", "created", "runTime", "device", "extensions", "notes"],
    hidden: [],
    widths: {},
  });
  await openApp(page);
  await cellOf(page, "Etsy craft shop", "status").click();
  const edit = row(page, "Etsy craft shop").getByRole("button", { name: "Edit folder for Etsy craft shop", exact: true });
  const folder = cellOf(page, "Etsy craft shop", "folder");
  const name = (await cellOf(page, "Etsy craft shop", "name").boundingBox())!;
  const grid = page.getByRole("treegrid", { name: "Profiles" });
  // Where the shown button's middle will be: 12 px in from the cell's end.
  const buttonMiddle = async () => {
    const b = (await folder.boundingBox())!;
    return { x: b.x + b.width - 12, y: b.y + b.height / 2 };
  };
  await grid.evaluate((el, dx) => { el.scrollLeft += dx; }, (await buttonMiddle()).x - (name.x + name.width / 2));
  // That point is under Name now.
  expect(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest("[data-cell='name']")), await buttonMiddle())).toBe(true);
  const scrolled = await grid.evaluate((el) => el.scrollLeft);
  await page.keyboard.press("Tab"); // the select box
  expect(await grid.evaluate((el) => el.scrollLeft)).toBe(scrolled);
  await page.keyboard.press("Tab");
  await expect(edit).toBeFocused();
  expect(await reachable(edit)).toBe(true);
});

// Fix round 1 (I4): a cell editor returns the keyboard to that cell's own
// edit button on close (never `document.body`, where a hidden button used
// to leave it), so the button shows again, focused.
test.describe("fix round 1 (I4): a cell editor returns focus to its edit button on close", () => {
  test("Folder: Esc, and a pick", async ({ page }) => {
    await openApp(page);
    const r = row(page, "Sandbox");
    const btn = cellOf(page, "Sandbox", "folder").getByRole("button", { name: "Add folder for Sandbox" });
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Folder for Sandbox" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(btn).toBeFocused();

    await btn.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitemradio", { name: "Ads" }).click();
    await expect(cellOf(page, "Sandbox", "folder").getByRole("button", { name: "Edit folder for Sandbox" })).toBeFocused();
    await expect(r).toBeVisible(); // still the active row; nothing lost focus to body
  });

  test("Tags: Esc", async ({ page }) => {
    // Tags shows once a tag exists (Pair 27, F20); Sandbox has none.
    await seedATag(page);
    await openApp(page);
    const btn = cellOf(page, "Sandbox", "tags").getByRole("button", { name: "Add tags for Sandbox" });
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Tags" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(btn).toBeFocused();
  });

  test("Proxy: Esc", async ({ page }) => {
    await openApp(page);
    const btn = cellOf(page, "Sandbox", "proxy").getByRole("button", { name: "Edit proxy for Sandbox" });
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Proxy" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(btn).toBeFocused();
  });

  test("Notes: Esc", async ({ page }) => {
    // Notes is last by default (own("notes") is null there; its button
    // rides in the row actions' lead instead) — reorder so it keeps its own.
    await seed(page, "shardx.profiles.layout", { v: 2, order: ["name", "status", "folder", "tags", "notes", "proxy"], hidden: [], widths: {} });
    await openApp(page);
    const r = row(page, "Sandbox");
    const btn = cellOf(page, "Sandbox", "notes").getByRole("button", { name: "Edit notes for Sandbox" });
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(r.getByRole("textbox", { name: "Notes" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(btn).toBeFocused();
  });
});

test("in Chinese the buttons are named in Chinese", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
  await openApp(page);
  const folder = cellOf(page, "Sandbox", "folder");
  await folder.hover({ position: { x: 4, y: 18 } });
  await expect(folder.getByRole("button", { name: "为 Sandbox 添加文件夹" })).toBeVisible();
});
