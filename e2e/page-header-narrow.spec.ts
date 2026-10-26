import { expect, test, type Page } from "@playwright/test";
import { SECTIONS, openApp } from "./support/app";
import { WINDOWS_UA } from "./support/geometry";

// A page header too narrow for its actions' words (a 1024 x 680 window at 150 %): the
// words give way to the icons, secondary buttons first, before the title does
// (PageHeader's compact.ts). The title stays whole, nothing runs past the header, and a
// button down to its icon keeps its name and says it in a tooltip.
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
test.use({ viewport: { width: 1024, height: 680 } });

const header = (page: Page) => page.locator("main header").first();

function setUp(page: Page, size: number, lang: "en" | "ru" | "zh") {
  return page.addInitScript(([s, l]) => {
    localStorage.setItem("shardx.interfaceSize", String(s));
    localStorage.setItem("shardx.interfaceSize.auto", "1");
    localStorage.setItem("shardx.lang", String(l));
  }, [size, lang] as const);
}

/** The title is whole, and no part of the header runs past its content edge (the captions' room is its padding). */
const holds = (page: Page) => header(page).evaluate((h) => {
  const title = h.querySelector<HTMLElement>("[data-page-title]");
  const end = h.clientWidth - parseFloat(getComputedStyle(h).paddingRight);
  const past = [...h.children].filter((c) => c instanceof HTMLElement && c.offsetLeft + c.offsetWidth > end + 0.5).length;
  return { whole: !title || title.scrollWidth <= title.clientWidth + 0.5, past };
});

test.describe("on macOS", () => {
  test.use({ userAgent: MAC_UA });

  for (const size of [100, 125, 150] as const) {
    test(`Profiles and Proxies hold their title whole at ${size}% in en, ru and zh`, async ({ page }) => {
      test.slow(); // six loads
      for (const lang of ["en", "ru", "zh"] as const) {
        await setUp(page, size, lang);
        for (const section of ["profiles", "proxies"]) {
          await openApp(page, { section });
          expect(await holds(page), `${section} ${lang}`).toEqual({ whole: true, past: 0 });
        }
      }
    });
  }

  test("every page holds at 150% in Russian", async ({ page }) => {
    test.slow(); // one load a page
    await setUp(page, 150, "ru");
    for (const section of [...SECTIONS, "team"]) {
      await openApp(page, { section });
      expect(await holds(page), section).toEqual({ whole: true, past: 0 });
    }
  });

  test("a button down to its icon keeps its name and says it in a tooltip; a wide header keeps the words", async ({ page }) => {
    await setUp(page, 150, "en");
    await openApp(page);
    const filters = header(page).getByRole("button", { name: "Filters", exact: true });
    const add = header(page).getByRole("button", { name: "New profile", exact: true });
    // Square at the 30 px control height (45 px on screen at 150%).
    expect((await filters.boundingBox())!.width).toBeLessThanOrEqual(46);
    expect((await add.boundingBox())!.width).toBeLessThanOrEqual(46);
    await filters.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Filters");
    await filters.click();
    await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 1280, height: 800 });
    await setUp(page, 100, "en");
    await openApp(page);
    await expect(header(page)).not.toHaveAttribute("data-compact");
    await expect(filters).toHaveText("Filters");
    await filters.hover();
    await page.waitForTimeout(700);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });
});

test.describe("on Windows", () => {
  test.use({ userAgent: WINDOWS_UA });

  test("at 150% the actions stay clear of the caption buttons and the title still reads", async ({ page }) => {
    test.slow(); // one load a page
    await setUp(page, 150, "en");
    for (const section of SECTIONS) {
      await openApp(page, { section });
      expect((await holds(page)).past, section).toBe(0);
      const minimize = (await page.locator("[data-captions]").getByRole("button", { name: "Minimize" }).boundingBox())!;
      const actions = (await header(page).locator("> div.ml-auto").boundingBox())!;
      expect(actions.x + actions.width, section).toBeLessThanOrEqual(minimize.x - 8);
      // At its last step the title may lose a few letters, never its first word.
      expect(await header(page).locator("[data-page-title]").evaluate((t) => t.scrollWidth <= t.clientWidth + 0.5 || t.clientWidth >= 60), section).toBe(true);
    }
  });
});
