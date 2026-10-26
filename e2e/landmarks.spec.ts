import { expect, test, type Page } from "@playwright/test";
import { openApp, row, SECTIONS } from "./support/app";
import { axeViolations } from "./support/axe";

// H1 (A11Y-19, A11Y-22, PC-122): headings and landmarks a screen reader can
// move by, a list that says it is busy while it loads (the list itself, not
// its placeholder), and a Start or Stop said without moving focus.

const levels = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")]
      .filter((h) => h.offsetParent !== null || h.classList.contains("sr-only"))
      .map((h) => Number(h.tagName[1])),
  );

for (const section of SECTIONS) {
  test(`${section}: one main, one page h1, no skipped heading level`, async ({ page }) => {
    await openApp(page, { section });
    await expect(page.getByRole("main")).toHaveCount(1);
    const l = await levels(page);
    expect(l[0], `${l}`).toBe(1);
    expect(l.filter((x) => x === 1), `${l}`).toHaveLength(1);
    for (let i = 1; i < l.length; i++) expect(l[i] - l[i - 1], `${l}`).toBeLessThanOrEqual(1);
    expect(await axeViolations(page, {
      rules: ["heading-order", "page-has-heading-one", "landmark-one-main", "landmark-no-duplicate-main", "landmark-unique"],
    })).toEqual([]);
  });
}

test("the engine screen has a main landmark and a title", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockEngine: string }).__shardxMockEngine = "offline"; });
  await openApp(page, { idle: false });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
});

const LISTS: [string, string][] = [
  ["profiles", "profile_list"], ["proxies", "proxy_list"], ["trash", "trash_list"], ["bookmarks", "bookmark_list"],
  ["extensions", "extension_list"], ["fingerprints", "fingerprint_list"], ["automation", "automation_list"],
];
for (const [section, cmd] of LISTS) {
  test(`${section}: the list itself is busy while it loads`, async ({ page }) => {
    await page.addInitScript((c) => { (window as unknown as { __shardxMockSlow: Record<string, number> }).__shardxMockSlow = { [c]: 4000 }; }, cmd);
    if (section === "automation") {
      // openApp waits for Automation's projects: come in from the sidebar instead.
      await openApp(page);
      await page.locator("aside").getByText("Automation", { exact: true }).click();
    } else {
      await openApp(page, { section, idle: false });
    }
    const busyList = page.locator("[role='treegrid'][aria-busy='true'], [role='grid'][aria-busy='true'], [role='list'][aria-busy='true']");
    await expect(busyList).toHaveCount(1);
    // Nothing else claims it: not the placeholder rows or cards.
    await expect(page.locator("[aria-busy='true']")).toHaveCount(1);
    await expect(busyList).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
  });
}

test("a Start and a Stop are announced politely", async ({ page }) => {
  await openApp(page);
  const polite = page.locator("[data-live='polite']");
  await row(page, "Sandbox").hover();
  await row(page, "Sandbox").getByRole("button", { name: "Start" }).click();
  await expect(polite).toHaveText("Started “Sandbox”");
  await row(page, "Sandbox").hover();
  await row(page, "Sandbox").getByRole("button", { name: "Stop" }).click();
  await expect(polite).toHaveText("Stopped “Sandbox”");
});
