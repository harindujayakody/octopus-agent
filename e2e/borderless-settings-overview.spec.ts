import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, type Theme } from "./support/app";

// Borderless, step 2, section 4 (owner, 2026-10-01): Settings,
// Fingerprints and Extensions draw no frame of their own. A card is a tile
// (the weak fill, no border, no shadow, no lift; its hover is one fill step),
// a Settings group has no lines between its settings, the Tags and Views
// lists are a `list-tile` with the inset row line (12 px in from each end),
// the load error is an error-tint tile, and the Fingerprints group header and
// the Extensions icon well have no line or ring. The selected Fingerprint
// card keeps its 2 px ring.

const edgeOf = (el: Locator) => el.evaluate((node) => {
  const cs = getComputedStyle(node);
  return { borders: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth], shadow: cs.boxShadow, transform: cs.transform };
});
const NONE = ["0px", "0px", "0px", "0px"];
/** A tile's resting shadow where it sits (vf-c's light flip, merge point 12:
 *  a tile on the ground floats on the softest shadow in light, none in dark;
 *  a tile inside a tile or a white surface has none). Never a ring. */
const restingShadow = (el: Locator, css = "var(--tile-shadow, var(--shadow-tile))") => el.evaluate((node, v) => {
  const probe = document.createElement("div");
  probe.style.boxShadow = v;
  node.parentElement!.appendChild(probe);
  const out = getComputedStyle(probe).boxShadow;
  probe.remove();
  return out;
}, css);
async function expectBare(el: Locator, what: string) {
  const { borders, shadow, transform } = await edgeOf(el);
  expect(borders, `${what}: border widths`).toEqual(NONE);
  expect(shadow, `${what}: shadow`).toBe(await restingShadow(el));
  expect(transform, `${what}: transform`).toBe("none");
}
const TAGS = {
  version: 1,
  tags: [{ id: "t-warm", name: "Warm-up", color: "orange" }, { id: "t-vip", name: "VIP", color: "violet" }],
  byProfile: {},
};
const seedTags = (page: Page) => page.addInitScript((v) => {
  if (localStorage.getItem("shardx.tags") === null) localStorage.setItem("shardx.tags", JSON.stringify(v));
}, TAGS);

for (const theme of ["light", "dark"] as Theme[]) {
  test(`Settings: a group of settings is a bare tile with no line between its rows, and Tags is a list tile with the inset row line (${theme})`, async ({ page }) => {
    await seedTags(page);
    await openApp(page, { section: "settings", theme });
    const group = page.locator("[data-setting]").first().locator("xpath=..");
    await expectBare(group, "settings group");
    expect(await group.evaluate((el) => [...el.children].every((c) => getComputedStyle(c).borderTopWidth === "0px" && getComputedStyle(c).borderBottomWidth === "0px")), "no line between settings").toBe(true);

    await page.getByRole("tab", { name: "Tags" }).click();
    const first = page.locator("[data-tag-row='t-warm']");
    const second = page.locator("[data-tag-row='t-vip']");
    const tile = first.locator("xpath=ancestor::div[contains(@class,'list-tile')]");
    const cs = await tile.evaluate((el) => { const s = getComputedStyle(el); return { radius: s.borderTopLeftRadius, borders: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth], shadow: s.boxShadow }; });
    expect(cs.radius, "tile corner").toBe("10px");
    // Its 4 px inset is padding, not a border (vf-c, merge point 12).
    expect(cs.borders, "no border").toEqual(NONE);
    expect(cs.shadow, "the tile's resting shadow, no ring").toBe(await restingShadow(tile, "var(--shadow-tile)"));
    // The row line: on the second row's top edge, inset 12 px, 1 px tall; none above the first.
    const line = (row: Locator) => row.evaluate((el) => { const s = getComputedStyle(el, "::after"); return { content: s.content, left: s.left, right: s.right, height: s.height, opacity: s.opacity }; });
    expect(await line(second)).toEqual({ content: '""', left: "12px", right: "12px", height: "1px", opacity: "1" });
    expect((await line(first)).opacity).toBe("0");
    expect(await edgeOf(second).then((e) => e.borders), "rows draw no border of their own").toEqual(NONE);

    await page.getByRole("tab", { name: "Views" }).click();
    // No saved view here: the empty line sits on the same tile, with no line.
    await expect(page.locator("[data-view-row]")).toHaveCount(0);
  });
}

test("Settings: the load error is an error-tint tile with its word, no ring", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockSettingsLoadError: string }).__shardxMockSettingsLoadError = "unexpected end of file"; });
  await openApp(page, { section: "settings", theme: "light" });
  const card = page.locator("main").getByText("Settings could not be read.").locator("xpath=..");
  await expect(card).toBeVisible();
  await expectBare(card, "load-error card");
  const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
  // A red tint, not the tile's gray: red leads green and blue.
  const [r, g, b] = bg.match(/[\d.]+/g)!.map(Number);
  expect(r, `error tint (${bg})`).toBeGreaterThan(g);
  expect(r).toBeGreaterThan(b);
});

for (const theme of ["light", "dark"] as Theme[]) {
  test(`Fingerprints: the group header has no line, the cards are bare tiles, and the one in Peek keeps its 2 px ring (${theme})`, async ({ page }) => {
    await openApp(page, { section: "fingerprints", theme });
    const header = page.locator("main section h2").first().locator("xpath=..");
    await expect(header).toBeVisible();
    expect((await edgeOf(header)).borders, "group header: no line").toEqual(NONE);
    const item = page.locator("main [role='listitem']").first();
    await expectBare(item, "card");
    expect(await item.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("10px");
    await item.click();
    const card = page.locator("[data-fingerprint-id][data-selected]");
    await expect(card).toHaveCount(1);
    const ring = await card.evaluate((el) => { const s = getComputedStyle(el); return { width: s.outlineWidth, style: s.outlineStyle }; });
    expect(ring).toEqual({ width: "2px", style: "solid" });
  });
}

test("Extensions: the cards are bare tiles and the icon well has no ring", async ({ page }) => {
  await openApp(page, { section: "extensions", theme: "light" });
  const item = page.locator("main [role='listitem']").first();
  await expectBare(item, "extension card");
  const well = item.locator("div[class*='size-[35px]']").first();
  await expect(well).toBeVisible();
  const { shadow, borders } = await edgeOf(well);
  expect(borders).toEqual(NONE);
  expect(shadow, "icon well: no ring").toBe("none");
});
