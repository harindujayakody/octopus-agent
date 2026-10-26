import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// Section labels like premium products, and negative tracking (owner,
// 2026-10-01): "i dont like how this looks, can we make it more like in
// premium products?" and "never make positive tracking on text, also make
// sure we add from -0.01em to -0.02em to texts to balance them".

const type = (l: Locator) => l.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { transform: cs.textTransform, spacing: cs.letterSpacing, size: parseFloat(cs.fontSize), weight: cs.fontWeight };
});
/** Tracking in em: letter-spacing over font size ("normal" is 0). */
const em = async (l: Locator) => {
  const t = await type(l);
  return (t.spacing === "normal" ? 0 : parseFloat(t.spacing)) / t.size;
};
const balanced = async (l: Locator, what: string) => {
  const v = await em(l);
  expect(v, `${what}: ${v.toFixed(4)}em`).toBeLessThanOrEqual(-0.0099);
  expect(v, `${what}: ${v.toFixed(4)}em`).toBeGreaterThanOrEqual(-0.0201);
};

test("the sidebar's Views is a sentence-case section label: no capitals, medium, negative tracking", async ({ page }) => {
  await openApp(page, { theme: "light" });
  const views = page.locator("aside [data-fold-heading]", { hasText: "Views" }).first();
  await expect(views).toBeVisible();
  const t = await type(views);
  expect(t, "Views").toMatchObject({ transform: "none", weight: "500", size: 12 });
  await balanced(views, "Views");
});

// The fold chevron always shows (owner, 2026-10-01: "dont hide chevrones").
test("a fold heading's chevron shows at rest, open or folded", async ({ page }) => {
  await openApp(page, { theme: "light" });
  const heading = page.locator("aside [data-fold-heading]", { hasText: "Views" }).first();
  const chevron = heading.locator("[data-fold-chevron]");
  await page.mouse.move(1, 1);
  await expect(heading).toHaveAttribute("aria-expanded", "true");
  expect(await chevron.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await heading.click();
  await expect(heading).toHaveAttribute("aria-expanded", "false");
  await page.mouse.move(1, 1);
  expect(await chevron.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
});

const pageFacts = async (page: Page) => ({
  button: page.locator("aside [data-nav='proxies']"),
  title: page.locator("main [data-page-title]"),
  label: page.locator("aside [data-fold-heading]").first(),
});

test("in English every text role tracks -0.01em to -0.02em; key caps stay at 0", async ({ page }) => {
  await openApp(page, { theme: "light" });
  const f = await pageFacts(page);
  await balanced(page.locator("[role='row'][data-profile-id]").first(), "a list row's text");
  await balanced(f.button, "a button");
  await balanced(f.title, "the page title");
  await balanced(f.label, "a section label");
  await expect(page.locator("aside kbd").first()).toBeVisible();
  expect(await em(page.locator("aside kbd").first())).toBe(0);
  // A stat number: Peek's stat strip.
  await page.locator("[role='row'][data-profile-id]", { hasText: "Amazon US seller" }).locator("[data-cell='name']").click();
  const stat = page.locator("aside[data-peek='profile'] :is(.text-stat, .text-stat-sm)").first();
  await expect(stat).toBeVisible();
  await balanced(stat, "a stat number");
});

test("in Chinese no text role is tracked", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
  await openApp(page, { theme: "light" });
  const f = await pageFacts(page);
  for (const [l, what] of [[page.locator("[role='row'][data-profile-id]").first(), "row"], [f.button, "button"], [f.title, "title"], [f.label, "label"]] as const) {
    expect(await em(l), what).toBe(0);
  }
});
