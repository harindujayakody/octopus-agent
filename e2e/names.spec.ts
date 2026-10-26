import { expect, test } from "@playwright/test";
import { appModule, openApp } from "./support/app";
import { axeViolations } from "./support/axe";

// A11Y-09: a country is a name in the UI language, not a bare code.
test("country codes are names in the UI language", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/shared/lib/format.ts", "__f");
  const en = await page.evaluate(() => {
    const f = (window as unknown as { __f: { fmtCountry(c: string): string } }).__f;
    return ["DE", "gb", "XX", "1"].map((c) => f.fmtCountry(c));
  });
  expect(en).toEqual(["Germany", "United Kingdom", "XX", "1"]);
  await page.evaluate(() => localStorage.setItem("shardx.lang", "zh"));
  await page.reload();
  await appModule(page, "/src/shared/lib/format.ts", "__f");
  expect(await page.evaluate(() => (window as unknown as { __f: { fmtCountry(c: string): string } }).__f.fmtCountry("DE"))).toBe("德国");
});

// A11Y-09, WIG-10: every control has a name that says what it acts on.
test("importer rows are named by their proxy", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.getByRole("button", { name: /Add proxies/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").first().fill("203.0.113.10:1080\n203.0.113.11:1080");
  await dialog.getByRole("button", { name: "Preview" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Select 203.0.113.10:1080" })).toBeVisible();
  expect(await axeViolations(page, { include: "[role='dialog']", rules: ["label", "aria-toggle-field-name", "aria-input-field-name", "button-name"] })).toEqual([]);
});

test("the sidebar's names hold words only", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("aside [data-nav='search']")).toHaveAccessibleName("Search");
  expect(await axeViolations(page, { include: "aside", rules: ["button-name", "link-name", "aria-command-name"] })).toEqual([]);
});
