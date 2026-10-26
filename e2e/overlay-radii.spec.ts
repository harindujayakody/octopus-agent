import { expect, test, type Page } from "@playwright/test";
import { openApp, type Theme } from "./support/app";

// Owner feedback 5u (2026-09-26, relayed by shard-64, screenshot of the
// TagPicker's "Find or create a tag" field focused): "overlay menu radius is
// smaller than inner radius of highlited element and its not good." Rule:
// inside any overlay (Popover, Menu, Select list, command palette panel,
// DialogModal), a nested field's own corner radius, plus the gap between it
// and the overlay's edge, stays at or under the overlay's own radius, and a
// focus ring never extends past the field with an outer (non-inset) shadow.

const seedTags = (page: Page) => page.addInitScript(() => {
  const ids = ["blue", "violet", "magenta", "red", "orange", "yellow", "green", "sky", "gray"];
  localStorage.setItem("shardx.tags", JSON.stringify({
    version: 1,
    tags: ids.map((id) => ({ id: `t-${id}`, name: id, color: id === "gray" ? "blue" : id })),
    byProfile: {},
  }));
});

/** Takes the visible `<input>` itself. Its own rounded field box is
 *  `input.parentElement` (the kit Input's structure); climbing further up
 *  from there finds the nearest rounded-corner ancestor: the overlay's own
 *  floating panel, whatever its markup (Popover's `role=dialog`, Select's
 *  plain positioned div, the command palette's Modal panel). Returns both
 *  radii, the inset between them (the min gap on the sides the rule cares
 *  about — left, right and top, where a field sits), and whether the field
 *  shows an outer (non-inset) shadow. */
async function cornerFacts(input: ReturnType<Page["locator"]>) {
  return input.evaluate(async (inputEl) => {
    const num = (s: string) => parseFloat(s) || 0;
    const fieldBox = inputEl.parentElement!;
    // Fix round 1 (M5): the field box has `transition-shadow` (Input/
    // index.tsx), so a box-shadow read right after `.focus()` can catch a
    // mid-transition value instead of the settled one. Wait for the
    // transition to actually end — or a short timeout, for a field that
    // isn't mid-transition at all (already focused, or motion-reduced).
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; fieldBox.removeEventListener("transitionend", onEnd); resolve(); } };
      const onEnd = (e: Event) => { if ((e as TransitionEvent).propertyName === "box-shadow") finish(); };
      fieldBox.addEventListener("transitionend", onEnd);
      setTimeout(finish, 250);
    });
    let node: Element | null = fieldBox.parentElement;
    let overlay: Element | null = null;
    while (node && node !== document.body) {
      if (num(getComputedStyle(node).borderTopLeftRadius) > 0.5) { overlay = node; break; }
      node = node.parentElement;
    }
    if (!overlay) throw new Error("no rounded overlay ancestor found above the field");
    const fieldRadius = num(getComputedStyle(fieldBox).borderTopLeftRadius);
    const overlayRadius = num(getComputedStyle(overlay).borderTopLeftRadius);
    const f = fieldBox.getBoundingClientRect();
    const o = overlay.getBoundingClientRect();
    const inset = Math.min(f.left - o.left, o.right - f.right, f.top - o.top);
    const shadow = getComputedStyle(fieldBox).boxShadow;
    // A comma outside any rgb()/rgba() call splits shadow layers. Tailwind's
    // ring/shadow utilities always emit every slot (offset, ring, ring-
    // offset, shadow…), so an unused one is a transparent, zero-alpha
    // layer — inert regardless of `inset` — not a real outer shadow.
    const layers = shadow === "none" ? [] : shadow.split(/,(?![^(]*\))/);
    const isNoop = (layer: string) => /rgba?\([^)]*,\s*0\s*\)/.test(layer);
    const outerShadow = layers.some((layer) => !layer.includes("inset") && !isNoop(layer));
    return { fieldRadius, overlayRadius, inset, shadow, outerShadow };
  });
}

function assertConcentric(facts: Awaited<ReturnType<typeof cornerFacts>>, label: string) {
  expect(facts.fieldRadius + facts.inset, `${label}: field radius (${facts.fieldRadius}) + inset (${facts.inset}) vs overlay radius (${facts.overlayRadius})`)
    .toBeLessThanOrEqual(facts.overlayRadius + 0.5);
  expect(facts.outerShadow, `${label}: outer (non-inset) box-shadow: ${facts.shadow}`).toBe(false);
}

async function run(page: Page, theme: Theme) {
  await seedTags(page);
  await openApp(page, { theme });

  // The TagPicker's search field.
  await page.locator("[role='row'][data-profile-id]").first().locator("[data-cell='tags']").dblclick();
  const tagDialog = page.getByRole("dialog", { name: "Tags" });
  const tagField = tagDialog.getByRole("combobox", { name: "Find or create a tag" });
  await tagField.focus();
  assertConcentric(await cornerFacts(tagField), `${theme} TagPicker`);
  await page.keyboard.press("Escape");

  // The command palette's search field.
  await page.keyboard.press("ControlOrMeta+k");
  const paletteField = page.getByRole("combobox", { name: "Search commands" });
  await expect(paletteField).toBeFocused();
  assertConcentric(await cornerFacts(paletteField), `${theme} command palette`);
  await page.keyboard.press("Escape");

  // A search inside a menu: the Filters menu (F19, Pair 24: a field, then
  // its values), its Tag values' search, with 9 seeded tags. Scoped to the
  // menu's own panel (a Popover named Filters), so this can't silently start
  // matching some other field as the page changes.
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const filtersMenu = page.getByRole("dialog", { name: "Filters", exact: true });
  await filtersMenu.getByRole("option", { name: /^Tag/ }).click();
  const selectField = filtersMenu.getByRole("combobox", { name: "Tag", exact: true });
  await selectField.focus();
  assertConcentric(await cornerFacts(selectField), `${theme} Filters Tag values`);
}

test("overlay corners stay concentric with an embedded field, light theme", async ({ page }) => {
  await run(page, "light");
});

test("overlay corners stay concentric with an embedded field, dark theme", async ({ page }) => {
  await run(page, "dark");
});
