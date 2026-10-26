import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { axeViolations } from "./support/axe";

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const peek = (page: Page) => page.locator("aside[data-peek]");

// The kit Select as an APG select-only combobox (audit Phase C, Tasks 18 and 19).

test("P then the arrows, a typed name and Enter bind a proxy, all from the keyboard", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  if (await peek(page).count()) await page.keyboard.press("Escape");
  await row(page, "Sandbox").focus();
  await page.keyboard.press("p");
  // The picker is a search field over the list (Task 18): the field has the keys at once.
  const field = page.getByRole("dialog", { name: /Proxy/ }).getByRole("combobox", { name: "Proxy", exact: true });
  await expect(field).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  // Typing filters the list and highlights the first match.
  await page.keyboard.type("DC To");
  await expect(page.getByRole("option", { name: /DC Tokyo/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  // The cell names the proxy (F7, Task 17).
  await expect(row(page, "Sandbox").locator("[data-cell='proxy']")).toContainText("DC Tokyo");
});

test("Settings: the language Select works with the arrows and keeps focus", async ({ page }) => {
  await openApp(page, { section: "settings" });
  const field = page.getByRole("combobox", { name: /language/i });
  await field.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(field).toBeFocused();
});

test("an open Select passes axe's list rules", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("combobox", { name: /language/i }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  const violations = await axeViolations(page, {
    rules: ["aria-required-children", "aria-required-parent", "listitem", "aria-input-field-name", "aria-valid-attr-value", "aria-allowed-role"],
  });
  expect(violations).toEqual([]);
});
