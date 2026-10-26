import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";

// Owner 2026-10-01: the "Add a step" picker looked off. Raycast-style rows:
// one selected category, borderless step rows, search across all categories.
test("Add a step picker: one selected category, borderless rows, search spans categories", async ({ page }) => {
  await openApp(page, { section: "automation", theme: "light" });
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  await page.getByRole("button", { name: "Add step" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a step" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox")).toBeFocused();

  // Only the chosen category has the selected fill.
  const cats = dialog.getByRole("group", { name: "Categories" }).getByRole("button");
  const fills = await cats.evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).backgroundColor).filter((c) => c !== "rgba(0, 0, 0, 0)" && c !== "transparent"));
  expect(fills).toHaveLength(1);

  // Step rows carry no border.
  const rows = dialog.getByRole("option");
  expect(await rows.count()).toBeGreaterThan(1);
  const borders = await rows.evaluateAll((els) => els.map((el) => getComputedStyle(el).borderTopWidth + getComputedStyle(el).boxShadow));
  expect(borders.every((b) => b === "0pxnone")).toBe(true);

  // Typing filters across categories, grouped under category labels.
  await dialog.getByRole("combobox").fill("wait");
  const groups = dialog.getByRole("listbox").getByRole("group");
  expect(await groups.count()).toBeGreaterThan(1);
  await expect(dialog.getByRole("option").first()).toContainText(/wait/i);
});

for (const theme of ["light", "dark"] as const) {
  test(`every category, step and canvas node carries its icon, ${theme}`, async ({ page }) => {
    await openApp(page, { section: "automation", theme });
    await page.getByText("Pricing scrape 6h", { exact: true }).click();

    // Canvas: each node draws a 14 px step icon before its title.
    const cards = page.locator("[data-step-card]");
    expect(await cards.count()).toBeGreaterThan(0);
    for (const card of await cards.all()) {
      const icon = card.locator("[data-step-icon]");
      await expect(icon).toHaveCount(1);
      await expect(icon).toHaveClass(/size-3\.5/);
    }

    await page.getByRole("button", { name: "Add step" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a step" });
    const cats = dialog.getByRole("group", { name: "Categories" }).getByRole("button");
    for (const c of await cats.all()) await expect(c.locator("[data-step-icon]")).toHaveCount(1);
    // Every step of every category, through search so all show at once.
    await dialog.getByRole("combobox").fill("e");
    const rows = dialog.getByRole("option");
    expect(await rows.count()).toBeGreaterThan(20);
    for (const r of await rows.all()) await expect(r.locator("[data-step-icon]")).toHaveCount(1);
    await dialog.getByRole("combobox").fill("");
    await dialog.getByRole("group", { name: "Categories" }).getByRole("button", { name: "Pointer" }).click();
  });
}
