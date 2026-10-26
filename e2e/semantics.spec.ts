import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";
import { axeViolations } from "./support/axe";

// Audit Phase C, Task 26 (A11Y-08, A11Y-21, EMIL-21): tabs switch a panel
// named by its tab; a single choice is a radio group; the palette's listbox
// holds options only.
const ROLE_RULES = ["aria-required-children", "aria-required-parent", "aria-valid-attr-value", "aria-allowed-role", "aria-input-field-name", "aria-toggle-field-name", "list", "listitem"];

test("Settings: tabs, panel and radio groups pass axe's role rules", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await expect(page.getByRole("tabpanel")).toBeVisible();
  expect(await axeViolations(page, { rules: ROLE_RULES })).toEqual([]);
  await page.getByRole("tab", { name: "Appearance" }).click();
  await expect(page.getByRole("radiogroup").first()).toBeVisible();
  expect(await axeViolations(page, { rules: ROLE_RULES })).toEqual([]);
});

test("the palette passes axe's role rules, also with no results", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  expect(await axeViolations(page, { include: "[role='dialog']", rules: ROLE_RULES })).toEqual([]);
  // The status is in the page before it has anything to say, so the words
  // are announced when they arrive (Pair 28 review M2).
  await expect(dialog.getByRole("status")).toHaveText("");
  await page.getByRole("combobox", { name: "Search commands" }).fill("zzzzzz");
  await expect(dialog.getByRole("status")).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText("No results");
  expect(await axeViolations(page, { include: "[role='dialog']", rules: ROLE_RULES })).toEqual([]);
});

test("a single choice: Tab enters at the checked one, the arrows move and choose, and forced colors keep it marked", async ({ page }) => {
  await openApp(page, { section: "settings", theme: "light" });
  await page.getByRole("tab", { name: "Appearance" }).click();
  const theme = page.getByRole("radiogroup", { name: "Theme" });
  await expect(theme.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
  // The section's tab, then its panel, then the checked choice.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tabpanel", { name: "Appearance" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(theme.getByRole("radio", { name: "Light" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(theme.getByRole("radio", { name: "Dark" })).toBeFocused();
  await expect(theme.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("End");
  await expect(theme.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Home");
  await expect(theme.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");

  // Windows contrast themes drop the raised fill: the checked one keeps a
  // Highlight fill of its own.
  await page.emulateMedia({ forcedColors: "active" });
  const fill = (name: string) => theme.getByRole("radio", { name }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await fill("Light")).not.toBe(await fill("Dark"));
});
