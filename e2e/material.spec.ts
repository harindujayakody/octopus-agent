import { expect, test, type CDPSession, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// Live layer, spec 7: the header material and its scroll-edge fade, and what
// becomes of them under Reduce transparency and in forced colors.

const header = (page: Page) => page.locator("[data-header]");

/** The alpha of an element's background, however the browser writes the color. */
const backgroundAlpha = (el: Locator) =>
  el.evaluate((node) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = getComputedStyle(node).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3] / 255;
  });

/** The alpha of a pinned cell's backing, its ::before (app.css `list-pin-*`). */
const backingAlpha = (el: Locator) =>
  el.evaluate((node) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = getComputedStyle(node, "::before").backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3] / 255;
  });

const style = (el: Locator, prop: "backdropFilter" | "borderBottomWidth") =>
  el.evaluate((node, p) => getComputedStyle(node)[p], prop);

/** The 1 px divider's color: a line laid over the header's bottom edge (its
 *  ::after), so it takes no layout (merge point 4, F24). */
const line = (el: Locator) => el.evaluate((node) => getComputedStyle(node, "::after").backgroundColor);

/** `--stroke-soft-200` as the browser writes it: the 1 px divider's color. */
const dividerColor = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "var(--stroke-soft-200)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });

/** Whether any layer of the element's box-shadow has a color you can see. */
const shadowShows = (el: Locator) =>
  el.evaluate((node) => (getComputedStyle(node).boxShadow.match(/rgba?\([^)]*\)/g) ?? []).some((c) => !/,\s*0\)$/.test(c)));

/** Playwright has no reducedTransparency option, and headless Chromium
 *  follows the OS setting (on in macOS here): pin it, through Chromium's own
 *  media emulation, which replaces Playwright's (so it keeps reduced motion,
 *  the suite's default, and sets forced colors too). */
const sessions = new WeakMap<Page, CDPSession>();
async function emulate(page: Page, { transparency, forcedColors = "none" }: { transparency: "reduce" | "no-preference"; forcedColors?: "active" | "none" }) {
  // One session per page, so a second call replaces the first one's media.
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    sessions.set(page, cdp);
  }
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-transparency", value: transparency },
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "forced-colors", value: forcedColors },
    ],
  });
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-transparency: reduce)").matches)).toBe(transparency === "reduce");
  expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(forcedColors === "active");
}

async function scroll(page: Page, top: number) {
  await page.locator("[data-list]").evaluate((el, y) => { el.scrollTop = y; }, top);
  if (top > 0) await expect(header(page)).toHaveAttribute("data-scrolled");
  else await expect(header(page)).not.toHaveAttribute("data-scrolled");
}

for (const theme of ["light", "dark"]) {
  test(`the header material blurs what scrolls under it; the edge fades in once scrolled (${theme})`, async ({ page }) => {
    await page.goto(`/e2e/kit/material.html?theme=${theme}`);
    await emulate(page, { transparency: "no-preference" });
    const bar = header(page);
    expect(await style(bar, "backdropFilter")).toBe("blur(12px) saturate(1.6)");
    const alpha = await backgroundAlpha(bar);
    expect(alpha).toBeGreaterThan(0.7);
    expect(alpha).toBeLessThan(0.9);
    // At the top, no edge at all; the old hard divider is gone.
    expect(await shadowShows(bar)).toBe(false);
    expect(await line(bar)).toBe("rgba(0, 0, 0, 0)");
    // It fades in and out (--motion-base).
    await scroll(page, 40);
    await expect.poll(() => shadowShows(bar)).toBe(true);
    await scroll(page, 0);
    await expect.poll(() => shadowShows(bar)).toBe(false);
  });
}

test("under Reduce transparency the material is solid and a 1 px divider stays", async ({ page }) => {
  await page.goto("/e2e/kit/material.html");
  await emulate(page, { transparency: "reduce" });
  const bar = header(page);
  expect(await style(bar, "backdropFilter")).toBe("none");
  expect(await backgroundAlpha(bar)).toBe(1);
  const divider = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "var(--stroke-soft-200)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(await line(bar)).toBe(divider);
  expect(await bar.evaluate((node) => getComputedStyle(node, "::after").height)).toBe("1px");
  // A line over the edge, not a border: the header's content keeps its height.
  expect(await style(bar, "borderBottomWidth")).toBe("0px");
  await scroll(page, 40);
  // Where the edge settles, read at once: its fade turned off, no shadow.
  await bar.evaluate((el) => { el.style.transition = "none"; });
  expect(await shadowShows(bar)).toBe(false);
});

test("in forced colors the material is a solid Canvas with a system divider", async ({ page }) => {
  await page.goto("/e2e/kit/material.html");
  await emulate(page, { transparency: "no-preference", forcedColors: "active" });
  const bar = header(page);
  expect(await style(bar, "backdropFilter")).toBe("none");
  expect(await backgroundAlpha(bar)).toBe(1);
  const canvasText = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "CanvasText";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(await line(bar)).toBe(canvasText);
});

// ---- On the app's headers (Task 7) ----------------------------------------

test("the Profiles table header is the standard header, the material: its edge fades in once rows pass under it; its line is the list's first divider", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __shardxMockProfiles: 60 }));
  await openApp(page);
  await emulate(page, { transparency: "no-preference" });
  // The grid stays the scroll box; the header row is its first row.
  const grid = page.getByRole("treegrid");
  const head = grid.locator("[data-list-header]");
  // The kit's standard header (owner, 2026-10-01): one header for every table.
  await expect(head).toHaveClass(/(^|\s)list-head(\s|$)/);
  // Opaque, no blur (owner, 2026-10-02): rows disappear under it, edge to edge.
  expect(await style(head, "backdropFilter")).toBe("none");
  expect(await backgroundAlpha(head)).toBe(1);
  const tile = await page.locator("[data-list-tile]").boundingBox();
  const bar = await head.boundingBox();
  expect(Math.abs(bar!.x - tile!.x)).toBeLessThan(1);
  expect(Math.abs(bar!.width - tile!.width)).toBeLessThan(1);
  // At the top: no edge, and no border; its one line is the list's first
  // divider (owner: "add divider under header row"), laid over its bottom
  // edge, so nothing takes layout and the titles center on its whole 32 px.
  await expect(head).not.toHaveAttribute("data-scrolled");
  expect(await head.evaluate((el) => getComputedStyle(el, "::after").backgroundImage)).toBe(`linear-gradient(${await dividerColor(page)}, ${await dividerColor(page)})`);
  expect(await style(head, "borderBottomWidth")).toBe("0px");
  expect(await head.evaluate((el) => el.clientHeight)).toBe(32);
  expect(await shadowShows(head)).toBe(false);
  // No column passes under the pinned cells: they let the material through.
  expect(await backingAlpha(head.locator(".list-pin-check"))).toBe(0);
  expect(await backingAlpha(head.locator(".list-pin-end"))).toBe(0);
  // Rows under it (40 px): the edge fades in; back at the top it goes.
  await grid.evaluate((el) => { el.scrollTop = 40; });
  await expect(head).toHaveAttribute("data-scrolled", "");
  await expect.poll(() => shadowShows(head)).toBe(true);
  await grid.evaluate((el) => { el.scrollTop = 0; });
  await expect(head).not.toHaveAttribute("data-scrolled");
  await expect.poll(() => shadowShows(head)).toBe(false);
});

test("the table header's pinned cells turn solid only while columns pass under them", async ({ page }) => {
  await openApp(page);
  await emulate(page, { transparency: "no-preference" });
  // Peek open: the list waits past the card's right edge (peek.spec).
  await page.locator("[role='row'][data-profile-id]").first().locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek]")).toBeVisible();
  const grid = page.getByRole("treegrid");
  const head = grid.locator("[data-list-header]");
  await expect(grid).toHaveAttribute("data-x-more", "");
  expect(await backingAlpha(head.locator(".list-pin-end"))).toBe(1);
  expect(await backingAlpha(head.locator(".list-pin-check"))).toBe(0);
  await grid.evaluate((el) => { el.scrollLeft = 40; });
  await expect(grid).toHaveAttribute("data-x-scrolled", "");
  expect(await backingAlpha(head.locator(".list-pin-check"))).toBe(1);
});

test("the page header: a soft edge fades in while the page scrolls, in place of the rule; Reduce transparency keeps the rule, only while scrolled (LQ-09)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Profile defaults" }).click();
  const bar = page.locator("main header").first();
  const scrollPage = (y: number) =>
    page.locator("main [data-page-body]").evaluate((el, top) => { el.scrollTop = top; el.dispatchEvent(new Event("scroll")); }, y);
  await emulate(page, { transparency: "no-preference" });
  // No material: nothing passes under it, the body scrolls in its own box.
  expect(await style(bar, "backdropFilter")).toBe("none");
  expect(await backgroundAlpha(bar)).toBe(0);
  expect(await line(bar)).toBe("rgba(0, 0, 0, 0)");
  expect(await shadowShows(bar)).toBe(false);
  await scrollPage(200);
  await expect(bar).toHaveAttribute("data-scrolled", "true");
  await expect.poll(() => shadowShows(bar)).toBe(true);
  expect(await line(bar)).toBe("rgba(0, 0, 0, 0)");
  // Raised, so the edge lies over the content scrolled under it.
  expect(await bar.evaluate((el) => getComputedStyle(el).zIndex)).not.toBe("auto");
  await emulate(page, { transparency: "reduce" });
  await expect.poll(() => shadowShows(bar)).toBe(false);
  expect(await line(bar)).toBe(await dividerColor(page));
  await scrollPage(0);
  await expect(bar).not.toHaveAttribute("data-scrolled");
  expect(await line(bar)).toBe("rgba(0, 0, 0, 0)");
});
