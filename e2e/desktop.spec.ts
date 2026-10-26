import { expect, test, type Page } from "@playwright/test";
import { SECTIONS, openApp } from "./support/app";
import { openSearch } from "./support/search";

// A desktop window, not a web page (WIG-04, WIG-05, WIG-11; owner decision O-2).
const userSelect = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).userSelect || getComputedStyle(el).webkitUserSelect);
const overscroll = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).overscrollBehaviorY);

test("chrome text is not selectable; values are", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  expect(await userSelect(page, "aside")).toBe("none");
  expect(await userSelect(page, "main h1")).toBe("none");
  await page.locator("[role='row'][data-proxy-id]", { hasText: "DC Tokyo" }).locator("[data-cell='name']").click();
  expect(await userSelect(page, "aside[data-peek='proxy'] [data-selectable]")).toBe("text");
  expect(await userSelect(page, "input")).toBe("text");
});

test("Cmd/Ctrl+A outside a field selects nothing; in a field it selects the field", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.locator("main h1").click();
  await page.keyboard.press("ControlOrMeta+a");
  expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe("");
  // Settings' first text fields are read-only or numbers; the Proxies
  // filter is a plain text field.
  await page.locator("aside [data-nav='proxies']").click();
  const field = await openSearch(page);
  await field.fill("hello");
  await field.press("ControlOrMeta+a");
  expect(await field.evaluate((i: HTMLInputElement) => (i.selectionEnd ?? 0) - (i.selectionStart ?? 0))).toBe(5);
});

test("Cmd/Ctrl+A in the list still selects every row", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ArrowDown");
  // The list has the keyboard: its Cmd/Ctrl+A comes first.
  await expect(page.locator("[role='row'][data-profile-id]:focus")).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.locator("[data-bulk-bar]")).toBeVisible();
  await expect(page.locator("[role='row'][data-profile-id][aria-selected='true']")).toHaveCount(8);
});

test("the window does not bounce; panels keep their scroll to themselves", async ({ page }) => {
  await openApp(page);
  expect(await overscroll(page, "html")).toBe("none");
  expect(await overscroll(page, "body")).toBe("none");
  // The sidebar's scroller is the box under its fixed page items, not the nav.
  expect(await overscroll(page, "aside [data-sidebar-scroll]")).toBe("contain");
  await page.locator("[role='row'][data-profile-id]", { hasText: "Etsy craft shop" }).locator("[data-cell='name']").click();
  expect(await overscroll(page, "aside[data-peek] [data-peek-body]")).toBe("contain");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  expect(await overscroll(page, "[role='dialog'] [role='listbox']")).toBe("contain");
  await page.keyboard.press("Escape");
  await page.locator("[role='row'][data-profile-id]").first().click({ button: "right" });
  expect(await overscroll(page, "[role='menu']")).toBe("contain");
});

test("the native window is asked to match the app's theme", async ({ page }) => {
  await openApp(page, { theme: "dark" });
  const asked = () =>
    page.evaluate(() =>
      (window as unknown as { __shardxMock: { windowArgs: { cmd: string; args: { value?: string } }[] } }).__shardxMock.windowArgs
        .filter((c) => c.cmd === "plugin:window|set_theme")
        .map((c) => c.args.value),
    );
  await expect.poll(asked).toContain("dark");
});

/** The scroll boxes on screen (overflow auto or scroll on either axis) that
 *  still pass their scroll on, or bounce the window, at an edge. */
const chaining = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")].flatMap((el) => {
      const s = getComputedStyle(el);
      const scrolls = [s.overflowX, s.overflowY].some((v) => v === "auto" || v === "scroll");
      const kept = [s.overscrollBehaviorX, s.overscrollBehaviorY].every((v) => v === "contain" || v === "none");
      if (!scrolls || kept) return [];
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 4).join(".") : "";
      return [`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`];
    }),
  );

test("every scroll box on every page, and in a dialog, keeps its scroll to itself", async ({ page }) => {
  test.slow(); // opens every page in turn, then a dialog
  for (const section of SECTIONS) {
    await openApp(page, { section });
    expect(await chaining(page), section).toEqual([]);
  }
  await openApp(page);
  await page.locator("[role='row'][data-profile-id]", { hasText: "Etsy craft shop" }).locator("[data-cell='name']").click();
  expect(await chaining(page), "Peek").toEqual([]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await chaining(page), "the shortcut sheet").toEqual([]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  expect(await chaining(page), "the palette").toEqual([]);
});
