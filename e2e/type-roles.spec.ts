import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// Audit Phase B, B3: one role per job (typography.md 3.2). These read computed
// styles, so they hold whatever class carries the role.

type Type = { size: string; leading: string; weight: string; color: string; transform: string; tracking: string };
const typeOf = (l: Locator): Promise<Type> =>
  l.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { size: cs.fontSize, leading: cs.lineHeight, weight: cs.fontWeight, color: cs.color, transform: cs.textTransform, tracking: cs.letterSpacing };
  });
const tab = (page: Page, name: string) =>
  page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name });

test("a setting's name differs from its help on size, weight and color (ruling 4, F30)", async ({ page }) => {
  await openApp(page, { section: "settings" });
  const row = page.locator("main [data-setting='language']");
  const name = await typeOf(row.getByText("Interface language", { exact: true }));
  const help = await typeOf(row.locator("[data-setting-help]"));
  expect(name).toMatchObject({ size: "13px", weight: "500" });
  expect(help).toMatchObject({ size: "12px", weight: "400" });
  expect(help.color).not.toBe(name.color);
});

test("Settings names the open section and keeps a setting's help to one line (TYPE-05, TYPE-10)", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "Profile defaults").click();
  const heading = page.locator("main h2");
  await expect(heading).toHaveText("Profile defaults");
  expect((await typeOf(heading)).size).toBe("15px");
  // A setting's help is one line (F30), so it needs no reading width.
  const help = page.locator("main [data-setting-help]").first();
  expect(await typeOf(help)).toMatchObject({ size: "12px", leading: "18px" });
  expect(await help.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(19);
});

test("a profile's name in the list is the size of the sidebar item (TYPE-02)", async ({ page }) => {
  await openApp(page);
  const name = page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='name']").getByText("Sandbox", { exact: true });
  expect(await typeOf(name)).toMatchObject({ size: "13px", weight: "500" });
  expect((await typeOf(page.locator("aside [aria-current='page']"))).size).toBe("13px");
});

test("page, dialog and field text descend: 18/600, 15/600, 12/500 (TYPE-10)", async ({ page }) => {
  await openApp(page);
  expect(await typeOf(page.locator("main header h1"))).toMatchObject({ size: "18px", weight: "600" });
  await page.locator("aside").getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: /New folder/ });
  // The kit's own roles, read in the browser: a typo in a role's values
  // would pass every other gate (review of Tasks 8 and 9).
  const title = dialog.locator("h2");
  await expect(title).toHaveClass(/\btext-panel-title\b/);
  // -0.015em at 15 px (owner, 2026-10-01: negative tracking, never positive).
  expect(await typeOf(title)).toMatchObject({ size: "15px", leading: "20px", weight: "600", tracking: "-0.225px" });
  const label = dialog.getByText("Name", { exact: true });
  await expect(label).toHaveClass(/\btext-field-label\b/);
  expect(await typeOf(label)).toMatchObject({ size: "12px", leading: "16px", weight: "500" });
});

// Section labels are sentence case, as in premium products (owner,
// 2026-10-01: "make it more like in premium products"): no text anywhere is
// transformed to capitals. The sidebar uses its group heading, FoldHeading,
// and Peek its section label.
test("no text is transformed to capitals; a section label is 12 px medium, sentence case, tracked -0.01em", async ({ page }) => {
  await openApp(page);
  await page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek]")).toBeVisible();
  const places = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => getComputedStyle(el).textTransform === "uppercase" && el.textContent?.trim())
      .map((el) => (el.closest("aside[data-peek]") ? "peek" : el.closest("aside") ? "sidebar"
        : el.textContent!.trim().slice(0, 30))),
  );
  expect(places).toEqual([]);
  const label = await typeOf(page.locator("aside[data-peek] h3").first());
  expect(label).toMatchObject({ size: "12px", weight: "500", tracking: "-0.12px", transform: "none" });
});

test("the API address is code, not bold text (TYPE-06, TYPE-08)", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "API & MCP").click();
  await expect(page.locator("main code", { hasText: "127.0.0.1" })).toBeVisible();
  await expect(page.locator("main strong", { hasText: "127.0.0.1" })).toHaveCount(0);
});

test("in Chinese, micro and section label text is 12 px with no tracking (TYPE-03)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
  await openApp(page);
  const group = await typeOf(page.locator("aside .text-section-label").first());
  expect(group.size).toBe("12px");
  expect(Number.parseFloat(group.tracking) || 0).toBe(0);
});

test("no text on the main pages is smaller than 11 px, or off the scale", async ({ page }) => {
  const sizes = new Set<string>();
  for (const section of ["profiles", "proxies", "fingerprints", "settings", "trash"]) {
    await openApp(page, { section });
    for (const s of await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main *, aside *")]
        .filter((el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()))
        .map((el) => getComputedStyle(el).fontSize),
    )) sizes.add(s);
  }
  expect([...sizes].filter((s) => !["11px", "12px", "13px", "15px", "18px"].includes(s))).toEqual([]);
});
