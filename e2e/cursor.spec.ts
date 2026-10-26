import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// Owner feedback 5v (2026-09-26, relayed by shard-64): "make sure we have
// cursor pointer over all actionable things." One base-layer CSS rule in the
// kit (ui-kit/src/styles/tokens.css) now covers every actionable element by
// tag, type or role, plus a `[data-clickable]` escape hatch for a clickable
// element with none of those. This file is the cross-cutting guard: it
// doesn't re-derive the rule, it just walks each screen and checks the
// browser actually computed `pointer` (or `not-allowed`, or the text
// cursor), so a future control can't silently fall through the cracks.

// Mirrors the selector list in ui-kit/src/styles/tokens.css's `@layer base`.
const POINTER_SELECTOR = [
  'button:not(:disabled):not([aria-disabled="true"])',
  "a[href]",
  "summary",
  "select:not(:disabled)",
  "label[for]",
  'label:has(input[type="checkbox"])',
  'label:has(input[type="radio"])',
  'input[type="checkbox"]:not(:disabled)',
  'input[type="radio"]:not(:disabled)',
  'input[type="file"]:not(:disabled)',
  'input[type="range"]:not(:disabled)',
  'input[type="color"]:not(:disabled)',
  '[role="button"]:not([aria-disabled="true"])',
  '[role="link"]:not([aria-disabled="true"])',
  '[role="menuitem"]:not([aria-disabled="true"])',
  '[role="menuitemcheckbox"]:not([aria-disabled="true"])',
  '[role="menuitemradio"]:not([aria-disabled="true"])',
  '[role="option"]:not([aria-disabled="true"])',
  '[role="tab"]:not([aria-disabled="true"])',
  '[role="switch"]:not([aria-disabled="true"])',
  '[role="checkbox"]:not([aria-disabled="true"])',
  '[role="radio"]:not([aria-disabled="true"])',
  '[role="treeitem"]:not([aria-disabled="true"])',
  "[data-clickable]",
].join(", ");

/** Every visible element matching the pointer selector list, each with its
 *  computed `cursor`. Only visible ones: a hidden menu's items would report
 *  whatever the browser leaves a display:none element's computed style at,
 *  which says nothing about what a user actually sees. */
async function pointerElements(page: Page): Promise<{ tag: string; cursor: string }[]> {
  return page.evaluate((sel) => {
    const out: { tag: string; cursor: string }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push({ tag: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${el.className || "(no class)"}`, cursor: getComputedStyle(el).cursor });
    }
    return out;
  }, POINTER_SELECTOR);
}

async function assertAllPointer(page: Page, label: string) {
  const found = await pointerElements(page);
  expect(found.length, `${label}: no actionable elements found (the check would pass vacuously)`).toBeGreaterThan(0);
  const bad = found.filter((f) => f.cursor !== "pointer");
  expect(bad, `${label}: not pointer — ${bad.map((b) => `${b.tag} (${b.cursor})`).join(", ")}`).toEqual([]);
}

// Fix round 1 (M6): the page-wide non-empty check above is satisfied by the
// sidebar alone on every screen, so a screen whose overlay is empty (or
// never actually opened) could still pass. Require a count > 0 *inside* the
// specific overlay under test too.
async function assertOverlayNotEmpty(page: Page, overlaySelector: string, label: string) {
  const n = await page.locator(overlaySelector).count();
  expect(n, `${label}: nothing matched inside the overlay (${overlaySelector})`).toBeGreaterThan(0);
}

test("Profiles: every actionable element shows the pointer cursor", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await assertAllPointer(page, "Profiles");
});

test("Proxies: every actionable element shows the pointer cursor", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await assertAllPointer(page, "Proxies");
});

test("Settings: every actionable element shows the pointer cursor", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await assertAllPointer(page, "Settings");
});

// Fix round 2, finding 1: the project row still opens on a click anywhere
// (its own `onClick`), but the fix that added `data-project-id` swapped it
// in for `data-clickable` instead of keeping both — so hovering the row
// outside its name button (the blocks-count cell, the updated-at cell, the
// blank grid gaps) fell back to the plain arrow cursor even though the area
// was still fully clickable. Checked here directly, not just swept by the
// page-wide `assertAllPointer`, since a regression narrowly scoped to one
// selector wouldn't otherwise be obvious from a passing page-wide count.
test("Automation: every actionable element shows the pointer cursor, including the project row itself", async ({ page }) => {
  await openApp(page, { section: "automation" });
  const row = page.locator("[role='listitem'][data-row-id]").first();
  await expect(row).toBeVisible();
  const rowCursor = await row.evaluate((el) => getComputedStyle(el).cursor);
  expect(rowCursor, "the row container itself, not only its name button").toBe("pointer");
  await assertAllPointer(page, "Automation");
});

test("A row's context menu: every item shows the pointer cursor", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await page.locator("[role='row'][data-profile-id]").first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await assertOverlayNotEmpty(page, "[role='menu'] [role='menuitem']", "row context menu");
  await assertAllPointer(page, "row context menu");
});

test("The TagPicker: every row and control shows the pointer cursor", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("shardx.tags", JSON.stringify({
      version: 1,
      tags: [{ id: "t-warm", name: "Warm-up", color: "orange" }],
      byProfile: {},
    }));
  });
  await openApp(page, { section: "profiles" });
  await page.locator("[role='row'][data-profile-id]").first().locator("[data-cell='tags']").dblclick();
  await expect(page.getByRole("dialog", { name: "Tags" })).toBeVisible();
  await assertOverlayNotEmpty(page, "[role='dialog'] [role='option']", "TagPicker");
  await assertAllPointer(page, "TagPicker");
});

test("New folder dialog: every control shows the pointer cursor; a disabled Create shows not-allowed; the name field keeps the text cursor", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await expect(dialog).toBeVisible();
  await assertOverlayNotEmpty(page, "[role='dialog'] button", "New folder dialog");
  await assertAllPointer(page, "New folder dialog");

  // Empty name: Create is disabled. Fix round 1 (I2): `toHaveCSS` alone
  // reads the element's own computed style, which stays "not-allowed" even
  // if `pointer-events: none` stopped the pointer from ever hit-testing it
  // (in which case the user sees whatever sits underneath, not this) — hit-
  // test with `document.elementFromPoint`, the same check the browser runs.
  const create = dialog.getByRole("button", { name: "Create" });
  await expect(create).toBeDisabled();
  const hit = await create.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    // The deepest element at that point may be an inner span (Button wraps
    // its label in one) — what matters is that it's the button or one of
    // its own descendants, not something else layered on top of it.
    return { isSelf: !!at && el.contains(at), cursor: at ? getComputedStyle(at).cursor : null };
  });
  expect(hit.isSelf, "the pointer hit the disabled Create button itself").toBe(true);
  expect(hit.cursor).toBe("not-allowed");

  // The name field is a text input: the browser's own text cursor, not a
  // forced one — the base rule never touches text-like fields.
  const name = dialog.getByRole("textbox", { name: "Name" });
  const cursor = await name.evaluate((el) => getComputedStyle(el).cursor);
  expect(["text", "auto"]).toContain(cursor);
});

test("The command palette: every visible option and control shows the pointer cursor", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await assertOverlayNotEmpty(page, "[role='listbox'] [role='option']", "command palette");
  await assertAllPointer(page, "command palette");
});
