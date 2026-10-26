import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle } from "./support/app";
import { openSearch } from "./support/search";

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });

test("rows are single lines, 36 px tall, without the profile id", async ({ page }) => {
  await openApp(page);
  const etsy = row(page, "Etsy craft shop");
  expect((await etsy.boundingBox())?.height).toBe(36);
  await expect(etsy).not.toContainText("aed41005");
});

test("a thousand profiles: only the rows on screen are rendered, and the last is reachable by scrolling", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockProfiles: number }).__shardxMockProfiles = 1000; });
  await openApp(page);
  await expect(page.locator("main header [data-count]")).toHaveText("1008");
  expect(await page.locator("[role='row'][data-profile-id]").count()).toBeLessThan(80);
  await page.getByRole("treegrid").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(row(page, "Profile 1000")).toBeVisible();
});

test("Start and More actions show while the pointer is over the row", async ({ page }) => {
  await openApp(page);
  // Task 5e: the actions gridcell itself now always stays opaque (it also
  // hosts the hover-only Pin/Edit/Clone/Move to Trash overlay, which must
  // never inherit the same opacity as Start/More); Start/More's own reveal
  // moved to their wrapper, marked `data-fixed-actions`.
  const actions = row(page, "Etsy craft shop").locator("[data-fixed-actions]");
  await expect(actions).toHaveCSS("opacity", "0");
  await row(page, "Etsy craft shop").hover();
  await expect(actions).toHaveCSS("opacity", "1");
});

test("a running profile keeps its Stop button visible", async ({ page }) => {
  await openApp(page);
  await expect(row(page, "Amazon US seller").locator("[data-fixed-actions]")).toHaveCSS("opacity", "1");
});

test("the Folder column shows in All profiles only", async ({ page }) => {
  await openApp(page);
  await expect(row(page, "Etsy craft shop").locator("[data-cell='folder']")).toHaveText("Shops");
  await page.locator("aside [data-folder='Shops']").click();
  await expect(row(page, "Etsy craft shop").locator("[data-cell='folder']")).toHaveCount(0);
});

test("a starting profile keeps its button in view while the launch runs", async ({ page }) => {
  await openApp(page);
  const etsy = row(page, "Etsy craft shop");
  await etsy.hover();
  await etsy.getByRole("button", { name: "Start" }).click();
  await page.mouse.move(5, 5);
  // The mock launch takes 900 ms and the poll up to 2 s more; the button must show before that.
  await expect(etsy.locator("[data-fixed-actions]")).toHaveCSS("opacity", "1", { timeout: 500 });
});

test("changing the search or the order starts the list at the top", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockProfiles: number }).__shardxMockProfiles = 300; });
  await openApp(page);
  const grid = page.getByRole("treegrid");
  const top = () => grid.evaluate((el) => el.scrollTop);
  await grid.evaluate((el) => { el.scrollTop = 4000; });
  await (await openSearch(page)).fill("Profile 0");
  await expect.poll(top).toBe(0);
  await grid.evaluate((el) => { el.scrollTop = 4000; });
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("dialog", { name: "Display" }).getByRole("combobox", { name: "Order" }).click();
  await page.getByRole("option", { name: "Name, Z to A" }).click();
  await expect.poll(top).toBe(0);
});

test("at the minimum window size, with the sidebar folded to its rail, the list fits without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page);
  // The rail is the user's choice now, not the width's (Task 8a); with the
  // whole sidebar the list scrolls inside its card (profile-new-columns.spec).
  await page.keyboard.press("ControlOrMeta+Backslash");
  const grid = page.getByRole("treegrid");
  await expect.poll(() => grid.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("at 1280 x 800 the list shows every column without scrolling sideways", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  const grid = page.getByRole("treegrid");
  await expect(page.getByRole("columnheader", { name: "Notes" })).toBeVisible();
  expect(await grid.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("right-click and the More button open the same menu", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").click({ button: "right" });
  const fromRightClick = await page.getByRole("menuitem").allTextContents();
  await page.keyboard.press("Escape");
  await row(page, "Etsy craft shop").hover();
  await row(page, "Etsy craft shop").getByRole("button", { name: "More actions" }).click();
  expect(await page.getByRole("menuitem").allTextContents()).toEqual(fromRightClick);
  // By name: the key caps some items show (S, E, M, T, Delete) are
  // decoration, declared by aria-keyshortcuts instead (UI-29). The words are
  // the registry's (E3).
  const names = [
    "Start", "Open in Peek", "Edit", "Rename", "Clone", "Pin", "Move to folder", "Remove from folder", "Edit tags", "Change proxy",
    "Copy ID", "Export cookies", "Import cookies", "Move to Trash",
  ];
  const items = page.getByRole("menuitem");
  await expect(items).toHaveCount(names.length);
  for (const [i, name] of names.entries()) await expect(items.nth(i)).toHaveAccessibleName(name);
});

test("Copy ID copies the whole profile id", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy ID" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shardxMockClipboard?: string }).__shardxMockClipboard)).toBe("aed41005");
});

const names = (page: Page) => page.locator("[role='row'][data-profile-id] [data-cell='name']").allTextContents();

test("pinned profiles come first in the default order", async ({ page }) => {
  await openApp(page);
  expect((await names(page)).slice(0, 2)).toEqual(["Amazon US seller", "FB Ads acc-01"]);
});

test("a Shift-click range follows the painted order across the Pinned boundary", async ({ page }) => {
  await openApp(page);
  // Painted: Amazon, FB Ads acc-01 (both pinned), eBay, Etsy, …; the store
  // order is Amazon, eBay, Etsy, FB Ads acc-01, so a range taken from the
  // store would also catch Etsy.
  await row(page, "FB Ads acc-01").locator("[data-cell='checkbox'] input").check({ force: true });
  // On the Status cell, which has no edit button: the row's middle is a
  // cell's edit button in some layouts (Proxy, since Tags waits for a tag, F20).
  await row(page, "eBay DE buyer").locator("[data-cell='status']").click({ modifiers: ["Shift"] });
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(2);
  await expect(row(page, "Etsy craft shop")).toHaveAttribute("aria-selected", "false");
});

test("pinned profiles stay first after sorting by name", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "Display" }).click();
  await page.getByRole("dialog", { name: "Display" }).getByRole("combobox", { name: "Order" }).click();
  await page.getByRole("option", { name: "Name, Z to A" }).click();
  await page.keyboard.press("Escape");
  const order = await names(page);
  expect(order.slice(0, 3)).toEqual(["FB Ads acc-01", "Amazon US seller", "TikTok creator"]);
});

test("pressing a row that is partly out of view doesn't scroll the list under the pointer", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockProfiles: number }).__shardxMockProfiles = 300; });
  await openApp(page);
  const grid = page.getByRole("treegrid");
  // Scroll so the grid's bottom edge cuts a row in half, then press its visible half.
  const point = await grid.evaluate((el) => {
    el.scrollTop = 10;
    const bottom = el.getBoundingClientRect().top + el.clientHeight;
    if ([...el.querySelectorAll("[role='row'][data-profile-id]")].every((r) => {
      const b = r.getBoundingClientRect();
      return !(b.top < bottom - 4 && b.bottom > bottom + 4);
    })) el.scrollTop = 28;
    const cut = [...el.querySelectorAll("[role='row'][data-profile-id]")].find((r) => {
      const b = r.getBoundingClientRect();
      return b.top < bottom - 4 && b.bottom > bottom + 4;
    })!.getBoundingClientRect();
    return { x: cut.left + 300, y: (cut.top + bottom) / 2, scrollTop: el.scrollTop };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(100);
  expect(await grid.evaluate((el) => el.scrollTop)).toBe(point.scrollTop);
});

test("the name order reads numbers as numbers", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.profiles.sort", "name-asc"));
  await openApp(page);
  await page.evaluate(() => {
    const m = (window as unknown as { __shardxMock: { state: { profiles: Record<string, { name: string }> }; save: () => void } }).__shardxMock;
    m.state.profiles["f62a9d43"].name = "Shop 10";
    m.state.profiles["aed41005"].name = "Shop 2";
    m.save();
  });
  await page.reload();
  await waitForIdle(page);
  const order = await names(page);
  expect(order.indexOf("Shop 2")).toBeGreaterThanOrEqual(0);
  expect(order.indexOf("Shop 2")).toBeLessThan(order.indexOf("Shop 10"));
});

