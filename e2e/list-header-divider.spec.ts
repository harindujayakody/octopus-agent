import { expect, test, type Locator } from "@playwright/test";
import { openApp, type Theme } from "./support/app";

// The list header's line (owner, 2026-10-08: "hide top heading row bottom
// divider when first row is active or highlited"): the header's divider is
// the list's first line, and a highlighted first row (hovered, its panel
// open, checked, the keys' target, focused or pressed) would have it cut
// across its top. It hides while the row right under the header is one of
// those, as a row's own divider hides along a fill. A row further down leaves
// it, and so does a list scrolled off its top (the header then floats over
// rows, and keeps its line and its edge).

/** The header's divider as drawn: 1 while it shows, 0 while it is hidden. */
const lineOf = (head: Locator) => head.evaluate((el) => Number(getComputedStyle(el, "::after").opacity));

/** The line settles at once for CSS states; a React-set one (the keys' target, the open panel) takes a frame. */
const expectLine = (head: Locator, shown: 0 | 1, what: string) =>
  expect.poll(() => lineOf(head), { message: what }).toBe(shown);

for (const theme of ["light", "dark"] as Theme[]) {
  test(`Profiles: the header's line hides over a hovered or open first row, stays over any other, and stays once the list is scrolled (${theme})`, async ({ page }) => {
    await page.addInitScript(() => Object.assign(window, { __shardxMockProfiles: 60 }));
    await openApp(page, { theme });
    const grid = page.getByRole("treegrid");
    const head = grid.locator("[data-list-header]");
    const rows = page.locator("[role='row'][data-profile-id]");
    await expect(rows.nth(1)).toBeVisible();
    await page.mouse.move(1, 1);
    await expectLine(head, 1, "at rest");

    await rows.first().hover();
    await expectLine(head, 0, "first row hovered");
    await rows.nth(1).hover();
    await expectLine(head, 1, "second row hovered");

    // The list scrolled a little: the first row is mostly under the header,
    // which keeps its line (and its edge) while rows pass under it.
    await grid.evaluate((el) => { el.scrollTop = 20; });
    await expect(head).toHaveAttribute("data-scrolled", "");
    const bar = (await head.boundingBox())!;
    await page.mouse.move(bar.x + 200, bar.y + bar.height + 8);
    await expect(rows.first()).toBeVisible();
    await expectLine(head, 1, "first row hovered, list scrolled");
    await grid.evaluate((el) => { el.scrollTop = 0; });
    await expect(head).not.toHaveAttribute("data-scrolled");

    // Its panel open: the row stays marked after the pointer leaves.
    await rows.first().locator("[data-cell='name']").click();
    await expect(page.locator("aside[data-peek='profile']")).toBeVisible();
    await page.mouse.move(1, 1);
    await expect(rows.first()).toHaveAttribute("data-peek-open", "true");
    await expectLine(head, 0, "first row open in its panel");
  });

  test(`Bookmarks: the header's line hides over a hovered first row and stays over any other (${theme})`, async ({ page }) => {
    await openApp(page, { section: "bookmarks", theme });
    const head = page.locator("main [data-list-header]");
    const rows = page.locator("main [role='row'][data-row-id]");
    await expect(rows.nth(1)).toBeVisible();
    await page.mouse.move(1, 1);
    await expectLine(head, 1, "at rest");

    await rows.first().hover();
    await expectLine(head, 0, "first row hovered");
    await rows.nth(1).hover();
    await expectLine(head, 1, "second row hovered");
  });
}

test("Profiles: the header's line hides over a checked first row once the pointer is away", async ({ page }) => {
  await openApp(page, { theme: "light" });
  const head = page.getByRole("treegrid").locator("[data-list-header]");
  const rows = page.locator("[role='row'][data-profile-id]");
  await expect(rows.nth(1)).toBeVisible();
  await rows.first().hover();
  await rows.first().getByRole("checkbox").click();
  await page.mouse.move(1, 1);
  await expect(rows.first()).toHaveAttribute("aria-selected", "true");
  await expectLine(head, 0, "first row checked");
});

test("Bookmarks: the header's line hides over the first row the keys target or focus, and comes back when they move on", async ({ page }) => {
  await openApp(page, { section: "bookmarks", theme: "light" });
  const head = page.locator("main [data-list-header]");
  const rows = page.locator("main [role='row'][data-row-id]");
  await expect(rows.nth(1)).toBeVisible();
  await page.mouse.move(1, 1);
  await expectLine(head, 1, "at rest");
  await rows.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("data-active", "true");
  await expectLine(head, 1, "second row targeted");
  await page.keyboard.press("ArrowUp");
  await expect(rows.first()).toHaveAttribute("data-active", "true");
  await expectLine(head, 0, "first row targeted by the keys");
});
