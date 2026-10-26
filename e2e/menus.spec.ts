import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";

test("right-clicking a profile row opens a keyboard menu that Escape closes", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  // The row's name, not the action card that may name it too (Live Task 8).
  await page.locator("[role='row'][data-profile-id]").getByText("Amazon US seller").click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // Opened by the pointer: nothing is highlighted until an arrow (Pair 30 ruling).
  await expect(menu).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem").nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});

test("right-clicking a proxy row opens the same kind of menu", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.getByText("DC New York").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("the Filters popover is a dialog that returns focus to its button", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  const trigger = page.getByRole("button", { name: /Filters/ });
  await trigger.click();
  const panel = page.getByRole("dialog", { name: /Filters/ });
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("a select inside the proxy editor opens above the dialog; Escape closes only the list", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.getByRole("button", { name: "Add proxies" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const trigger = dialog.getByRole("combobox").first();
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(dialog).toBeVisible();
});

test("a row's menu, opened from the keyboard, lists the keys that do the same", async ({ page }) => {
  await openApp(page);
  const r = page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" });
  await r.locator("[data-cell='status']").click();
  if (await page.locator("aside[data-peek]").count()) await page.keyboard.press("Escape");
  const more = r.getByRole("button", { name: "More actions" });
  await expect(more).toHaveAttribute("aria-haspopup", "menu");
  await more.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Sandbox" });
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitem", { name: /^Start/ })).toHaveAttribute("aria-keyshortcuts", "S");
  await expect(menu.getByRole("menuitem", { name: /^Rename/ })).toHaveAttribute("aria-keyshortcuts", "E");
  await expect(menu.getByRole("menuitem", { name: /^Move to Trash/ })).toHaveAttribute("aria-keyshortcuts", "Delete Backspace");
  await expect(menu.locator("kbd").first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "false");
});

test("Shift+F10 on a row opens its menu at the row, not the window corner", async ({ page }) => {
  await openApp(page);
  const r = page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" });
  await r.locator("[data-cell='status']").click();
  if (await page.locator("aside[data-peek]").count()) await page.keyboard.press("Escape");
  await r.focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // Opened from the keys: the first item has the keyboard (Pair 30 ruling).
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  const m = (await menu.boundingBox())!;
  const b = (await r.boundingBox())!;
  // At the row: it opens below the row, or above it when the room below is
  // short (the action cards put the rows ~100 px lower, Live Task 8).
  if (m.y < b.y) expect(m.y + m.height).toBeLessThan(b.y + b.height + 2);
  else expect(m.y).toBeGreaterThan(b.y - 2);
  expect(m.x).toBeGreaterThan(8);
});

// Pair 30 review, Important 2: a row menu's key caps promise "this row".
const profileRow = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const statusWord = (page: Page, name: string) => profileRow(page, name).locator("[data-cell='status'] [data-status-label]");

test("a right-click makes its row the active one; S in its menu starts that row, not the row that was active", async ({ page }) => {
  await openApp(page);
  await profileRow(page, "Sandbox").locator("[data-cell='status']").click();
  if (await page.locator("aside[data-peek]").count()) await page.keyboard.press("Escape");
  await expect(profileRow(page, "Sandbox")).toHaveAttribute("data-active");
  await profileRow(page, "Etsy craft shop").locator("[data-cell='name']").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Etsy craft shop" });
  // The item's word and its key read the same subject: this idle row.
  await expect(menu.getByRole("menuitem", { name: "Start" })).toHaveAttribute("aria-keyshortcuts", "S");
  await expect(profileRow(page, "Etsy craft shop")).toHaveAttribute("data-active");
  await page.keyboard.press("s");
  await expect(menu).toHaveCount(0);
  await expect(statusWord(page, "Etsy craft shop")).toHaveText("Running");
  await expect(statusWord(page, "Sandbox")).not.toHaveText(/Running|Starting/);
  await expect(profileRow(page, "Etsy craft shop")).toBeFocused();
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(0);
});

test("with two rows selected, S in a third row's menu acts on that row only; the selection stays", async ({ page }) => {
  await openApp(page);
  for (const name of ["Sandbox", "TikTok creator"]) {
    await profileRow(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
  }
  const selected = page.locator("[role='row'][aria-selected='true']");
  await expect(selected).toHaveCount(2);
  await profileRow(page, "Etsy craft shop").locator("[data-cell='name']").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Etsy craft shop" });
  await expect(menu.getByRole("menuitem", { name: "Start" })).toBeVisible();
  await page.keyboard.press("s");
  await expect(menu).toHaveCount(0);
  await expect(statusWord(page, "Etsy craft shop")).toHaveText("Running");
  await expect(statusWord(page, "Sandbox")).not.toHaveText(/Running|Starting/);
  await expect(statusWord(page, "TikTok creator")).not.toHaveText(/Running|Starting/);
  await expect(selected).toHaveCount(2);
  await expect(profileRow(page, "Sandbox")).toHaveAttribute("aria-selected", "true");
  await expect(profileRow(page, "TikTok creator")).toHaveAttribute("aria-selected", "true");
});

// E3: the row, Pinned and Peek menus and the hover buttons are the command
// registry's (UI-29, CRAFT-10, IFACE-05, IFACE-12, WRITE-26).
type Described = { id: string; label: string; cap: string | null; aria: string | null };
const describeIn = (page: Page, surface: string, area: string, ids: string[]) =>
  page.evaluate(([s, a, i]) => (window as unknown as { __cmds: { describe: (s: string, a: string, i: string[]) => Described[] } }).__cmds.describe(s, a, i), [surface, area, ids] as const);

async function expectMenuMatches(page: Page, want: Described[]) {
  const items = page.getByRole("menu").getByRole("menuitem");
  await expect(items).toHaveCount(want.length);
  for (const [i, w] of want.entries()) {
    await expect(items.nth(i)).toHaveAccessibleName(new RegExp(`^${w.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    if (w.aria) await expect(items.nth(i)).toHaveAttribute("aria-keyshortcuts", w.aria);
    else await expect(items.nth(i)).not.toHaveAttribute("aria-keyshortcuts", /.+/);
  }
}

test("the row menu is the registry's, with icons, keys and a Proxy item", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/features/commands/index.ts", "__cmds");
  const want = await describeIn(page, "rowMenu", "profiles", ["f62a9d43"]);
  await profileRow(page, "Sandbox").click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Sandbox" })).toBeVisible();
  await expectMenuMatches(page, want);
  await expect(page.getByRole("menuitem", { name: /^Change proxy/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^Open in Peek/ }).locator("svg")).toHaveAttribute("data-icon", "open-peek");
});

test("a right-click on a selected row acts on the selection and says so", async ({ page }) => {
  await openApp(page);
  for (const name of ["Etsy craft shop", "FB Ads acc-02", "Sandbox"]) {
    await profileRow(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
  }
  await profileRow(page, "FB Ads acc-02").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "3 profiles" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Assign proxies/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Rename/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // The selection stays; an unselected row's menu is that row alone.
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(3);
  await profileRow(page, "Amazon US seller").click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Amazon US seller" })).toBeVisible();
});

test("hover buttons are registry commands: names and keys in their tooltips", async ({ page }) => {
  await openApp(page);
  const r = profileRow(page, "Sandbox");
  await r.hover();
  await expect(r.getByRole("button", { name: "Open in Peek" })).toHaveAttribute("aria-keyshortcuts", "Enter Space");
  await expect(r.getByRole("button", { name: "Move to Trash" })).toHaveAttribute("aria-keyshortcuts", "Delete Backspace");
  await expect(r.getByRole("button", { name: "Pin", exact: true })).toBeVisible();
  await expect(r.getByRole("button", { name: "Clone" })).toBeVisible();
  await expect(r.getByRole("button", { name: "Start" })).toHaveAttribute("aria-keyshortcuts", "S");
});

test("the Proxies row menu and hover buttons come from the registry too", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await appModule(page, "/src/features/commands/index.ts", "__cmds");
  const want = await describeIn(page, "rowMenu", "proxies", ["px-us-2"]);
  const r = page.locator("[role='row'][data-proxy-id='px-us-2']");
  await r.click({ button: "right" });
  await expectMenuMatches(page, want);
  await page.keyboard.press("Escape");
  await r.hover();
  await expect(r.getByRole("button", { name: "Test" })).toHaveAttribute("aria-keyshortcuts", "T");
  await expect(r.getByRole("button", { name: "Open in Peek" })).toBeVisible();
});

test("Peek has a … menu with the row menu's organize and copy items", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/features/commands/index.ts", "__cmds");
  const want = await describeIn(page, "peekMenu", "profiles", ["f62a9d43"]);
  await profileRow(page, "Sandbox").focus();
  await page.keyboard.press("Enter");
  const peek = page.locator("aside[data-peek]");
  const more = peek.getByRole("button", { name: "More actions" });
  await expect(more).toHaveAttribute("aria-haspopup", "menu");
  await more.click();
  await expectMenuMatches(page, want);
  await page.getByRole("menuitem", { name: /^Clone/ }).click();
  await expect(profileRow(page, "Sandbox (copy)")).toHaveCount(1);
});

test("Peek's Import cookies says why while the profile runs", async ({ page }) => {
  await openApp(page);
  await profileRow(page, "Amazon US seller").focus();
  await page.keyboard.press("Enter");
  await page.locator("aside[data-peek]").getByRole("button", { name: "More actions" }).click();
  const item = page.getByRole("menuitem", { name: /^Import cookies/ });
  await expect(item).toHaveAttribute("aria-disabled", "true");
  await expect(item).toHaveAccessibleDescription("Stop the profile first");
});

test("the sidebar's pinned item menu: Start or Stop, Show in list, Unpin", async ({ page }) => {
  await openApp(page);
  await page.locator("aside [data-pinned='c31d92f0']").click({ button: "right" });
  const menu = page.getByRole("menu", { name: "FB Ads acc-01" });
  await expect(menu.getByRole("menuitem")).toHaveText([/^Start/, /^Show in list/, /^Unpin/]);
});

test("a key prints only on a page where it works: the Pinned menu on Proxies shows no S", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.locator("aside [data-pinned='c31d92f0']").click({ button: "right" });
  const start = page.getByRole("menu", { name: "FB Ads acc-01" }).getByRole("menuitem", { name: /^Start/ });
  await expect(start).toBeVisible();
  await expect(start).not.toHaveAttribute("aria-keyshortcuts", /.+/);
  await expect(start.locator("kbd")).toHaveCount(0);
});
