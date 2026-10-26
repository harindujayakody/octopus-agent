import { expect, test, type Page } from "@playwright/test";

// Real-browser checks of the kit overlays (see e2e/kit/overlays.tsx).
const open = (page: Page) => page.goto("/e2e/kit/overlays.html");

test("a menu opened by mouse highlights nothing until an arrow key, then follows the arrows (Pair 30 ruling)", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "More actions" }).click();
  // The menu itself has the keyboard; no item shows the highlight yet.
  await expect(page.getByRole("menu")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Duplicate" })).toBeFocused();
});

test("a menu opened by keyboard works end to end", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "More actions" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("picked")).toHaveText("delete");
  await expect(page.getByRole("button", { name: "More actions" })).toBeFocused();
});

test("a popover focuses its first field", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByLabel("Filters field")).toBeFocused();
});

test("a popover that grows stays on screen and off its trigger", async ({ page }) => {
  await open(page);
  const trigger = page.getByRole("button", { name: "Bottom", exact: true });
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "Bottom panel" });
  await expect(panel).toBeVisible();
  for (let i = 0; i < 3; i++) await panel.getByRole("button", { name: "grow" }).click();
  await page.waitForTimeout(100);
  const p = (await panel.boundingBox())!;
  const t = (await trigger.boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(p.y).toBeGreaterThanOrEqual(8);
  expect(p.y + p.height).toBeLessThanOrEqual(Math.min(t.y, vh - 8) + 1);
});

test("choosing a menu item with the mouse does not leave a tooltip on the trigger", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.mouse.move(700, 700);
  await page.waitForTimeout(600);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("one Escape closes a dialog even when its first control has a tooltip", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Open dialog" }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Dialog with icon first" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Pin" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("layout classes on an IconButton reach the layout", async ({ page }) => {
  await open(page);
  const row = (await page.getByTestId("row").boundingBox())!;
  const btn = (await page.getByRole("button", { name: "Pushed right" }).boundingBox())!;
  expect(Math.round(btn.x + btn.width)).toBeGreaterThanOrEqual(Math.round(row.x + row.width) - 2);
});

test("an IconButton tooltip sits above its button", async ({ page }) => {
  await open(page);
  const btn = page.getByRole("button", { name: "Pushed right" });
  await btn.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  const b = (await btn.boundingBox())!;
  const t = (await tip.boundingBox())!;
  expect(t.y + t.height).toBeLessThanOrEqual(b.y + 1);
});

// Fix round 1 (I2): `cursor: not-allowed` on a disabled element is invisible
// to the user if `pointer-events: none` stops the pointer from hit-testing
// that element at all (it hit-tests whatever sits underneath instead).
// `document.elementFromPoint` at the element's own center is the same test
// the browser itself runs for a real hover, so this can actually fail.
async function hitTestsItself(page: import("@playwright/test").Locator) {
  return page.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    // The deepest element at that point may be an inner span (Button wraps
    // its label in one) — what matters is that it's the element itself or
    // one of its own descendants, not something else layered on top of it.
    return { isSelf: !!hit && el.contains(hit), cursor: hit ? getComputedStyle(hit).cursor : null };
  });
}

test("a disabled Button is still hit-tested (not-allowed actually shows)", async ({ page }) => {
  await open(page);
  const btn = page.getByRole("button", { name: "Disabled button" });
  await expect(btn).toBeDisabled();
  const { isSelf, cursor } = await hitTestsItself(btn);
  expect(isSelf, "the pointer hit the disabled button itself, not whatever sits under it").toBe(true);
  expect(cursor).toBe("not-allowed");
});

test("a disabled Select option is still hit-tested, and cannot be picked", async ({ page }) => {
  await open(page);
  await page.getByRole("combobox", { name: "Status" }).click();
  const option = page.getByRole("option", { name: "Beta (disabled)" });
  await expect(option).toBeVisible();
  const { isSelf, cursor } = await hitTestsItself(option);
  expect(isSelf, "the pointer hit the disabled option itself, not whatever sits under it").toBe(true);
  expect(cursor).toBe("not-allowed");
  await option.click({ force: true });
  await expect(page.getByRole("combobox", { name: "Status" })).toContainText("Alpha");
});

// Audit Phase B (F3): every overlay lets the pointer through the moment it
// closes, not a tick later. Before, Menu, Popover, DialogModal and AlertModal
// took the pointer until usePresence's effect flipped data-state, and a click
// in that tick was swallowed.
test.describe("a click right after Esc lands on the page", () => {
  // Exits only take time with motion; the suite runs with reduced motion.
  test.use({ reducedMotion: "no-preference" });

  const kinds = [
    { kind: "menu", role: "menu" },
    { kind: "popover", role: "dialog" },
    { kind: "modal", role: "dialog" },
    { kind: "dialog", role: "dialog" },
    { kind: "alert", role: "alertdialog" },
  ] as const;

  for (const { kind, role } of kinds) {
    test(kind, async ({ page }) => {
      await open(page);
      const target = page.getByRole("button", { name: new RegExp(`^${kind} target`) });
      await page.getByRole("button", { name: `Esc test ${kind}`, exact: true }).click();
      const overlay = page.getByRole(role, { name: `Esc test ${kind}` });
      await expect(overlay).toHaveAttribute("data-state", "open");
      // A point on the page control that the overlay covers: the panel's
      // middle for a menu or popover, the control's middle under a backdrop.
      const t = (await target.boundingBox())!;
      const o = (await overlay.boundingBox())!;
      const at = role === "menu" || kind === "popover"
        ? { x: o.x + o.width / 2, y: o.y + o.height / 2 }
        : { x: t.x + t.width / 2, y: t.y + t.height / 2 };
      expect(at.x > t.x && at.x < t.x + t.width && at.y > t.y && at.y < t.y + t.height, "the point lies on the control").toBe(true);
      // While it is open, the overlay (its panel, or a dialog's backdrop) is
      // what the pointer would hit there, not the control.
      const covered = await target.evaluate((el, p) => {
        const top = document.elementFromPoint(p.x, p.y);
        return !!top && !el.contains(top);
      }, at);
      expect(covered, "the overlay covers the control at that point").toBe(true);
      await page.keyboard.press("Escape");
      // No actionability wait: the click must land during the overlay's fade.
      await page.mouse.click(at.x, at.y);
      await expect(page.getByTestId(`${kind}-hits`)).toHaveText("1");
    });
  }
});

test("a Combobox in a popover: type, arrows, Enter; the list is windowed", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Pick a proxy" }).click();
  const field = page.getByRole("combobox", { name: "Proxy" });
  await expect(field).toBeFocused();
  expect(await page.getByRole("option").count()).toBeLessThanOrEqual(40);
  // The keys reach rows that were not rendered, and bring them fully into view.
  for (let i = 0; i < 5; i++) await page.keyboard.press("PageDown");
  const highlighted = page.locator("[role='option'][data-highlighted]");
  await expect(highlighted).toHaveText(/Proxy 0050/);
  await expect(highlighted).toBeInViewport({ ratio: 1 });
  expect(await page.getByRole("option").count()).toBeLessThanOrEqual(40);
  // A short list (Proxy 0000 to 0009, 10 rows, taller than the list) scrolls itself too.
  await field.fill("Proxy 000");
  await expect(page.getByRole("option")).toHaveCount(10);
  await page.keyboard.press("PageDown");
  await expect(highlighted).toHaveText(/Proxy 0009/);
  await expect(highlighted).toBeInViewport({ ratio: 1 });
  // Word by word over labels and hints: "002" first matches Proxy 0002, then
  // Proxy 0020 (every hint has 1080), so the second match is certain.
  await field.fill("002 1080");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("picked-proxy")).toHaveText("p20");
});

test("Esc in a Combobox clears the query first; the next Esc closes its popover", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Pick a proxy" }).click();
  const field = page.getByRole("combobox", { name: "Proxy" });
  await field.fill("0042");
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(field).toHaveValue("");
  await expect(page.getByRole("dialog", { name: "Proxy picker" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Proxy picker" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pick a proxy" })).toBeFocused();
});

test("a multiple Combobox: a click anywhere on a row toggles it once and the list stays; Enter creates what matches nothing", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Edit tags" }).click();
  const list = page.getByRole("listbox", { name: "Tags" });
  await expect(list.getByRole("option", { name: /Shop/ })).toContainText("Some");
  const warm = list.getByRole("option", { name: /Warm-up/ });
  await warm.click({ position: { x: 150, y: 10 } });
  await expect(warm).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("tags")).toHaveText("ads,warm");
  await warm.click();
  await expect(warm).toHaveAttribute("aria-selected", "false");
  await page.getByRole("combobox", { name: "Tags" }).fill("Games");
  await expect(list.getByRole("option").last()).toHaveText("Create “Games”");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tags")).toHaveText("ads,games");
  await expect(page.getByRole("dialog", { name: "Tags picker" })).toBeVisible();
});

test("MultiSelect: type, arrows and Enter pick several; Any clears (IFACE-04)", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Countries" }).click();
  const field = page.getByRole("combobox", { name: "Countries" });
  await expect(field).toBeFocused();
  await page.keyboard.type("united");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("countries")).toHaveText("US,GB");
  await field.fill("");
  await page.getByRole("option", { name: /^Any/ }).click();
  await expect(page.getByTestId("countries")).toHaveText("");
});
