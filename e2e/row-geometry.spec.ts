import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, row, type Theme } from "./support/app";

// Owner corrections 2026-10-07, items 9 and 20. The row's checkbox has its
// own slot before Name in every state, so it never covers the name ("ile
// test") and Name never moves; a column every row leaves empty is as wide as
// its title, never a hole; the pinned cells (Name, the row actions) are the
// row's own color in every state, by the pixel, in both themes (a cheap
// monitor showed them as lighter blocks); a focused row's ring lies inside
// the row and runs whole over the pinned cells.

const grid = (page: Page) => page.getByRole("treegrid", { name: "Profiles" });
const header = (page: Page) => grid(page).locator("[data-list-header]");

type Rect = { x: number; y: number; right: number; bottom: number; width: number; height: number };
const rect = (l: Locator): Promise<Rect> => l.evaluate((el) => {
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
});

/** The page as it paints: one screenshot, read back pixel by pixel in the
 *  page's own canvas (no PNG library), "r,g,b" at each point. */
async function pixels<K extends string>(page: Page, points: Record<K, { x: number; y: number }>): Promise<Record<K, string>> {
  const shot = (await page.screenshot()).toString("base64");
  const where: Record<string, { x: number; y: number }> = points;
  return page.evaluate(async ({ shot, points }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${shot}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.drawImage(img, 0, 0);
    return Object.fromEntries(Object.entries(points).map(([k, p]) => (
      [k, [...x.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data].slice(0, 3).join(",")]
    )));
  }, { shot, points: where }) as Promise<Record<K, string>>;
}

const rgbOf = (page: Page, css: string) => page.evaluate((value) => {
  const probe = document.createElement("span");
  probe.style.color = value;
  document.body.append(probe);
  const m = getComputedStyle(probe).color.match(/[\d.]+/g)!.map(Number);
  probe.remove();
  return m.slice(0, 3).join(",");
}, css);

test("hovering a row never covers the name, and Name never moves: at rest, on hover, in selection mode", async ({ page }) => {
  await openApp(page, { theme: "light" });
  const r = row(page, "Sandbox");
  const name = r.locator("[data-cell='name'] [data-name]");
  // The checkbox's own 17 px box (its label holds nothing else).
  const box = r.locator(".list-select-box label");
  const rest = { box: await rect(box), name: await rect(name) };
  expect(rest.box.right).toBeLessThan(rest.name.x);

  await r.locator("[data-cell='status']").hover();
  await expect(r.getByRole("checkbox", { name: "Select Sandbox" })).toBeVisible();
  const hover = { box: await rect(box), name: await rect(name) };
  expect(hover.box.right).toBeLessThan(hover.name.x);
  expect(hover.name.x).toBe(rest.name.x);
  // Nothing lies over the name's first letters: the pointer finds the name there.
  expect(await name.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return document.elementFromPoint(b.x + 2, b.y + b.height / 2) === el;
  })).toBe(true);

  // Selection mode: every box shows, in the same slot; the name stays put.
  await r.getByRole("checkbox", { name: "Select Sandbox" }).click();
  await expect(grid(page)).toHaveClass(/has-selection/);
  const selecting = { box: await rect(box), name: await rect(name) };
  expect(selecting.name.x).toBe(rest.name.x);
  expect(selecting.box.x).toBe(rest.box.x);
  expect(selecting.box.right).toBeLessThan(selecting.name.x);
});

test("an empty Folder column is no wider than its header", async ({ page }) => {
  await openApp(page, { theme: "light" });
  // The No proxy view holds Sandbox alone, which is in no folder.
  await page.locator("aside [data-view='builtin:no-proxy']").click();
  await expect(grid(page).locator("[role='row'][data-profile-id]")).toHaveCount(1);
  await expect(grid(page).locator("[role='row'][data-profile-id] [data-cell='folder']")).toHaveText("");
  const col = header(page).locator("[data-col='folder']");
  const title = await col.locator("[data-col-title]").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().width;
  });
  expect(title).toBeGreaterThan(0);
  // The title and the 1 px a fitted track keeps, rounded up to a whole px.
  await expect.poll(async () => (await rect(col)).width).toBeLessThanOrEqual(Math.ceil(title + 1));
});

for (const theme of ["light", "dark"] as Theme[]) {
  test(`pinned cells match their row: at rest, hovered, selected, selected and hovered (${theme})`, async ({ page }) => {
    await openApp(page, { theme });
    const r = row(page, "Sandbox");
    // Above the text, the pill and the buttons, under the row's top line:
    // each cell's own background. Name and the row actions are pinned.
    const sample = async () => {
      const b = await rect(r);
      const name = await rect(r.locator("[data-cell='name']"));
      const status = await rect(r.locator("[data-cell='status']"));
      return pixels(page, {
        name: { x: name.x + 2, y: b.y + 3 },
        status: { x: status.x + 2, y: b.y + 3 },
        actions: { x: b.right - 6, y: b.y + 3 },
      });
    };
    const seen: Record<string, { name: string; status: string; actions: string }> = {};
    seen.rest = await sample();
    // Folder, not Notes: the stretched Notes at 1280 lies under the hover strip.
    await r.locator("[data-cell='folder']").hover();
    await expect(r).toHaveAttribute("data-active", "true");
    seen.hover = await sample();
    await r.locator("[data-cell='checkbox'] input").check({ force: true });
    await page.mouse.move(1, 1);
    await expect(r).toHaveAttribute("aria-selected", "true");
    seen.selected = await sample();
    await r.locator("[data-cell='folder']").hover();
    seen.selectedHover = await sample();
    console.log(`pinned vs row (${theme}): ${JSON.stringify(seen)}`);
    for (const [state, px] of Object.entries(seen)) {
      expect.soft(px.name, `${state}: the pinned Name cell vs the Status cell`).toBe(px.status);
      expect.soft(px.actions, `${state}: the pinned row actions vs the Status cell`).toBe(px.status);
    }
    // Four states, four fills: the samples are the fills, not one surface.
    expect(new Set(Object.values(seen).map((px) => px.status)).size).toBe(4);
  });
}

test("the row's hover or focus edge stays inside the row: the focused row's ring, whole over the pinned cells, never past the list's left edge", async ({ page }) => {
  await openApp(page, { theme: "dark" });
  const r = row(page, "Etsy craft shop");
  // The keys put focus on the rows (a ring), then the pointer comes onto
  // one: its box shows, and the focus follows the pointer (the owner's shot).
  await r.locator("[data-cell='status']").hover();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await r.locator("[data-cell='status']").hover();
  await expect(r).toBeFocused();
  expect(await r.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  await expect(r.getByRole("checkbox", { name: "Select Etsy craft shop" })).toBeVisible();

  // The outline is inset: its outer edge is the row's own edge.
  const outline = await r.evaluate((el) => {
    const cs = getComputedStyle(el);
    return parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth);
  });
  expect(outline).toBeLessThanOrEqual(0);

  const focus = await rgbOf(page, "var(--focus)");
  const b = await rect(r);
  const name = await rect(r.locator("[data-cell='name']"));
  const mid = b.y + b.height / 2;
  const px = await pixels(page, {
    // The ring, whole: down the left edge, over the select box and Name at
    // the top and bottom, and down the right edge past the row actions.
    left: { x: b.x + 1, y: mid },
    topOverBox: { x: b.x + 20, y: b.y + 1 },
    bottomOverBox: { x: b.x + 20, y: b.bottom - 1 },
    topOverName: { x: name.x + 20, y: b.y + 1 },
    right: { x: b.right - 1, y: mid },
    // Nothing of it outside the row: the list's own surface beside it.
    outside: { x: b.x - 2, y: mid },
  });
  const { outside, ...ring } = px;
  for (const [where, c] of Object.entries(ring)) expect.soft(c, `the ring at ${where}`).toBe(focus);
  expect(outside, "nothing of the ring past the row's left edge").not.toBe(focus);
});
