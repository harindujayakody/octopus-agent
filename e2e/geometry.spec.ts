import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { openSearch } from "./support/search";

// Audit Phase B, B4 (O1): a whole-pixel grid. A control's top and height land
// on whole pixels, so its edges and hairlines draw crisp on a 1x screen; the
// density stays what it was.

type Box = { name: string; top: number; height: number; width: number; iconOnly: boolean };
const boxes = (page: Page, selector: string): Promise<Box[]> =>
  page.locator(selector).evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { name: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20) ?? el.tagName, top: r.top, height: r.height, width: r.width, iconOnly: !el.textContent?.trim() };
      }),
  );
const whole = (v: number) => Math.abs(v - Math.round(v)) < 0.01;
const radius = (page: Page, locator: ReturnType<Page["locator"]>) => locator.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);

for (const size of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
  test(`header and sidebar controls sit on whole pixels at ${size.width} x ${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await openApp(page);
    const found = [...(await boxes(page, "main header button, main header input")), ...(await boxes(page, "aside button"))];
    expect(found.length).toBeGreaterThan(8);
    for (const b of found) {
      expect(whole(b.top), `${b.name} top ${b.top}`).toBe(true);
      expect(whole(b.height), `${b.name} height ${b.height}`).toBe(true);
      if (b.iconOnly) expect(whole(b.width), `${b.name} width ${b.width}`).toBe(true);
    }
  });
}

test("controls moved one size down keep today's density (O1)", async ({ page }) => {
  await openApp(page);
  const header = page.locator("main header");
  expect((await header.getByRole("button", { name: /New profile/ }).boundingBox())!.height).toBe(30);
  // Filters, Display, More actions and New profile were `small` (31.5 px):
  // now `xsmall`, 30 px (owner: never larger, whole pixels; Task 14 fix round).
  expect((await header.getByRole("button", { name: "More actions" }).boundingBox())!.height).toBe(30);
  await openSearch(page);
  expect((await header.getByRole("searchbox").locator("xpath=..").boundingBox())!.height).toBe(30);
  expect((await page.locator("[role='row'][data-profile-id]").first().boundingBox())!.height).toBe(36);
  expect((await page.locator("aside [aria-current='page']").boundingBox())!.height).toBe(28);
});

test("one radius scale: controls 8, surfaces 12, dialogs 12 (UI-07; borderless, owner 2026-10-01)", async ({ page }) => {
  await openApp(page);
  // The list is a tile (borderless step 2): the tile radius, 10.
  expect(await radius(page, page.locator("[data-list-tile]"))).toBe("10px");
  expect(await radius(page, page.locator("main header").getByRole("button", { name: /New profile/ }))).toBe("8px");
  await page.locator("aside").getByRole("button", { name: "New folder" }).click();
  expect(await radius(page, page.getByRole("dialog", { name: /New folder/ }))).toBe("12px");
});

test("a menu's items nest inside its corners: outer = item + padding (UI-19)", async ({ page }) => {
  await openApp(page);
  await page.locator("[role='row'][data-profile-id]").first().click({ button: "right" });
  const menu = page.getByRole("menu");
  const outer = Number.parseFloat(await radius(page, menu));
  const pad = Number.parseFloat(await menu.evaluate((el) => getComputedStyle(el).paddingTop));
  const inner = Number.parseFloat(await radius(page, menu.getByRole("menuitem").first()));
  expect(outer).toBe(inner + pad);
});

// LAYOUT-03, then the owner (Task 14 fix round): nothing larger than before
// the 4 px grid. One dialog shell (C20a, then the controller's Pair 48
// ruling): header, body and footer share the 14 px side inset (the owner's
// "header 14 px in"), so the title lines up with the body; the header is
// 14 px from the top, as it was. The close button sits 14 px in: the 15
// it was, less the 1 px border the panel no longer has (borderless).
test("a dialog's header, body and footer share one side inset (LAYOUT-03)", async ({ page }) => {
  await openApp(page);
  await page.locator("aside").getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: /New folder/ });
  const header = dialog.locator(":scope > div").first();
  const parts = dialog.locator("form > div");
  expect(await parts.count()).toBe(2);
  const pad = (l: ReturnType<Page["locator"]>, side: "Left" | "Top") => l.evaluate((el, s) => getComputedStyle(el)[`padding${s}`], side);
  expect(await pad(header, "Left")).toBe("14px");
  expect(await pad(header, "Top")).toBe("14px");
  expect(await pad(parts.nth(0), "Left")).toBe("14px");
  expect(await pad(parts.nth(1), "Left")).toBe("14px");
  for (const p of [header, parts.nth(0), parts.nth(1)]) expect(await p.evaluate((el) => getComputedStyle(el).paddingRight)).toBe("14px");
  // Measured once it has scaled in (it opens from 0.96).
  await expect(dialog).toHaveAttribute("data-state", "open");
  const panel = (await dialog.boundingBox())!;
  const close = (await dialog.getByRole("button", { name: "Close" }).boundingBox())!;
  expect(Math.round(panel.x + panel.width - (close.x + close.width))).toBe(14);
});
