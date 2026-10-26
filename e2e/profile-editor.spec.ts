import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

const peek = (page: Page) => page.locator("aside[data-peek]");
const openEditor = async (page: Page) => {
  await openApp(page, { section: "profiles" });
  await page.locator("[role='row'][data-profile-id] [data-cell='name']").first().click();
};
/** Peek's header Edit: the profile form, on Basics. */
const openForm = async (page: Page) => {
  await peek(page).locator("[data-peek-header]").getByRole("button", { name: "Edit", exact: true }).click();
  const d = page.getByRole("dialog", { name: /^Edit /});
  await expect(d.getByRole("tab", { name: "Basics" })).toHaveAttribute("aria-selected", "true");
  return d;
};

test("every color choice is a radio group of named colors with one look (UI-33, A11Y-08)", async ({ page }) => {
  await openApp(page);
  // The profile accent, in the profile form: its Color row opens the shared picker (Task 14).
  await page.locator("[role='row'][data-profile-id]", { hasText: "FB Ads acc-01" }).locator("[data-cell='name']").click();
  const form = await openForm(page);
  await form.locator("[data-property='color'] button").click();
  const accent = page.getByRole("radiogroup", { name: "Color" });
  await expect(accent.getByRole("radio", { name: "Blue" })).toHaveAttribute("aria-checked", "true");
  await expect(accent.getByRole("radio", { name: /#/ })).toHaveCount(0);
  const auto = accent.getByRole("radio", { name: "Automatic, from the profile name" });
  await expect(auto).toHaveAttribute("aria-checked", "false");
  // Automatic still paints a color: the multicolor swatch, not No color's X.
  await expect(auto.locator("svg")).toHaveCount(0);
  expect(await auto.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("conic-gradient");
  const size = async (l: ReturnType<typeof page.locator>) => (await l.boundingBox())!.width;
  const accentBlue = await size(accent.getByRole("radio", { name: "Blue" }));
  // A click elsewhere in the form closes the picker; nothing changed, so Cancel just closes.
  await form.getByRole("textbox", { name: "Name" }).click();
  await expect(accent).toHaveCount(0);
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  // Folders use the same swatch.
  await page.locator("aside").getByRole("button", { name: "New folder" }).click();
  const folder = page.getByRole("dialog").getByRole("radiogroup");
  await expect(folder.getByRole("radio", { name: "Blue" })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("radio", { name: "No color" }).locator("svg")).toHaveCount(1);
  expect(await size(folder.getByRole("radio", { name: "Blue" }))).toBe(accentBlue);
});

test("a stored accent outside the eight shows as Custom until changed (plan ruling 28)", async ({ page }) => {
  await openApp(page);
  await page.locator("[role='row'][data-profile-id]", { hasText: "Amazon US seller" }).locator("[data-cell='name']").click();
  // Peek names the color; the form's Color row names what is chosen and opens the shared picker.
  await expect(peek(page).locator("[data-property='color']")).toContainText("Custom color");
  const form = await openForm(page);
  const color = form.locator("[data-property='color'] button");
  await expect(color).toContainText("Custom color");
  await color.click();
  const accent = page.getByRole("radiogroup", { name: "Color" });
  await expect(accent.getByRole("radio", { name: "Custom color" })).toHaveAttribute("aria-checked", "true");
  await accent.getByRole("radio", { name: "Violet" }).click();
  await expect(color).toContainText("Violet");
  await color.click();
  await expect(accent.getByRole("radio", { name: "Violet" })).toHaveAttribute("aria-checked", "true");
  await expect(accent.getByRole("radio", { name: "Custom color" })).toHaveCount(0);
});

test("the proxy picker is named by its label and shows country flags", async ({ page }) => {
  await openEditor(page);
  // Peek's Proxy value, named "Proxy <its value>", opens the form on the Proxy tab.
  const link = peek(page).locator("[data-property='proxy'] button");
  await expect(link).toHaveAccessibleName(/^Proxy /);
  await link.click();
  const form = page.getByRole("dialog", { name: /^Edit /});
  await expect(form.getByRole("tab", { name: "Proxy", exact: true })).toHaveAttribute("aria-selected", "true");
  // The form's Proxy row, named the same way, opens the list in place.
  const proxy = form.locator("[data-property='proxy'] button");
  await expect(proxy).toHaveAccessibleName(/^Proxy /);
  await proxy.click();
  await expect(page.getByRole("listbox").locator("[data-flag]").first()).toBeVisible();
});
