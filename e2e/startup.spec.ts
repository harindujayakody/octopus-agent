import { readdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle } from "./support/app";
import { startupBytes } from "./support/perf";

// Startup on the production build of the mock (the `perf` project): what the
// first frame shows and what each window loads (PERF-08, PERF-16).
const luminance = (rgb: string) => {
  const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

type First = { theme?: string | null; bg?: string };

/**
 * Loads the app with a stored theme. `theme` is <html>'s data-theme on the
 * first frame (the first requestAnimationFrame runs before the first paint);
 * `bg` is the body's background once the stylesheet is in (after
 * DOMContentLoaded), so a body without its background cannot pass the dark
 * check by being transparent.
 */
async function firstFrame(page: Page, stored: string) {
  await page.addInitScript((stored) => {
    localStorage.setItem("shardx-ui-kit-theme", stored);
    const first: First = {};
    (window as unknown as { __first: First }).__first = first;
    requestAnimationFrame(() => { first.theme = document.documentElement.getAttribute("data-theme"); });
    document.addEventListener("DOMContentLoaded", () => { first.bg = getComputedStyle(document.body).backgroundColor; });
  }, stored);
  await page.goto("/?mock=reset");
  await expect
    .poll(() => page.evaluate(() => {
      const first = (window as unknown as { __first: First }).__first;
      return first.theme !== undefined && first.bg !== undefined;
    }))
    .toBe(true);
  return page.evaluate(() => (window as unknown as { __first: Required<First> }).__first);
}

test("a dark user's first frame is dark", async ({ page }) => {
  const first = await firstFrame(page, "dark");
  expect(first.theme).toBe("dark");
  expect(first.bg).toMatch(/^rgb\(/);
  expect(luminance(first.bg)).toBeLessThan(0.25);
  // The inline color-scheme is gone once the app runs: the stylesheet sets it
  // from data-theme, which a theme change updates.
  await expect.poll(() => page.evaluate(() => document.documentElement.style.colorScheme)).toBe("");
});

test("a light user's first frame is light", async ({ page }) => {
  const first = await firstFrame(page, "light");
  expect(first.theme).toBe("light");
  expect(first.bg).toMatch(/^rgb\(/);
  expect(luminance(first.bg)).toBeGreaterThan(0.75);
});

test("a user on the system theme gets it on the first frame", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const first = await firstFrame(page, "system");
  expect(first.theme).toBe("dark");
});

test("the stylesheets carry no flag images", async ({ page }) => {
  await openApp(page);
  const css = await page.evaluate(async () => {
    const hrefs = [...document.querySelectorAll<HTMLLinkElement>("link[rel='stylesheet']")].map((l) => l.href);
    const texts = await Promise.all(hrefs.map((h) => fetch(h).then((r) => r.text())));
    return { bytes: texts.reduce((a, t) => a + t.length, 0), flags: texts.some((t) => t.includes(".fi-de")) };
  });
  expect(css.flags).toBe(false);
  expect(css.bytes).toBeLessThan(200 * 1024);
});

test("a proxy's flag loads from its own file in the build", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const flag = page.locator("[role='row'][data-proxy-id] [data-flag]").first();
  await expect(flag).toBeVisible();
  const width = await flag.evaluate(async (el) => {
    const url = getComputedStyle(el).backgroundImage.replace(/^url\("?|"?\)$/g, "");
    const img = new Image();
    img.src = url;
    await img.decode();
    return img.naturalWidth;
  });
  expect(width).toBeGreaterThan(0);
});

/** Script URLs the page requests from now on. */
function watchScripts(page: Page) {
  const urls: string[] = [];
  page.on("request", (r) => { if (/\.js(\?|$)/.test(r.url())) urls.push(new URL(r.url()).pathname); });
  return () => [...urls];
}

test("a panel window loads a fraction of the launcher's code, and none of the launcher's own chunk", async ({ page }) => {
  await openApp(page);
  const main = await startupBytes(page);
  const scripts = watchScripts(page);
  const panel = await startupBytes(page, "#/?fleet=1");
  expect(panel.jsKb, JSON.stringify({ main, panel })).toBeLessThan(main.jsKb * 0.6);
  expect(scripts().filter((u) => /\/App-[\w-]+\.js$/.test(u))).toEqual([]);
});

test("the launcher loads its code at start, and Automation's only when it is visited", async ({ page }) => {
  const scripts = watchScripts(page);
  await openApp(page);
  expect(scripts().some((u) => /\/App-[\w-]+\.js$/.test(u))).toBe(true);
  const before = new Set(scripts());
  await page.locator("aside [data-nav='automation']").click();
  await expect(page.locator("main[data-section='automation']")).toBeVisible();
  await waitForIdle(page);
  expect(scripts().filter((u) => !before.has(u)).length).toBeGreaterThan(0);
});

test("What's new loads its notes when it opens", async ({ page }) => {
  const scripts = watchScripts(page);
  await openApp(page);
  const before = new Set(scripts());
  await page.getByRole("button", { name: /Octopus Agent v\d/ }).click();
  await expect(page.getByRole("dialog", { name: /What’s new/ })).toBeVisible();
  expect(scripts().filter((u) => !before.has(u)).length).toBeGreaterThan(0);
});

test("the Chinese and Russian words are chunks of their own, not loaded by an English start", async ({ page }) => {
  for (const lang of ["zh", "ru"]) expect(readdirSync("dist-mock/assets").some((f) => new RegExp(`^${lang}-[\\w-]+\\.js$`).test(f)), lang).toBe(true);
  const scripts = watchScripts(page);
  await openApp(page);
  expect(scripts().filter((u) => /\/(?:zh|ru)-[\w-]+\.js$/.test(u))).toEqual([]);
});

test("a Chinese user's first frame is in Chinese", async ({ page }) => {
  const zh = JSON.parse(readFileSync("src/shared/i18n/locales/zh.json", "utf8")) as Record<string, string>;
  await page.addInitScript(() => {
    localStorage.setItem("shardx.lang", "zh");
    const w = window as unknown as { __firstTitle?: string };
    new MutationObserver(() => {
      const h1 = document.querySelector("main h1");
      if (h1 && w.__firstTitle === undefined) w.__firstTitle = h1.textContent ?? "";
    }).observe(document, { childList: true, subtree: true });
  });
  await openApp(page);
  expect(await page.evaluate(() => (window as unknown as { __firstTitle?: string }).__firstTitle)).toBe(zh["profiles.allTitle"]);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
});
