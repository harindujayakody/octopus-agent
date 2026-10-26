import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, waitForIdle, type Theme } from "./support/app";

// Borderless, step 2, Automation and Traffic (owner, 2026-10-01): the editor's
// cards are tiles with no line inside them, a canvas node is a tile that shows
// only its ring when selected, the Traffic rules are a list on a tile with the
// kit's inset row lines, and the review dialog's lines are the same list.

/** The shadow layers that draw a ring: an edge, not a shadow. */
const ringsOf = (shadow: string): string[] => {
  if (shadow === "none") return [];
  return shadow.split(/,(?![^(]*\))/).filter((layer) => {
    const color = layer.match(/rgba?\([^)]*\)/)?.[0] ?? "";
    const alpha = /rgba\(/.test(color) ? Number(color.match(/[\d.]+/g)![3]) : 1;
    const [x, y, blur, spread] = (layer.replace(color, "").match(/-?[\d.]+px/g) ?? []).map(parseFloat);
    return alpha > 0 && x === 0 && y === 0 && (blur ?? 0) === 0 && (spread ?? 0) >= 1;
  });
};

const edgeOf = (el: Locator) => el.evaluate((node) => {
  const cs = getComputedStyle(node);
  return {
    borders: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth],
    shadow: cs.boxShadow,
  };
});

async function expectNoEdge(el: Locator, what: string) {
  const { borders, shadow } = await edgeOf(el);
  expect(borders, `${what}: border widths`).toEqual(["0px", "0px", "0px", "0px"]);
  expect(ringsOf(shadow), `${what}: a ring among its shadows (${shadow})`).toEqual([]);
}

/** A list on a tile: the tile's own 4 px inset is padding at the sides and
 *  bottom, none at the top, with no border (vf-c, merge point 12), and no ring. */
async function expectListTile(el: Locator, what: string) {
  const s = await el.evaluate((node) => {
    const cs = getComputedStyle(node);
    return {
      borders: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth],
      padding: [cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
      radius: cs.borderTopLeftRadius,
      shadow: cs.boxShadow,
    };
  });
  expect(s.borders, `${what}: border widths`).toEqual(["0px", "0px", "0px", "0px"]);
  expect(s.padding, `${what}: the 4 px inset at the sides and bottom`).toEqual(["4px", "4px", "4px"]);
  expect(s.radius, `${what}: tile corner`).toBe("10px");
  expect(ringsOf(s.shadow), `${what}: a ring`).toEqual([]);
}

/** A row's line (its top edge's ::after): inset 12 px, 1 px tall, or hidden. */
const lineOf = (row: Locator) => row.evaluate((node) => {
  const cs = getComputedStyle(node, "::after");
  return { display: cs.display, left: cs.left, right: cs.right, top: cs.top, height: cs.height, opacity: cs.opacity };
});

async function openEditor(page: Page, theme: Theme) {
  await openApp(page, { section: "automation", theme });
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Add step" })).toBeVisible();
}

async function withRules(page: Page, theme: Theme) {
  await openApp(page, { section: "automation", theme });
  await page.evaluate(() => {
    const w = window as unknown as { __shardxMock: { state: { automation: { id: string; rules: unknown[] }[] }; save: () => void } };
    w.__shardxMock.state.automation.find((p) => p.id === "proj-pricing")!.rules = [
      { match: { url: "*.doubleclick.net/*" }, action: { type: "block" } },
      { match: { url: "*://*.example.com/*", resource: "stylesheet" }, action: { type: "modify", setHeaders: [{ name: "Accept-Language", value: "de-DE" }] } },
      { match: { url: "*.tracker.example/*" }, action: { type: "block" } },
    ];
    w.__shardxMock.save();
  });
  await page.reload();
  await waitForIdle(page);
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  await page.getByRole("radio", { name: /Traffic/ }).click();
}

for (const theme of ["light", "dark"] as const) {
  test(`the editor draws no line inside its tiles, ${theme}`, async ({ page }) => {
    await openEditor(page, theme);
    // The canvas card's step-count row and the side panel's card.
    await expectNoEdge(page.getByRole("button", { name: "Add step" }).locator(".."), "the step-count row");
    await expectNoEdge(page.locator("[data-editor-panel]").locator(".."), "the side panel tile");
    await expectNoEdge(page.locator("[data-block-canvas]").locator("xpath=ancestor::div[contains(@class,'tile')][1]"), "the canvas tile");

    // A node is a tile with an opaque fill, no ring and no shadow at rest.
    const node = page.locator("[data-step-card]").first();
    await expectNoEdge(node, "a node at rest");
    const fill = await node.evaluate((n) => getComputedStyle(n).backgroundColor);
    expect(fill, "a node's fill is opaque").toMatch(/^rgb\(/);

    // Selected, it shows its ring and nothing else.
    await node.click();
    const sel = await edgeOf(node);
    expect(sel.borders).toEqual(["0px", "0px", "0px", "0px"]);
    expect(ringsOf(sel.shadow).length, "a selected node shows its ring").toBeGreaterThan(0);

    // The title field answers the pointer with a fill, not a ring.
    const title = page.getByRole("textbox", { name: "Project name" });
    await title.hover();
    // The fill eases in (`transition-hover`): wait for it rather than read its first frame.
    await expect.poll(() => title.evaluate((n) => getComputedStyle(n).backgroundColor), { message: "the title field's hover fill" }).not.toBe("rgba(0, 0, 0, 0)");
    expect(ringsOf((await edgeOf(title)).shadow)).toEqual([]);
  });
}

test("the browser column draws no line between its rows", async ({ page }) => {
  await openEditor(page, "light");
  await page.getByRole("button", { name: "Open browser" }).click();
  const column = page.locator("[data-browser-column]");
  await expect(column).toBeVisible();
  await expectNoEdge(column, "the browser column");
  await expectNoEdge(column.locator("> div").first(), "its profile row");
  await expectNoEdge(column.locator("> div").last(), "its console row");
});

for (const theme of ["light", "dark"] as const) {
  test(`the Traffic rules are a list on a tile with inset row lines, ${theme}`, async ({ page }) => {
    await withRules(page, theme);
    const list = page.locator("[data-rules-list]");
    await expectListTile(list, "the rules list");
    const items = page.locator("[data-rule-item]");
    await expect(items).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expectNoEdge(items.nth(i), `rule ${i}`);

    // No line under the tile's top; the others are inset 12 px, 1 px tall.
    expect((await lineOf(items.first())).opacity).toBe("0");
    expect(await lineOf(items.nth(1))).toMatchObject({ display: "block", left: "12px", right: "12px", top: "0px", height: "1px", opacity: "1" });

    // A hovered row hides its own line and the next one's, not the rest.
    await items.nth(0).locator("[data-rule-row]").hover();
    expect((await lineOf(items.nth(1))).opacity).toBe("0");
    expect((await lineOf(items.nth(2))).opacity).toBe("1");
    await items.nth(1).locator("[data-rule-row]").hover();
    expect((await lineOf(items.nth(1))).opacity).toBe("0");
    expect((await lineOf(items.nth(2))).opacity).toBe("0");

    // Open, a rule's form has no line above it.
    await items.nth(1).locator("[data-rule-row]").click();
    await expectNoEdge(page.locator("[data-rule-form]"), "the open rule's form");
    await page.mouse.move(0, 0);
    expect((await lineOf(items.nth(1))).opacity, "an open rule's line").toBe("0");
    expect((await lineOf(items.nth(2))).opacity, "the line after an open rule").toBe("0");
  });
}

test("the review dialog's lines are a list on a tile with inset row lines", async ({ page }) => {
  await openApp(page, { section: "automation", theme: "light" });
  const bundle = {
    format: 1, exported_at: 0,
    project: {
      id: "p-x", name: "Shared helper", notes: "",
      blocks: [
        { id: "s1", kind: "file.append", label: "Save note", params: { path: "/Users/you/.zshrc", line: "x" }, enabled: true, secrets: [], x: 0, y: 0, on_done: "next", on_fail: "stop" },
        { id: "s2", kind: "http.request", label: "Report", params: { method: "POST", url: "https://collect.example/upload" }, enabled: true, secrets: [], x: 0, y: 60, on_done: "next", on_fail: "stop" },
      ],
      run: { threads: 1, loops: 1, hours: 0, profiles: [], start: "" },
      rules: [], created_at: 0, updated_at: 0,
    },
    modules: [], needs: [],
  };
  await page.locator("main input[type=file]").setInputFiles({ name: "b.shardx-project.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bundle)) });
  const list = page.locator("[data-review-lines]");
  await expect(list).toBeVisible();
  await expectListTile(list, "the review list");
  const rows = list.locator("li");
  await expect(rows).toHaveCount(2);
  await expectNoEdge(rows.nth(1), "a review line");
  expect((await lineOf(rows.first())).opacity).toBe("0");
  expect(await lineOf(rows.nth(1))).toMatchObject({ display: "block", left: "12px", right: "12px", height: "1px" });
});
