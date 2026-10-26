import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// Borderless, step 2, section 5 (owner, 2026-10-01): the wells and lists
// inside dialogs and pickers lose their rings and borders. A list is a tile
// (the weak fill, the 10 px corner), a readout well is the weak fill, and a
// hand-rolled list's row dividers are the DataList's variant b: a soft line
// inset 12 px, hidden beside a hovered row.

/** Shadow layers that draw a ring: no offset, no blur, a spread of 1 px or
 *  more, in a color that shows. */
const ringsOf = (shadow: string): string[] => {
  if (shadow === "none") return [];
  return shadow.split(/,(?![^(]*\))/).filter((layer) => {
    const color = layer.match(/rgba?\([^)]*\)/)?.[0] ?? "";
    const alpha = /rgba\(/.test(color) ? Number(color.match(/[\d.]+/g)![3]) : 1;
    const [x, y, blur, spread] = (layer.replace(color, "").match(/-?[\d.]+px/g) ?? []).map(parseFloat);
    return alpha > 0 && x === 0 && y === 0 && (blur ?? 0) === 0 && (spread ?? 0) >= 1;
  });
};

async function expectNoEdge(el: Locator, what: string) {
  const { borders, shadow } = await el.evaluate((node) => {
    const cs = getComputedStyle(node);
    return { borders: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth], shadow: cs.boxShadow };
  });
  expect(borders, `${what}: border widths`).toEqual(["0px", "0px", "0px", "0px"]);
  expect(ringsOf(shadow), `${what}: a ring among its shadows (${shadow})`).toEqual([]);
}

const after = (el: Locator) => el.evaluate((node) => {
  const cs = getComputedStyle(node, "::after");
  return { content: cs.content, left: cs.left, right: cs.right, height: cs.height, top: cs.top, opacity: cs.opacity };
});
const fillOf = (el: Locator) => el.evaluate((node) => getComputedStyle(node).backgroundColor);
const TILE = "tile";

const bar = (page: Page) => page.getByRole("toolbar", { name: /selected/ });

test("the Assign dialog's profile list is a tile with no ring", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id='px-dead'] [data-cell='checkbox'] input").check({ force: true });
  await bar(page).getByRole("button", { name: /Assign to profiles/ }).click();
  const dialog = page.getByRole("dialog", { name: /Assign 1 proxy/ });
  const list = dialog.locator("[data-windowed]").first();
  await expect(list).toBeVisible();
  await expect(list).toHaveClass(new RegExp(`\\b${TILE}\\b`));
  await expectNoEdge(list, "profile list");
  expect(await list.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("10px");
  expect(await fillOf(list)).not.toBe("rgba(0, 0, 0, 0)");
});

test("the Assign dialog's proxy picker is a tile with no ring", async ({ page }) => {
  await openApp(page);
  for (const n of ["Sandbox", "Scraper pricing"]) await page.locator("[role='row'][data-profile-id]", { hasText: n }).locator("[data-cell='checkbox'] input").check({ force: true });
  await bar(page).getByRole("button", { name: /Assign proxies/ }).click();
  const spread = page.getByRole("dialog", { name: /Assign proxies/ }).locator("[data-assign-dialog] .tile").first();
  await expect(spread).toBeVisible();
  await expectNoEdge(spread, "proxy picker");
});

test("the importer's preview is a tile, and its row lines are inset 12 px and skip the first row", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.locator("main header").getByRole("button", { name: "Add proxies" }).click();
  const dialog = page.getByRole("dialog", { name: "Add proxies" });
  await dialog.getByRole("textbox", { name: "Paste one proxy per line" }).fill("socks5://10.9.0.1:1080\nsocks5://10.9.0.2:1080\nsocks5://10.9.0.3:1080");
  await dialog.getByRole("button", { name: "Preview" }).click();
  const list = dialog.locator("[data-windowed]");
  await expect(list).toBeVisible();
  await expect(list).toHaveClass(new RegExp(`\\b${TILE}\\b`));
  await expectNoEdge(list, "preview list");
  const rows = list.locator(".import-cols");
  await page.mouse.move(1, 1);
  expect((await after(rows.nth(0))).opacity, "no line above the first row").toBe("0");
  expect(await after(rows.nth(1))).toMatchObject({ left: "12px", right: "12px", height: "1px", top: "0px", opacity: "1" });
  for (const r of await rows.all()) await expectNoEdge(r, "row");
  await rows.nth(1).hover();
  await expect.poll(async () => (await after(rows.nth(1))).opacity).toBe("0");
  expect((await after(rows.nth(2))).opacity).toBe("0");
});

test("a chosen Folder icon keeps its fill and has no ring", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: /New folder/ });
  const icon = dialog.getByRole("radio", { name: "Briefcase" });
  await icon.click();
  await expect(icon).toBeChecked();
  await expectNoEdge(icon, "chosen icon");
  expect(await fillOf(icon), "the chosen icon keeps a fill").not.toBe("rgba(0, 0, 0, 0)");
  // The fill is the hover fill (owner: the active fill equals the hover fill).
  await page.mouse.move(1, 1);
  const rest = await fillOf(icon);
  await icon.hover();
  expect(await fillOf(icon)).toBe(rest);
});
