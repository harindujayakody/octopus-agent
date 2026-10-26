import { expect, test, type Page } from "@playwright/test";
import { openApp, type Theme } from "./support/app";
import { composite, contrast, parseColor as parseRgb } from "./support/color";

// Owner feedback 5j (2026-09-26): "for folders and tags not dot color but
// all label color without dot at all." Every LABEL_COLORS entry becomes a
// tinted chip (background + text, both derived from the label color with
// color-mix), and the dot is gone entirely. Owner feedback 2026-09-28 ("lets
// make lables like folder or tag without borders"): no ring either, so each
// chip asserts `box-shadow: none`.
const LABEL_COLOR_IDS = ["blue", "violet", "magenta", "red", "orange", "yellow", "green", "sky"] as const;
const PROFILE_ID = "aed41005"; // Etsy craft shop, folder "Shops"

const seed = (page: Page) => page.addInitScript((ids: readonly string[]) => {
  localStorage.setItem("shardx.folderMeta", JSON.stringify({ Shops: { color: "green", icon: "folder" } }));
  localStorage.setItem("shardx.tags", JSON.stringify({
    version: 1,
    tags: ids.map((id) => ({ id: `t-${id}`, name: id, color: id })),
    byProfile: { aed41005: ids.map((id) => `t-${id}`) },
  }));
}, LABEL_COLOR_IDS);

async function chipContrast(page: Page, chip: ReturnType<Page["locator"]>) {
  return chip.evaluate((el) => {
    const cs = getComputedStyle(el);
    // The chip's own tint sits over its nearest real surface: Peek's raised
    // white panel for a tag chip, a Popover/Menu's own panel for one inside
    // a picker or Filters (owner feedback 5t), the list row for a Folder
    // chip. A list row has no background of its own (only a `hover:` one)
    // — its real visible surface is the list's tile behind it (vf-f, merge
    // point 12: the treegrid itself is clear).
    const surface = el.closest("aside[data-peek]") ?? el.closest("[role='dialog']") ?? el.closest(".list-tile") ?? document.body;
    // A list tile's fill is translucent in dark: read its opaque twin (`--list-fill`).
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--list-fill)";
    if (surface.matches(".list-tile")) surface.appendChild(probe);
    const rowBg = getComputedStyle(probe.isConnected ? probe : surface).backgroundColor;
    probe.remove();
    return { bg: cs.backgroundColor, fg: cs.color, rowBg };
  });
}

async function assertChipContrast(page: Page, chip: ReturnType<Page["locator"]>, label: string) {
  const { bg, fg, rowBg } = await chipContrast(page, chip);
  const bgRgba = parseRgb(bg);
  const rowRgb = parseRgb(rowBg).slice(0, 3) as [number, number, number];
  const compositedBg = composite(bgRgba, rowRgb);
  const fgRgb = parseRgb(fg).slice(0, 3) as [number, number, number];
  const ratio = contrast(fgRgb, compositedBg);
  expect(ratio, label).toBeGreaterThanOrEqual(4.5);
}

async function run(page: Page, theme: Theme) {
  await seed(page);
  await openApp(page, { theme });

  // The Folder chip (Shops, colored green) first, in the plain list — Peek
  // narrows the list and hides the Folder column entirely (ProfileTable.tsx
  // `narrow` prop), so this has to run before Peek opens (fix round 1, M7):
  // the chip's only child is the name span (no dot, no other element), and
  // it clears 4.5:1 over its row.
  const folderChip = page.locator(`[role='row'][data-profile-id='${PROFILE_ID}'] [data-cell='folder'] [data-color]`);
  await expect(folderChip).toBeVisible();
  await expect(folderChip.locator("[aria-hidden='true']:not(svg)")).toHaveCount(0);
  // Fix round 1 (M2): dropped a vacuous check for `[data-identity-dot]`, an
  // attribute nothing renders any more — the single-child assertion right
  // below already carries "no dot, no other element".
  expect(await folderChip.evaluate((el) => el.children.length)).toBe(1);
  await expect(folderChip).toHaveCSS("box-shadow", "none");
  await assertChipContrast(page, folderChip, `${theme} Folder chip contrast`);

  await page.locator("[role='row'][data-profile-id='" + PROFILE_ID + "']", { hasText: "Etsy craft shop" })
    .locator("[data-cell='name']").click();
  const peek = page.locator("aside[data-peek]");
  await expect(peek).toBeVisible();
  // Task 14: the Tags row shows the chips (their Remove is in the picker now).
  const tagsField = peek.locator("[data-property='tags']");

  for (const id of LABEL_COLOR_IDS) {
    const chip = tagsField.locator(`[data-tag='t-${id}']`);
    await expect(chip).toBeVisible();
    // No dot at all inside the chip.
    await expect(chip.locator("[aria-hidden='true']:not(svg)")).toHaveCount(0);
    await expect(chip).toHaveCSS("box-shadow", "none");
    await assertChipContrast(page, chip, `${theme} ${id} chip contrast`);
  }
}

test("Tag chips (all 8 LABEL_COLORS) meet 4.5:1 contrast, light theme, no dot", async ({ page }) => {
  await run(page, "light");
});

test("Tag chips (all 8 LABEL_COLORS) meet 4.5:1 contrast, dark theme, no dot", async ({ page }) => {
  await run(page, "dark");
});

test("a Folder with no color keeps the neutral chip", async ({ page }) => {
  await openApp(page, { theme: "light" }); // no folderMeta seeded: every folder defaults to no color
  // The real chip (`data-folder-chip`), not the Task 8 wrapper span the
  // Folder cell now uses to keep FolderChip truncating inside the flex row.
  const chip = page.locator("[role='row'][data-profile-id]", { hasText: "Etsy craft shop" }).locator("[data-cell='folder'] [data-folder-chip]");
  await expect(chip).not.toHaveAttribute("data-color", /.+/);
  await expect(chip).toHaveCSS("background-color", "rgba(0, 0, 0, 0.04)"); // bg-bg-weak-50 (black 4%), today's neutral chip
  await expect(chip).toHaveCSS("box-shadow", "none"); // the fill alone, no ring
});

// Owner feedback 5t (2026-09-26): "we also need to have not dot view of tags
// or folders in this creating and selecting menus" — the pickers and Filters
// reuse the same chip components as the row (Task 5j), not a dot.

test("TagPicker: every tag row holds a chip, no dot; a click on the row still toggles it", async ({ page }) => {
  await seed(page);
  await openApp(page, { theme: "light" });
  await page.locator(`[role='row'][data-profile-id='${PROFILE_ID}']`).locator("[data-cell='tags']").dblclick();
  const dialog = page.getByRole("dialog", { name: "Tags" });
  await expect(dialog).toBeVisible();
  // The kit Combobox (E16): each option's one drawn decoration is its box,
  // first in the row; the chip beside it has none (the old dot is gone).
  await expect(dialog.locator("[role='option'] [aria-hidden='true']:not(svg):not([role='option'] > :first-child)")).toHaveCount(0);
  for (const id of LABEL_COLOR_IDS) {
    const chip = dialog.locator(`[data-tag='t-${id}']`);
    await expect(chip).toBeVisible();
    const bg = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, `${id} chip background`).not.toBe("rgba(0, 0, 0, 0)");
  }
  const option = dialog.getByRole("option", { name: /^blue/ });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await option.click();
  await expect(option).toHaveAttribute("aria-selected", "false");
});

test("TagPicker: the Create row names the tag, and the new tag shows as its chip", async ({ page }) => {
  await seed(page);
  await openApp(page, { theme: "light" });
  await page.locator(`[role='row'][data-profile-id='${PROFILE_ID}']`).locator("[data-cell='tags']").dblclick();
  const dialog = page.getByRole("dialog", { name: "Tags" });
  await dialog.getByRole("combobox", { name: "Find or create a tag" }).fill("Brand new tag");
  await dialog.getByRole("option", { name: "Create “Brand new tag”" }).click();
  await dialog.getByRole("combobox", { name: "Find or create a tag" }).fill("Brand");
  const created = dialog.getByRole("option", { name: /Brand new tag/ }).locator("[data-tag]");
  await expect(created).toBeVisible();
  expect(await created.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
});

test("Filters Tag values: options show the real chip, no dot", async ({ page }) => {
  // Fix round 1 (I1): a square tinted swatch was still "a dot by another
  // name" (the [marker] + [plain name] row the owner objected to). An option
  // holds the real `TagChip` (its `content`), no separate marker beside it.
  // F19 (Pair 24): Filters is a field-then-value menu, and the applied
  // filter shows as a text chip under the header ("Tag: blue"), no dot.
  await seed(page);
  await openApp(page, { theme: "light" });
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("option", { name: /^Tag/ }).click();
  const listbox = page.getByRole("listbox");
  const option = listbox.getByRole("option", { name: /^blue/ });
  await expect(option).toBeVisible();
  const chip = option.locator("[data-tag='t-blue']");
  await expect(chip).toBeVisible();
  await expect(option.locator("[aria-hidden='true']:not(svg)")).toHaveCount(0);
  const bg = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg, "tinted background, not transparent").not.toBe("rgba(0, 0, 0, 0)");

  await option.click();
  const applied = page.locator("[data-filter-chips] [data-chip='tag']");
  await expect(applied).toContainText("blue");
  await expect(applied.locator("[aria-hidden='true']:not(svg)")).toHaveCount(0);
});

test("Move to folder: each existing folder shows as its chip, tinted or neutral, no dot", async ({ page }) => {
  await seed(page); // Shops -> green; Ads stays uncolored
  await openApp(page, { theme: "light" });
  await page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: /Move to folder/ }).click();
  const dialog = page.getByRole("dialog", { name: "Move to folder" });
  const shopsChip = dialog.getByRole("option", { name: /^Shops/ }).locator("[data-folder-chip]");
  await expect(shopsChip).toHaveAttribute("data-color", "green");
  await expect(shopsChip.locator("[aria-hidden='true']:not(svg)")).toHaveCount(0);
  // Fix round 1 (M3): target the real FolderChip (`data-folder-chip`), not
  // the kit Button's own `leftIcon` wrapper span, which never carries
  // `data-color` regardless of the chip's own state and so asserted nothing.
  const adsChip = dialog.getByRole("option", { name: /^Ads/ }).locator("[data-folder-chip]");
  await expect(adsChip).not.toHaveAttribute("data-color", /.+/);
  await expect(adsChip).toHaveCSS("background-color", "rgba(0, 0, 0, 0.04)"); // bg-bg-weak-50 (black 4%), the neutral chip
});

async function runPickerContrast(page: Page, theme: Theme) {
  await seed(page);
  await openApp(page, { theme });
  await page.locator(`[role='row'][data-profile-id='${PROFILE_ID}']`).locator("[data-cell='tags']").dblclick();
  const tagDialog = page.getByRole("dialog", { name: "Tags" });
  // Fix round 1 (M4): all 8 LABEL_COLORS on the TagPicker's own menu
  // surface, not just blue — the gate is meant to cover the chip look, and
  // a color-specific contrast bug wouldn't show on one color alone.
  for (const id of LABEL_COLOR_IDS) {
    await assertChipContrast(page, tagDialog.locator(`[data-tag='t-${id}']`), `${theme} TagPicker ${id} chip contrast`);
  }
  await page.keyboard.press("Escape");

  // A profile in no Folder, so no row of the Move to folder picker is its
  // current one (PROFILE_ID is in Shops).
  await page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: /Move to folder/ }).click();
  const folderDialog = page.getByRole("dialog", { name: "Move to folder" });
  await assertChipContrast(page, folderDialog.getByRole("option", { name: /^Shops/ }).locator("[data-folder-chip]"), `${theme} Move-to-folder chip contrast`);
}

test("TagPicker and Move-to-folder chips meet 4.5:1 on the popover surface, light theme", async ({ page }) => {
  await runPickerContrast(page, "light");
});

test("TagPicker and Move-to-folder chips meet 4.5:1 on the popover surface, dark theme", async ({ page }) => {
  await runPickerContrast(page, "dark");
});

// Batch 1's Remove-hover tests went with Peek's tag chip Remove buttons
// (Task 14): tags are given and taken in the Tags row's picker now.
