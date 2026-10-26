import { expect, test, type Page } from "@playwright/test";

// F23: the kit DataList with a saved layout (useListLayout), on its test
// page. Every layout choice a person makes comes back after a restart, and
// columns size to their content until a person sizes them (owner, 2026-09-30).
const open = (page: Page) => page.goto("/e2e/kit/datalist.html");
const grid = (page: Page) => page.getByRole("treegrid", { name: "Things" });
const rows = (page: Page) => grid(page).locator("[role='row'][data-row-id]");
const row = (page: Page, name: string) => rows(page).filter({ hasText: name });
const titles = (page: Page) => grid(page).locator("[role='row'][aria-rowindex='1'] [data-col]").allTextContents();
const LONG = "A very long name that nobody else comes close to";

test("columns size to their content: one long name leaves Name at the others' width, cut, and whole on hover", async ({ page }) => {
  await open(page);
  const long = row(page, LONG).locator("[data-cell='name'] span.truncate");
  await expect.poll(() => long.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const alpha = row(page, "Alpha").locator("[data-cell='name'] span.truncate");
  expect(await alpha.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await long.hover();
  await expect(page.getByRole("tooltip")).toHaveText(LONG);
});

// The row stretches to the list (owner, 2026-10-23): a width a key sets is
// the width drawn, and the next column takes the px (Size, the last, sits at
// its content and has none to give a wider Folder).
test("a width, a hidden column and a sort are saved and come back after a restart", async ({ page }) => {
  await open(page);
  const folder = grid(page).locator("[data-col='folder']");
  const before = (await folder.boundingBox())!.width;
  await page.getByRole("separator", { name: "Resize Folder" }).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => Math.abs((await folder.boundingBox())!.width - (before - 16))).toBeLessThanOrEqual(1);
  await grid(page).getByRole("button", { name: "Columns" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Size" }).click();
  await page.keyboard.press("Escape");
  await grid(page).locator("[data-col='name']").click({ button: "right" });
  await page.getByRole("menuitemradio", { name: "Descending" }).click();
  await expect(rows(page).first()).toContainText("Kilo");

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("shardx.test.datalist.layout") ?? "null"));
  expect(stored).toMatchObject({ hidden: ["size"], sort: { id: "name", dir: "descending" } });
  expect(Object.keys(stored.widths)).toEqual(["folder"]);
  expect(Math.abs(stored.widths.folder - (before - 16))).toBeLessThanOrEqual(1);

  await page.reload();
  expect(await titles(page)).toEqual(["Name", "Folder"]);
  expect(Math.round((await grid(page).locator("[data-col='folder']").boundingBox())!.width)).toBe(stored.widths.folder);
  await expect(rows(page).first()).toContainText("Kilo");
  await expect(grid(page).locator("[data-col='name']")).toHaveAttribute("aria-sort", "descending");
});

test("a click anywhere on a checkbox row toggles it once; its box does too", async ({ page }) => {
  await open(page);
  const beta = row(page, "Beta");
  await beta.locator("[data-cell='folder']").click();
  await expect(beta).toHaveAttribute("aria-selected", "true");
  await beta.locator("[data-cell='name']").click();
  await expect(beta).toHaveAttribute("aria-selected", "false");
  await beta.getByRole("checkbox", { name: "Select Beta" }).click();
  await expect(beta).toHaveAttribute("aria-selected", "true");
});

// F24 (the Pair 31 carry): in a list that selects nothing, Name has no
// 28 px box before it and pins at the card's left while the rest scrolls
// sideways; before, only the row actions pinned.
test("a list that selects nothing keeps Name pinned at the card's left while it scrolls sideways", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.test.datalist.layout", JSON.stringify({ v: 2, order: ["name", "folder", "size"], hidden: [], widths: { folder: 320 }, sort: null })));
  await page.goto("/e2e/kit/datalist.html?noSelect");
  // The scroll box around the treegrid.
  const box = grid(page).locator("xpath=..");
  await expect(box).toHaveAttribute("data-pin-first", "true");
  await expect(rows(page).first().getByRole("checkbox")).toHaveCount(0);
  const name = rows(page).first().locator("[data-cell='name']");
  const at = async () => (await name.boundingBox())!.x;
  const before = await at();
  await box.evaluate((el) => { el.scrollLeft = 120; });
  // It scrolls as far as its columns reach past the card (about 60 px here).
  await expect.poll(() => box.evaluate((el) => el.scrollLeft)).toBeGreaterThan(30);
  expect(Math.abs((await at()) - before)).toBeLessThanOrEqual(0.5);
  // Its fill covers the row's side padding and the tile's 4 px inset past it,
  // so what scrolls under it never shows beside it.
  const fill = await name.evaluate((el) => { const s = getComputedStyle(el, "::before"); return { left: s.left, bg: s.backgroundColor }; });
  expect(fill.left).toBe("-16px");
  expect(fill.bg).not.toBe("rgba(0, 0, 0, 0)");
});
