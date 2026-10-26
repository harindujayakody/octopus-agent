import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, openEditForm, type Theme } from "./support/app";

// Borderless, step 2, Peek (owner, 2026-10-01): Peek is a third panel beside
// the page's list: the panels' 12 px corner, a raised fill and no border. Its
// header has no line under it, its sections are parted by a hairline, and the
// stat strip and the history rows draw no lines. Focus still draws its ring.

const profilePeek = (page: Page) => page.locator("aside[data-peek='profile']");
const proxyPeek = (page: Page) => page.locator("aside[data-peek='proxy']");
const fpPeek = (page: Page) => page.locator("aside[data-peek='fingerprint']");

/** Every side's border width. */
const borders = (el: Locator) => el.evaluate((node) => {
  const cs = getComputedStyle(node);
  return [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth];
});
const NONE = ["0px", "0px", "0px", "0px"];

/** The box-shadow layers that draw a ring: no offset, no blur, a spread of 1 px or more, in a color that shows. */
const rings = (el: Locator) => el.evaluate((node) => {
  const shadow = getComputedStyle(node).boxShadow;
  if (shadow === "none") return [];
  return shadow.split(/,(?![^(]*\))/).filter((layer) => {
    const color = layer.match(/rgba?\([^)]*\)/)?.[0] ?? "";
    const alpha = /rgba\(/.test(color) ? Number(color.match(/[\d.]+/g)![3]) : 1;
    const [x, y, blur, spread] = (layer.replace(color, "").match(/-?[\d.]+px/g) ?? []).map(parseFloat);
    return alpha > 0 && x === 0 && y === 0 && (blur ?? 0) === 0 && (spread ?? 0) >= 1;
  });
});

async function expectPanel(peek: Locator, what: string) {
  expect(await borders(peek), `${what}: border widths`).toEqual(NONE);
  expect(await rings(peek), `${what}: a ring among its shadows`).toEqual([]);
  expect(await peek.evaluate((el) => getComputedStyle(el).borderTopLeftRadius), `${what}: radius`).toBe("12px");
  expect(await borders(peek.locator("[data-peek-header]")), `${what}: header borders`).toEqual(NONE);
  const sections = peek.locator("[data-peek-section]");
  // A count does not wait: let the body render its sections first.
  await expect(sections.first(), `${what}: has sections`).toBeVisible();
  // A hairline between two sections (owner, 2026-10-02), none above the first.
  for (let i = 0; i < (await sections.count()); i++) {
    const [top, ...rest] = await borders(sections.nth(i));
    const follows = await sections.nth(i).evaluate((el) => !!el.previousElementSibling?.matches("[data-peek-section]"));
    expect(top, `${what}: section ${i} top line`).toBe(follows ? "1px" : "0px");
    expect(rest, `${what}: section ${i} other borders`).toEqual(NONE.slice(1));
  }
}

for (const theme of ["light", "dark"] as Theme[]) {
  test(`Profile Peek is a borderless panel, 8 px from the list, and its sections and stats draw no lines (${theme})`, async ({ page }) => {
    await openApp(page, { theme });
    await page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='name']").click();
    const peek = profilePeek(page);
    await expect(peek).toBeVisible();
    await expectPanel(peek, "Profile Peek");
    // The panel's fill is the raised layer: white in light, one step up from the page in dark.
    await expect(peek).toHaveCSS("background-color", theme === "light" ? "rgb(255, 255, 255)" : "rgb(34, 34, 34)");
    // Beside the list (the page is wide enough to push) it sits the panels' 8 px gap away.
    const list = await page.locator("[data-list-column]").boundingBox();
    const at = await peek.boundingBox();
    expect(Math.round(at!.x - (list!.x + list!.width))).toBe(8);
    // The stat strip has no line under it.
    await expect(peek.locator("[data-peek-stats]")).toBeVisible();
    expect(await borders(peek.locator("[data-peek-stats]"))).toEqual(NONE);
  });
}

test("Proxy Peek and Fingerprint Peek are the same borderless panel, and the history rows draw no lines", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id]", { hasText: "DC Tokyo" }).locator("[data-cell='name']").click();
  await expect(proxyPeek(page)).toBeVisible();
  await expectPanel(proxyPeek(page), "Proxy Peek");
  const items = proxyPeek(page).locator("[data-history-item]");
  for (let i = 0; i < (await items.count()); i++) expect(await borders(items.nth(i))).toEqual(NONE);
  await openApp(page, { section: "fingerprints" });
  await page.locator("[data-fingerprint-id]", { hasText: "macOS 14, Apple M1" }).first().click();
  await expect(fpPeek(page)).toBeVisible();
  await expectPanel(fpPeek(page), "Fingerprint Peek");
});

// The Notes row grows with its text (owner, 2026-10-02: "dont make scroll on
// notes, grow it with text"): every line shows, wrapped, with no scrollbar and
// no fixed height; an empty note keeps the one-line height. Notes is typed in
// the profile form since manual save (Peek only shows it).
test("the Notes field grows with its text, has no scroll of its own and its label stays on the first line", async ({ page }) => {
  await openApp(page);
  const form = await openEditForm(page, "Sandbox");
  const row = form.locator("[data-property='notes']");
  const notes = row.getByRole("textbox", { name: "Notes" });
  await notes.fill("");
  const oneLine = (await notes.boundingBox())!.height;
  expect(oneLine).toBeLessThanOrEqual(28);
  await notes.fill("First line\nSecond line\nThird line");
  const three = (await notes.boundingBox())!.height;
  expect(three).toBeGreaterThan(oneLine);
  const fit = await notes.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, overflowY: getComputedStyle(el).overflowY }));
  expect(Math.abs(fit.scroll - fit.client)).toBeLessThanOrEqual(1);
  expect(fit.overflowY).not.toBe("auto");
  expect(fit.overflowY).not.toBe("scroll");
  // The label sits at the top, level with the first line, not centered on the
  // field: the middles of the label's line and of the field's first line.
  const tops = await row.evaluate((el) => {
    const label = el.querySelector("[data-property-label]") as HTMLElement;
    const field = el.querySelector("textarea") as HTMLElement;
    const ls = getComputedStyle(label);
    const fs = getComputedStyle(field);
    return {
      label: label.getBoundingClientRect().top + parseFloat(ls.paddingTop) + parseFloat(ls.lineHeight) / 2,
      field: field.getBoundingClientRect().top + parseFloat(fs.paddingTop) + parseFloat(fs.lineHeight) / 2,
    };
  });
  expect(Math.abs(tops.label - tops.field)).toBeLessThanOrEqual(2);
  // A new line grows it.
  await notes.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Fourth line");
  await expect.poll(async () => (await notes.boundingBox())!.height).toBeGreaterThan(three);
  const grown = await notes.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(Math.abs(grown)).toBeLessThanOrEqual(1);
});
