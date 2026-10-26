import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { searchField } from "./support/search";

// O14 and WCAG 2.1.4 (E23): the page-wide single keys (C, /, ? and the G
// sequences) can be turned off; the list's keys, active only while the list
// has the keyboard, and every Mod shortcut stay.
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const turnOff = async (page: Page) => {
  await openApp(page, { section: "settings" });
  const toggle = page.getByRole("switch", { name: "Single-key shortcuts" });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  // Nothing changes until Save (manual save).
  await page.locator("[data-save-bar]").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-save-bar]")).toHaveCount(0);
  await page.locator("aside [data-nav='profiles']").click();
};

test("with Single-key shortcuts off, C, /, ? and G do nothing; list keys and Cmd+K still work", async ({ page }) => {
  await turnOff(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const rows = page.locator("[role='row'][data-profile-id]");
  const before = await rows.count();
  await page.keyboard.press("c");
  await page.keyboard.press("/");
  await page.keyboard.type("?");
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(rows).toHaveCount(before);
  // The search rests folded as a button (vf-f, merge point 12): / leaves it folded.
  await expect(searchField(page)).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(heading(page)).toHaveText("All profiles");
  // The list's own keys: still on while the list has the keyboard.
  await row(page, "Sandbox").focus();
  await page.keyboard.press("x");
  await expect(row(page, "Sandbox")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("combobox", { name: "Search commands" })).toBeFocused();
});

test("the switch is one setting row, remembered, and the sheet says which keys are off", async ({ page }) => {
  await openApp(page, { section: "settings" });
  // An F30 row: its name, one line of help (LAYOUT-16).
  const help = page.locator("[data-setting='single-keys'] [data-setting-help]");
  expect((await help.boundingBox())!.height).toBeLessThanOrEqual(19);
  await turnOff(page);
  await page.reload();
  await expect(page.locator("[role='row'][data-profile-id]").first()).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("shortcuts");
  // The palette does not promise ? either.
  const show = page.getByRole("option", { name: /^Show keyboard shortcuts/ });
  await expect(show.locator("kbd")).toHaveCount(0);
  await show.click();
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet.locator("[data-sheet-row][data-commands='profile.new']")).toContainText("Off");
  await expect(sheet.locator("[data-sheet-row][data-commands='nav.proxies']")).toContainText("Off");
  await expect(sheet.locator("[data-sheet-row][data-commands='profile.select']")).not.toContainText("Off");
  // A key that is off is not promised elsewhere either.
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  const newProfile = page.locator("main header").getByRole("button", { name: "New profile" });
  await newProfile.hover();
  await expect(newProfile).not.toHaveAttribute("aria-keyshortcuts", /.+/);
});

test("a Cyrillic layout's G then P goes to Proxies (keys by place)", async ({ page }) => {
  await openApp(page);
  const send = (key: string, code: string) => page.evaluate(([key, code]) =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true })), [key, code] as const);
  await send("п", "KeyG");
  await send("з", "KeyP");
  await expect(heading(page)).toHaveText("Proxies");
});

test("Cmd+Z undoes a move to the Trash on any layout", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("Delete");
  await expect(row(page, "Sandbox")).toHaveCount(0);
  // As a person does: the toast and its Undo are there first.
  await expect(page.locator("[data-toast]").filter({ hasText: "Sandbox" })).toBeVisible();
  // "я" is what the Z key types on a Russian layout; the suite runs on macOS.
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", {
    key: "я", code: "KeyZ", metaKey: true, bubbles: true, cancelable: true,
  })));
  await expect(row(page, "Sandbox")).toHaveCount(1);
});

// Polish PA1: a focused, closed kit Select owns its keys, so "?" does not open the sheet.
test("? on a focused kit Select does not open the shortcut sheet", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Profile defaults" }).click();
  const screen = page.getByRole("combobox", { name: "Screen size shown to sites" });
  await screen.focus();
  await page.keyboard.type("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
});
