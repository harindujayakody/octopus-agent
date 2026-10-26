import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, type Theme } from "./support/app";

// Active equals hover (owner, 2026-10-01: "lets use for active state grey as
// we have on hover state and when clicks it getting darker and then to
// active same as hover color"): a current item (the sidebar's current page,
// the list's target row) is the hover gray; pressed, it is one step darker
// at once; released, it settles back to the hover gray.

const resolve = (page: Page, css: string) => page.evaluate((value) => {
  const probe = document.createElement("div");
  probe.style.backgroundColor = value;
  document.body.append(probe);
  const v = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return v;
}, css);
const bg = (el: Locator) => el.evaluate((node) => getComputedStyle(node).backgroundColor);

/** A row as it paints over its list: the page, the list's tile, then the
 *  row's own fill color and its first gradient layer, composited. */
const painted = (row: Locator) => row.evaluate((el) => {
  const tile = el.closest(".list-tile")!;
  const cs = getComputedStyle(el);
  const layers = [
    getComputedStyle(document.querySelector("main")!).backgroundColor,
    getComputedStyle(tile).backgroundColor,
    cs.backgroundColor,
    ...(cs.backgroundImage.match(/(?:rgba?|oklch|oklab|color)\([^)]*\)/)?.slice(0, 1) ?? []),
  ];
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const x = c.getContext("2d")!;
  for (const l of layers) { x.fillStyle = l; x.fillRect(0, 0, 1, 1); }
  return [...x.getImageData(0, 0, 1, 1).data].join(",");
});

for (const theme of ["light", "dark"] as Theme[]) {
  test(`the current sidebar item is the hover gray (${theme})`, async ({ page }) => {
    await openApp(page, { theme });
    const current = page.locator("aside [aria-current='page']");
    await expect(current).toHaveCount(1);
    const other = page.locator("aside [data-nav='proxies']");
    await other.hover();
    expect(await bg(current)).toBe(await bg(other));
    expect(await bg(current)).toBe(await resolve(page, "var(--bg-hover)"));
  });

  test(`a list's target row is the hover gray, as a hovered row is (${theme})`, async ({ page }) => {
    await openApp(page, { section: "bookmarks", theme });
    const rows = page.locator("main [role='row'][data-row-id]");
    await expect(rows.nth(2)).toBeVisible();
    await rows.nth(2).hover();
    const hovered = await painted(rows.nth(2));
    // The keys make the next row the target: the row-fill-active row.
    await page.mouse.move(1, 1);
    await rows.first().focus();
    await page.keyboard.press("ArrowDown");
    const target = page.locator("main [role='row'][data-row-id][data-active]");
    await expect(target).toBeFocused();
    expect(await painted(target)).toBe(hovered);
  });

  test(`pressing a sidebar item darkens it one step at once, and on release it is the hover gray (${theme})`, async ({ page }) => {
    await openApp(page, { theme });
    const item = page.locator("aside [data-nav='proxies']");
    const box = (await item.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    expect(await bg(item)).toBe(await resolve(page, "var(--bg-active)"));
    expect(await bg(item)).not.toBe(await resolve(page, "var(--bg-hover)"));
    await page.mouse.up();
    await expect(item).toHaveAttribute("aria-current", "page");
    expect(await bg(item)).toBe(await resolve(page, "var(--bg-hover)"));
  });
}
