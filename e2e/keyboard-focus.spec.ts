import { expect, test, type Page } from "@playwright/test";
import { openApp, seed } from "./support/app";
import { openSearch, searchButton } from "./support/search";

// The keyboard never falls to the page (A11Y-04, E5): after Start, a page
// change, a removal, Retry or Clear search it lands on the row, the page
// title, the next item or the field. (e2e/focus.spec.ts holds the ring's
// own checks.)
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const focused = (page: Page) => page.evaluate(() => {
  const el = document.activeElement;
  return el && el !== document.body ? el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? el.tagName : "BODY";
});

test("Tab after Start stays in the row", async ({ page }) => {
  await openApp(page);
  const r = row(page, "Sandbox");
  await r.focus();
  const start = r.getByRole("button", { name: "Start" });
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(r.getByRole("button", { name: "Stop" })).toBeFocused({ timeout: 5000 });
  await page.keyboard.press("Tab");
  await expect(r.getByRole("button", { name: "More actions" })).toBeFocused();
});

test("G then P puts the keyboard in Proxies; a palette page command on its title", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Proxies");
  await expect(page.locator("main :focus")).toHaveCount(1);
  expect(await focused(page)).not.toBe("BODY");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("trash");
  await page.keyboard.press("Enter");
  // The Trash loads its code on first use: the title takes the keyboard once it is there.
  await expect(page.getByRole("heading", { level: 1, name: "Trash" })).toBeFocused();
});

test("a keyboard press on a sidebar item puts the keyboard on the page; a click leaves it on the item", async ({ page }) => {
  await openApp(page);
  const settings = page.locator("aside [data-nav='settings']");
  await settings.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();
  await page.locator("aside [data-nav='proxies']").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Proxies");
  await expect(page.locator("aside [data-nav='proxies']")).toBeFocused();
});

test("deleting a tag in Settings moves the keyboard to the next Delete, then to the Tags tab", async ({ page }) => {
  await seed(page, "shardx.tags", {
    version: 1,
    tags: [{ id: "t-a", name: "alpha", color: "orange" }, { id: "t-b", name: "beta", color: "green" }],
    byProfile: {},
  });
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Tags" }).click();
  await page.getByRole("button", { name: "Delete tag alpha" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Delete tag beta" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Tags" })).toBeFocused();
});

test("Clear search gives the filter the keyboard (PC-121)", async ({ page }) => {
  await openApp(page);
  const filter = await openSearch(page);
  await filter.fill("zzzz");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(filter).toBeFocused();
});

test("Retry gives the keyboard to the page, not to nothing (PC-121)", async ({ page }) => {
  await openApp(page);
  // The fingerprint library's first load fails once; the app is already up,
  // so nothing else takes the failure. (The Trash is read while Profiles
  // opens, so its page loads nothing new.)
  await page.evaluate(() => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = { fingerprint_list: 1 }; });
  await page.locator("aside [data-nav='fingerprints']").click();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.locator("main :focus")).toHaveCount(1);
  expect(await focused(page)).not.toBe("BODY");
});

test("Cmd+K during a rename, then Esc, gives the keyboard back to the row (PC-108)", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("e");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("combobox", { name: "Search commands" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("[role='row'][data-profile-id][data-active]")).toBeFocused();
});

// Roving focus and regions (A11Y-14, E21).

test("the sidebar is one Tab stop, on its current item; the arrows, Home and End move (A11Y-14)", async ({ page }) => {
  await openApp(page);
  const filter = await openSearch(page);
  const profiles = page.locator("aside [data-nav='profiles']");
  // One stop each way: before the sidebar's current item (it was the 21st stop
  // before) comes the page's (i), the header's first stop (clarity fixes,
  // item 7), and the next Shift+Tab leaves the sidebar.
  const info = page.locator("main header").getByRole("button", { name: "About this page" });
  await page.keyboard.press("Shift+Tab");
  await expect(info).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(profiles).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("aside :focus")).toHaveCount(0);
  await profiles.focus();
  await page.keyboard.press("Tab");
  await expect(info).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(searchButton(page)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(info).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(profiles).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator("aside [data-nav='search']")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(profiles).toBeFocused();
  // End reaches the last item, the API row in the footer.
  await page.keyboard.press("End");
  await expect(page.locator("aside [data-api-status]")).toBeFocused();
  // The stop moved with the keys: still one.
  await expect(page.locator("aside [tabindex='0']")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(page.locator("aside :focus")).toHaveCount(0);
});

// Clarity fixes, item 19: Automation, pressed on its own page, is the way back
// from a project to the list; the keyboard lands on the list's title.
test("a keyboard press on Automation, with a project open, goes back to the list and lands on its title", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Add step" })).toBeVisible();
  await page.locator("aside [data-nav='automation']").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[role='listitem'][data-row-id]").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add step" })).toHaveCount(0);
  await expect(page.locator("main h1[data-page-title]")).toBeFocused();
  await expect(page.locator("main h1[data-page-title]")).toHaveText("Automation");
});

// Pair 59: Automation's code loads on first use. Held back here, its loading
// header takes the keyboard first, then hands it to the page's own title.
// The page is there once its header has the projects count.
const projectsCount = (page: Page) => page.locator("main header [data-count]").filter({ hasText: /\d/ });
const slowAutomation = (page: Page) => page.route(/\/src\/pages\/automation\//, async (route) => {
  await new Promise((done) => setTimeout(done, 600));
  await route.continue();
});

test("Automation opened from the palette while its code loads leaves the keyboard on its title (Pair 59)", async ({ page }) => {
  await slowAutomation(page);
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("automation");
  await page.keyboard.press("Enter");
  await expect(projectsCount(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Automation" })).toBeFocused();
});

test("Automation opened by a key on its sidebar item while its code loads leaves the keyboard on its title (Pair 59)", async ({ page }) => {
  await slowAutomation(page);
  await openApp(page);
  await page.locator("aside [data-nav='automation']").focus();
  await page.keyboard.press("Enter");
  await expect(projectsCount(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Automation" })).toBeFocused();
});

test("a page changed by keys moves the sidebar's stop to its item", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Proxies");
  await expect(page.locator("aside [tabindex='0']")).toHaveCount(1);
  await expect(page.locator("aside [data-nav='proxies']")).toHaveAttribute("tabindex", "0");
});

test("Shift+F10 on a sidebar Folder opens its menu at the item (A11Y-13)", async ({ page }) => {
  await openApp(page);
  await page.locator("aside [data-folder='Shops']").focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "Shops" });
  await expect(menu.getByRole("menuitem", { name: /^Edit folder/ })).toBeVisible();
  const m = (await menu.boundingBox())!;
  expect(m.x).toBeLessThan(260);
});

test("F6 cycles the sidebar, the header, the list and Peek; Shift+F6 goes back", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("Enter"); // Peek opens
  await expect(page.locator("aside[data-peek]")).toBeVisible();
  await page.keyboard.press("F6");
  await expect(page.locator("aside[data-peek] :focus")).toHaveCount(1);
  await page.keyboard.press("F6");
  await expect(page.locator("aside:not([data-peek]) :focus")).toHaveCount(1);
  await page.keyboard.press("F6");
  await expect(page.locator("main header[data-region] :focus")).toHaveCount(1);
  await page.keyboard.press("F6");
  await expect(page.locator("[role='row'][data-profile-id][data-active]")).toBeFocused();
  await page.keyboard.press("Shift+F6");
  await expect(page.locator("main header[data-region] :focus")).toHaveCount(1);
});

test("the fingerprint grid is one Tab stop; the arrows move by card and by row", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  const cards = page.locator("main [role='listitem'][data-row-id]");
  await expect(page.locator("main [data-row-id][tabindex='0']")).toHaveCount(1);
  await cards.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("main [data-row-id]:focus")).toHaveCount(1);
  await expect(cards.nth(1)).not.toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("aside[data-peek]")).toBeVisible();
  await expect(page.locator("main [data-row-id][aria-current='true']")).toHaveCount(1);
});

test("closing Peek on a card a filter hid gives the keyboard to the grid, not the page (PC-080)", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  await page.locator("[data-fingerprint-id]", { hasText: "macOS 14, Apple M1" }).click();
  const peek = page.locator("aside[data-peek]");
  await expect(peek).toBeVisible();
  await (await openSearch(page)).fill("Windows");
  await expect(page.locator("[data-fingerprint-id]", { hasText: "macOS 14, Apple M1" })).toHaveCount(0);
  await peek.getByRole("button", { name: "Close Peek" }).focus();
  await page.keyboard.press("Enter");
  await expect(peek).toHaveCount(0);
  await expect(page.locator("main [role='listitem']:focus")).toHaveCount(1);
});
