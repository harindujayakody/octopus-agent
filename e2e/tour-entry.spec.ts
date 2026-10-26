import { expect, test, type Page } from "@playwright/test";
import { openApp, seed } from "./support/app";

// Onboarding Task 6: the ways back into the tour. Settings > About "Replay the
// tour", the palette's "Take the tour", What's new after an update, and each
// page's (i) "Show me around". Replay and the other full-tour entries play all
// 16 steps from the first; "Show me around" plays only that page's steps and
// has no "Don't show tips" (that link is for tips nobody asked for).

const KEY = "shardx.onboarding";
const card = (page: Page) => page.locator("[data-tour-card]");
const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), KEY);
const info = (page: Page) => page.locator("main header").getByRole("button", { name: "About this page" });
const aboutTab = (page: Page) => page.getByRole("tab", { name: "About" });
const replay = (page: Page) => page.locator("main").getByRole("button", { name: "Replay the tour", exact: true });
const tipsAgain = (page: Page) => page.locator("main").getByRole("button", { name: "Show page tips again", exact: true });
const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const whatsNew = (page: Page) => page.getByRole("dialog", { name: /What’s new/ });
const endCard = (page: Page) => page.getByRole("dialog", { name: "You’re all set." });
const guard = (page: Page) => page.getByRole("alertdialog", { name: "Save changes to Settings?" });

/** A computer that finished the tour: the welcome answered, the tour done, two pages seen, tips off (as openApp seeds it, plus pages seen). */
const toured = (page: Page, over: Record<string, unknown> = {}) => seed(page, KEY, {
  version: 2, state: "unknown", welcomeDone: true, tour: "done", pagesSeen: ["proxies", "settings"], tipsOff: true, ...over,
});

/** The full tour is on its first step, on Profiles. */
async function expectFullTourFromStart(page: Page) {
  await expect(card(page)).toHaveAttribute("data-step", "sidebar");
  await expect(card(page)).toContainText("1 of 16");
  await expect(page.locator("main[data-section='profiles']")).toBeVisible();
  // A full run has no "Don't show tips": that is for a page's tips.
  await expect(card(page).getByRole("button", { name: "Don’t show tips" })).toHaveCount(0);
}

test("Settings Replay the tour starts the full tour from step 1", async ({ page }) => {
  await toured(page);
  await openApp(page, { section: "settings" });
  await aboutTab(page).click();
  await expect(tipsAgain(page)).toBeVisible();
  await replay(page).click();
  await expectFullTourFromStart(page);
  // What the tour and the tips remembered is forgotten; the welcome stays answered.
  expect(await stored(page)).toMatchObject({ welcomeDone: true, tour: "never", pagesSeen: [] });
  // Ending it is recorded as ever: Esc puts the tour away, and the page it showed is seen.
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).tour).toBe("skipped");
  expect((await stored(page)).pagesSeen).toEqual(["profiles"]);
  await page.waitForTimeout(400);
  await expect(endCard(page)).toHaveCount(0);
});

test("Replay with unsaved Settings asks first; Cancel changes nothing, Don't save starts the tour", async ({ page }) => {
  await toured(page);
  await openApp(page, { section: "settings" });
  await page.getByRole("switch", { name: /tray/i }).click();
  await expect(page.locator("[data-save-bar]")).toBeVisible();
  await aboutTab(page).click();
  await replay(page).click();
  await expect(guard(page)).toBeVisible();
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect(guard(page)).toHaveCount(0);
  await expect(page.locator("main[data-section='settings']")).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  // Nothing was forgotten by the cancelled press.
  expect(await stored(page)).toMatchObject({ tour: "done", pagesSeen: ["proxies", "settings"] });

  await replay(page).click();
  await expect(guard(page)).toBeVisible();
  await guard(page).getByRole("button", { name: "Don’t save" }).click();
  await expectFullTourFromStart(page);
  expect(await stored(page)).toMatchObject({ tour: "never", pagesSeen: [] });
});

test("Show page tips again turns tips back on", async ({ page }) => {
  await toured(page, { pagesSeen: [] });
  await openApp(page, { section: "settings" });
  await aboutTab(page).click();
  await expect(tipsAgain(page)).toBeVisible();
  expect((await stored(page)).tipsOff).toBe(true);
  await tipsAgain(page).click();
  expect((await stored(page)).tipsOff).toBe(false);
  // The press is quiet: the page you are on does not start a tip over you.
  await expect(page.locator("[data-toast]").getByText("Page tips are on", { exact: true })).toBeVisible();
  await expect(tipsAgain(page)).toHaveCount(0);
  await expect(replay(page)).toBeFocused();
  await page.waitForTimeout(600);
  await expect(card(page)).toHaveCount(0);
  // The next page not seen yet plays its tip.
  await page.locator("aside [data-nav='proxies']").click();
  await expect(card(page)).toHaveAttribute("data-step", "proxiesAdd");
  await expect(card(page).getByRole("button", { name: "Don’t show tips" })).toBeVisible();
});

test("Show page tips again is not there while tips are on", async ({ page }) => {
  await toured(page, { tipsOff: false, pagesSeen: ["settings"] });
  await openApp(page, { section: "settings" });
  await aboutTab(page).click();
  await expect(replay(page)).toBeVisible();
  await expect(tipsAgain(page)).toHaveCount(0);
});

test("the palette has Take the tour, and it starts the full tour from any page", async ({ page }) => {
  await toured(page);
  await openApp(page, { section: "proxies" });
  await page.keyboard.press("ControlOrMeta+k");
  const search = palette(page).getByRole("combobox", { name: "Search commands" });
  await expect(search).toBeFocused();
  await search.fill("tour");
  await expect(palette(page).getByRole("option", { name: /Take the tour/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expectFullTourFromStart(page);
  expect(await stored(page)).toMatchObject({ tour: "never", pagesSeen: [] });
  // The keyboard is the tour's: Right goes on.
  await page.keyboard.press("ArrowRight");
  await expect(card(page)).toHaveAttribute("data-step", "search");
});

test("What’s new after an update has Take the tour, and it starts the full tour", async ({ page }) => {
  // An install from before the redesign: a version 1 record, so the welcome was never answered.
  await page.addInitScript(() => localStorage.setItem("shardx-patchlog-seen-version", "0.0.1"));
  await seed(page, KEY, { version: 1, state: "done" });
  await openApp(page);
  await expect(whatsNew(page)).toBeVisible();
  await whatsNew(page).getByRole("button", { name: "Take the tour", exact: true }).click();
  await expect(whatsNew(page)).toHaveCount(0);
  await expectFullTourFromStart(page);
  // No welcome screens for someone who is updating; the tour is the answer.
  await expect(page.getByRole("dialog", { name: "Welcome to Octopus Agent" })).toHaveCount(0);
  expect(await stored(page)).toMatchObject({ welcomeDone: true, tour: "never", pagesSeen: [] });
});

test("What’s new after an update offers the tour only until it was taken or put away", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx-patchlog-seen-version", "0.0.1"));
  await toured(page, { tour: "skipped" });
  await openApp(page);
  await expect(whatsNew(page)).toBeVisible();
  await expect(whatsNew(page).getByRole("button", { name: "Take the tour" })).toHaveCount(0);
});

test("What’s new opened on purpose, with no update, has no Take the tour", async ({ page }) => {
  await toured(page);
  await openApp(page, { section: "settings" });
  await aboutTab(page).click();
  await page.locator("main").getByRole("button", { name: "What’s new" }).click();
  await expect(whatsNew(page)).toBeVisible();
  await expect(whatsNew(page).getByRole("button", { name: "Take the tour" })).toHaveCount(0);
});

test("(i) Show me around plays only that page", async ({ page }) => {
  await toured(page, { pagesSeen: [] });
  await openApp(page, { section: "proxies" });
  await info(page).click();
  await page.getByRole("dialog", { name: "About proxies" }).getByRole("button", { name: "Show me around" }).click();
  await expect(card(page)).toHaveAttribute("data-step", "proxiesAdd");
  await expect(card(page)).toContainText("1 of 2");
  // Asked for, so no "Don't show tips".
  await expect(card(page).getByRole("button", { name: "Don’t show tips" })).toHaveCount(0);
  await card(page).getByRole("button", { name: "Next" }).click();
  await expect(card(page)).toHaveAttribute("data-step", "proxiesHelp");
  await expect(card(page)).toContainText("2 of 2");
  await card(page).getByRole("button", { name: "Finish" }).click();
  await expect(card(page)).toHaveCount(0);
  // It stays on that page, and no "You're all set." follows a page's run.
  await page.waitForTimeout(400);
  await expect(endCard(page)).toHaveCount(0);
  await expect(page.locator("main[data-section='proxies']")).toBeVisible();
  // The page counts as seen; the tour itself is untouched.
  expect(await stored(page)).toMatchObject({ tour: "done", pagesSeen: ["proxies"], tipsOff: true });
});

test("(i) Show me around on Profiles plays the first eight steps of the tour", async ({ page }) => {
  await toured(page, { pagesSeen: [] });
  await openApp(page);
  await info(page).click();
  await page.getByRole("dialog", { name: "About profiles" }).getByRole("button", { name: "Show me around" }).click();
  await expect(card(page)).toHaveAttribute("data-step", "sidebar");
  await expect(card(page)).toContainText("1 of 8");
  await expect(card(page).getByRole("button", { name: "Don’t show tips" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  expect(await stored(page)).toMatchObject({ tour: "done", pagesSeen: ["profiles"] });
});

test("every page's (i) offers Show me around", async ({ page }) => {
  test.slow(); // eight pages in turn
  await toured(page);
  await openApp(page);
  for (const section of ["profiles", "proxies", "fingerprints", "extensions", "bookmarks", "automation", "trash", "settings"]) {
    await page.locator(`aside [data-nav='${section}']`).click();
    await expect(page.locator(`main[data-section='${section}']`)).toBeVisible();
    await info(page).click();
    await expect(page.getByRole("button", { name: "Show me around" }), section).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Show me around" }), section).toHaveCount(0);
  }
});
