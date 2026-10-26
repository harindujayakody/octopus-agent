import { expect, test, type Page } from "@playwright/test";
import { openApp, type Theme } from "./support/app";

// Audit Phase B, B1: tokens name roles, not shades (COLOR-01). These read what
// the browser resolves, so a class that drifts back to a shade, or a layer that
// inverts in dark, fails here. Task 5 adds colored text and images.

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
/** A CSS color expression as the browser resolves it, e.g. "rgba(0, 0, 0, 0.05)". */
const resolve = (page: Page, css: string) =>
  page.evaluate((c) => {
    const probe = document.createElement("span");
    probe.style.color = c;
    document.body.appendChild(probe);
    const v = getComputedStyle(probe).color;
    probe.remove();
    return v;
  }, css);
const bgOf = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
/** WCAG luminance of an opaque computed color. */
const luminance = (rgb: string) => {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

for (const theme of ["light", "dark"] as Theme[]) {
  // Borderless (owner, 2026-10-01): the sidebar is a white panel on the canvas.
  test(`the sidebar is a panel on the canvas and the list on the surface (${theme})`, async ({ page }) => {
    await openApp(page, { theme });
    expect(await bgOf(page, "aside")).toBe(await resolve(page, "var(--bg-white-0)"));
    expect(await bgOf(page, "body")).toBe(await resolve(page, "var(--bg-canvas)"));
    // The list sits on its tile (vf-f, merge point 12): white on the ground
    // in light, the weak fill's opaque twin over the panel in dark, the one
    // color its header, rows and pinned cells paint (owner, 2026-10-07, item 20).
    expect(await bgOf(page, "main .list-tile")).toBe(await resolve(page, "var(--bg-tile)"));
  });

  test(`the current page in the sidebar is neutral, not the accent (O3, ${theme})`, async ({ page }) => {
    await openApp(page, { theme });
    const current = page.locator("aside [aria-current='page']");
    await expect(current).toHaveCount(1);
    // Active equals hover (owner, 2026-10-01): the current item is the hover gray.
    expect(await current.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await resolve(page, "var(--bg-hover)"));
    expect(await current.evaluate((el) => getComputedStyle(el).color)).toBe(await resolve(page, "var(--text-strong-950)"));
  });

  test(`the row in Peek, not the target, has the quieter fill and a checked row the selected fill (${theme})`, async ({ page }) => {
    await openApp(page, { theme });
    await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
    await expect(page.locator("aside[data-peek]")).toBeVisible();
    // The press on Sandbox's box makes it the target (E13, ruling 6).
    await row(page, "Sandbox").locator("[data-cell='checkbox'] input").check({ force: true });
    await page.mouse.move(1, 1);
    // Each fill one opaque color, the overlay laid over what it lies on (item 20):
    // the hover gray over the tile.
    expect(await row(page, "Etsy craft shop").evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe(await resolve(page, "var(--bg-row-hover-tile)"));
    // A checked row's tint lies over the panel's white (`row-fill-selected`, vf-f).
    expect(await row(page, "Sandbox").evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe(await resolve(page, "var(--bg-row-selected)"));
  });

  test(`the row in Peek keeps its own fill under the hover strip and the pinned cells (${theme})`, async ({ page }) => {
    // The row in Peek, when another row is the target, draws the quieter
    // fill (E13, ruling 6); the hover strip and the pinned cells follow it,
    // or it shows a two-tone band (controller ruling, Task 4). Keyboard focus
    // inside the row shows the strip without making it the target.
    await openApp(page, { theme });
    const peekRow = row(page, "Etsy craft shop");
    await peekRow.locator("[data-cell='name']").click();
    await expect(page.locator("aside[data-peek]")).toBeVisible();
    // Another row becomes the keyboard target, so the Peek row's fill is its
    // own: the pointer moving onto it (E13). A click would open it in Peek
    // instead (Pair 40, O5).
    await row(page, "Sandbox").hover();
    await page.mouse.move(1, 1);
    await expect(peekRow).not.toHaveAttribute("data-active");
    await peekRow.locator("[data-cell='checkbox'] input").focus();
    const rowBg = await peekRow.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(rowBg).toBe(await resolve(page, "var(--bg-row-hover-tile)"));
    expect(await peekRow.locator("[data-hover-strip]").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rowBg);
    for (const cls of ["list-pin-check", "list-pin-name", "list-pin-end"]) {
      expect(await peekRow.locator(`.${cls}`).evaluate((el) => getComputedStyle(el, "::before").backgroundColor)).toBe(rowBg);
    }
  });

  test(`the bulk bar is a raised layer (${theme})`, async ({ page }) => {
    await openApp(page, { theme });
    await row(page, "Sandbox").locator("[data-cell='checkbox'] input").check({ force: true });
    const bar = page.getByRole("toolbar", { name: /selected/ });
    expect(await bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await resolve(page, "var(--bg-raised)"));
  });
}

test("in dark, layers step lighter as they rise: canvas, surface, raised (ruling 2)", async ({ page }) => {
  await openApp(page, { theme: "dark" });
  await row(page, "Etsy craft shop").click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // The ground the panels sit on (borderless: the sidebar is a surface panel now).
  const canvas = luminance(await bgOf(page, "body"));
  // The surface is the page's panel the list's tile sits on (vf-f, merge point 12).
  const surface = luminance(await bgOf(page, "main"));
  const raised = luminance(await menu.evaluate((el) => getComputedStyle(el).backgroundColor));
  expect(surface).toBeGreaterThan(canvas);
  expect(raised).toBeGreaterThan(surface);
});

test("no text on Profiles, its menu or Settings is drawn in the brand fill color (COLOR-03)", async ({ page }) => {
  await openApp(page, { theme: "dark" });
  const brandFill = "rgb(83, 94, 253)";
  const inBrandFill = () =>
    page.evaluate((fill) => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
        if (!own) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        if (cs.color === fill) out.push(el.textContent!.trim().slice(0, 40));
      }
      return out;
    }, brandFill);
  expect(await inBrandFill()).toEqual([]);
  await row(page, "Etsy craft shop").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  expect(await inBrandFill()).toEqual([]);
  await page.keyboard.press("Escape");
  await openApp(page, { theme: "dark", section: "settings" });
  // The links this guards live on the API & MCP tab, not the default one.
  await page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name: "API & MCP" }).click();
  expect(await inBrandFill()).toEqual([]);
});

for (const theme of ["light", "dark"] as Theme[]) {
  test(`state words use the state's text color (${theme})`, async ({ page }) => {
    // Phase A (Task 5f, owner feedback 5i) draws the running count in the
    // sidebar and the run status in Peek as neutral words beside a StatusDot,
    // so neither carries a state color. The fingerprint Peek's verdict does:
    // "This computer can run it." is success text.
    await openApp(page, { theme, section: "fingerprints" });
    await page.locator("[data-fingerprint-id]", { hasText: "macOS 14, Apple M1" }).click();
    const verdict = page.locator("aside[data-peek='fingerprint'] [data-peek-section='compat']").getByText("This computer can run it.");
    await expect(verdict).toBeVisible();
    expect(await verdict.evaluate((el) => getComputedStyle(el).color)).toBe(await resolve(page, "var(--success-text)"));
  });

  test(`a flag carries a 10% edge in the theme's own color (${theme})`, async ({ page }) => {
    await openApp(page, { theme, section: "proxies" });
    const flag = page.locator("main [data-flag]").first();
    await expect(flag).toBeVisible();
    expect(await flag.evaluate((el) => getComputedStyle(el).outlineColor)).toBe(await resolve(page, "var(--stroke-image)"));
    expect(await flag.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  });
}

test("platform icons in the fingerprint library are neutral (UI-38)", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  const icons = page.locator("main [data-platform-icon]");
  await expect(icons.first()).toBeVisible();
  const want = await resolve(page, "var(--icon-sub-600)");
  for (const color of await icons.evaluateAll((els) => els.map((el) => getComputedStyle(el).color))) expect(color).toBe(want);
});

test("links inside running text are underlined, not told apart by color alone (A11Y-17)", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name: "API & MCP" }).click();
  const link = page.locator("main p a").first();
  await expect(link).toBeVisible();
  expect(await link.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("underline");
  expect(await link.getAttribute("href")).toMatch(/^https:\/\//);
});
