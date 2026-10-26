import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp, reloadApp } from "./support/app";
import { withLang } from "./support/geometry";
import { openSearch } from "./support/search";

// F6, O8: filters as a field-then-value menu, applied filters as chips. Tasks 20 to 22 append.
const rows = (page: Page) => page.locator("[role='row'][data-profile-id]");
const chips = (page: Page) => page.locator("[data-filter-chips] [data-chip]");
const filtersButton = (page: Page) => page.locator("main header").getByRole("button", { name: /^Filters/ });
async function filter(page: Page, field: string, value: RegExp | string) {
  await filtersButton(page).click();
  await page.getByRole("option", { name: new RegExp(`^${field}`) }).click();
  await page.getByRole("option", { name: value }).click();
}

test("two filters show as two chips; removing one updates the list (O8)", async ({ page }) => {
  await openApp(page);
  await filter(page, "Status", /^Running/);
  await expect(chips(page)).toHaveText(["Status: Running"]);
  await expect(rows(page)).toHaveCount(2);
  await filter(page, "Proxy country", /^Germany/);
  await expect(chips(page)).toHaveCount(2);
  await expect(rows(page)).toHaveCount(1);
  await chips(page).filter({ hasText: "Proxy country" }).getByRole("button", { name: /Remove/ }).click();
  await expect(chips(page)).toHaveCount(1);
  await expect(rows(page)).toHaveCount(2);
});

test("each value says how many profiles it would list", async ({ page }) => {
  await openApp(page);
  await filtersButton(page).click();
  await page.getByRole("option", { name: /^Status/ }).click();
  await expect(page.getByRole("option", { name: /^Running/ })).toContainText("2");
  await expect(page.getByRole("option", { name: /^Idle/ })).toContainText("6");
});

test("the menu works from the keyboard: type, Enter, and Backspace to go back", async ({ page }) => {
  await openApp(page);
  await filtersButton(page).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.type("stat");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("option", { name: /^Proxy country/ })).toBeVisible();
  await page.keyboard.type("coun");
  await page.keyboard.press("Enter");
  await page.keyboard.type("us");
  await page.keyboard.press("Enter");
  await expect(chips(page)).toHaveText(["Proxy country: United States"]);
  await expect(filtersButton(page)).toBeFocused();
});

// Pair 24 review, Important 3 (ruling): a whole value or code first, then a
// prefix of the value, the code or any word, then letters mid-word. "us" is
// in Australia, Belarus and Russia too, which sort before the US by code.
test("a typed code picks its own value first; letters mid-word come last, and a count is never matched", async ({ page }) => {
  type Mock = { __shardxMock: { state: { proxies: { id: string; name: string; country: string }[]; profiles: Record<string, { _meta: { proxy_id: string | null } }> }; save: () => void } };
  await openApp(page);
  await page.evaluate(() => {
    const mock = (window as unknown as Mock).__shardxMock;
    const base = mock.state.proxies[0];
    const add: [string, string, string][] = [["px-au", "AU", "aed41005"], ["px-by", "BY", "c31d92f1"], ["px-ru", "RU", "e51f8c32"]];
    for (const [id, country, profile] of add) {
      mock.state.proxies.push({ ...base, id, name: `DC ${country}`, country });
      mock.state.profiles[profile]._meta.proxy_id = id;
    }
    mock.save();
  });
  await reloadApp(page);
  await filtersButton(page).click();
  await page.getByRole("option", { name: /^Proxy country/ }).click();
  await page.keyboard.type("us");
  await expect(page.getByRole("option").first()).toHaveAccessibleName(/^United States/);
  await expect(page.getByRole("option")).toHaveText([/^United States/, /^Australia/, /^Belarus/, /^Russia/]);
  await page.keyboard.press("Enter");
  await expect(chips(page)).toHaveText(["Proxy country: United States"]);
  // A digit is not a value: the counts are not searched.
  await filtersButton(page).click();
  await page.getByRole("option", { name: /^Status/ }).click();
  await page.keyboard.type("2");
  await expect(page.getByRole("option")).toHaveCount(0);
});

test("countries are listed with their flags; there is no separate flag row (CRAFT-08)", async ({ page }) => {
  await openApp(page);
  await filtersButton(page).click();
  await page.getByRole("option", { name: /^Proxy country/ }).click();
  await expect(page.getByRole("option", { name: /^United States/ }).locator("[data-flag], .fi, img").first()).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "United States" })).toHaveCount(0);
});

test("Clear removes every chip; Save as view keeps them under a name", async ({ page }) => {
  await openApp(page);
  await filter(page, "Status", /^Idle/);
  await expect(page.locator("main header").getByRole("button", { name: "Save as view" })).toBeVisible();
  await page.locator("[data-filter-chips]").getByRole("button", { name: "Clear filters" }).click();
  await expect(chips(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(8);
});

test("chips speak Chinese in the Chinese UI", async ({ page }) => {
  await withLang(page, "zh");
  await openApp(page);
  await page.locator("main header").getByRole("button", { name: /^筛选/ }).click();
  await page.getByRole("option").first().click();
  await page.getByRole("option").first().click();
  await expect(chips(page).first()).toContainText("：");
});

// The Live layer's action cards filter by what a set of profiles shares: the
// profiles on one proxy, and those not run in 30 days.
test("Connection lists each proxy in use; the profiles on one proxy show as a chip", async ({ page }) => {
  await openApp(page);
  await filtersButton(page).click();
  await page.getByRole("option", { name: /^Connection/ }).click();
  await page.keyboard.type("resi");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option", { name: /^ProxyShard resi US/ })).toContainText("2");
  await page.keyboard.press("Enter");
  await expect(chips(page)).toHaveText(["Connection: ProxyShard resi US"]);
  await expect(rows(page)).toHaveText([/Amazon US seller/, /FB Ads acc-01/]);
});

test("a caller sets a filter by proxy id or last run, and each shows as a removable chip", async ({ page }) => {
  type P = { __profile: { onProxy: (id: string) => string; useProfileUi: { getState: () => { setFilters: (f: object) => void } } } };
  await openApp(page);
  await appModule(page, "/src/entities/profile/index.ts", "__profile");
  await page.evaluate(() => { const m = (window as unknown as P).__profile; m.useProfileUi.getState().setFilters({ proxy: m.onProxy("px-de-1") }); });
  await expect(chips(page)).toHaveText(["Connection: ISP Frankfurt"]);
  await expect(rows(page)).toHaveText([/eBay DE buyer/]);
  await page.evaluate(() => (window as unknown as P).__profile.useProfileUi.getState().setFilters({ proxy: "all", lastRun: "stale" }));
  await expect(chips(page)).toHaveText(["Last run: Not in 30 days"]);
  await expect(rows(page)).toHaveText([/Sandbox/]);
});

test("a chip removed from the keyboard hands focus on, then to Filters", async ({ page }) => {
  await openApp(page);
  await filter(page, "Status", /^Idle/);
  await filter(page, "Last run", /^Last 7 days/);
  const removes = page.locator("[data-filter-chips] [data-chip] button");
  await removes.first().focus();
  await page.keyboard.press("Enter");
  await expect(chips(page)).toHaveText(["Last run: Last 7 days"]);
  await expect(removes.first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(chips(page)).toHaveCount(0);
  await expect(filtersButton(page)).toBeFocused();
});

// F22 (CRAFT-05): Fingerprints and Bookmarks filter the same way. The owner
// (2026-09-30): "looks strange that on fingerprints page we have this tabs
// and on bookmarks we have other design"; Bookmarks keeps the Fingerprints
// tabs (owner rule over plan ruling 22's Filters field).
const fingerprintFilter = async (page: Page, field: string, value: RegExp) => {
  await page.locator("main").getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("option", { name: new RegExp(`^${field}`) }).click();
  await page.getByRole("option", { name: value }).click();
};

test("Fingerprints: the OS is a segment at its own width; Device and GPU vendor are Filters with chips (CRAFT-05)", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  const os = page.getByRole("radiogroup", { name: "Operating system" });
  await expect(os).toBeVisible();
  expect((await os.boundingBox())!.width).toBeLessThan(420);
  await fingerprintFilter(page, "GPU vendor", /^NVIDIA/);
  await expect(chips(page)).toHaveText(["GPU vendor: NVIDIA"]);
  await fingerprintFilter(page, "Device", /^Desktop/);
  await expect(chips(page)).toHaveText(["Device: Desktop", "GPU vendor: NVIDIA"]);
  await expect(page.locator("[data-fingerprint-id]")).toHaveCount(3);
  await chips(page).filter({ hasText: "GPU vendor" }).getByRole("button", { name: /Remove/ }).click();
  await expect(chips(page)).toHaveText(["Device: Desktop"]);
});

test("Bookmarks filter by Folder with the Fingerprints' tabs: the same segment, at its own width (owner, CRAFT-05)", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  const os = page.getByRole("radiogroup", { name: "Operating system" });
  const look = await os.getAttribute("class");
  const osHeight = (await os.boundingBox())!.height;
  await openApp(page, { section: "bookmarks" });
  const folders = page.locator("main").getByRole("radiogroup", { name: "Folder" });
  expect(await folders.getAttribute("class")).toBe(look);
  const box = (await folders.boundingBox())!;
  expect(box.height).toBe(osHeight);
  expect(box.width).toBeLessThan((await page.locator("main").boundingBox())!.width / 2);
  await expect(folders.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("main").getByRole("button", { name: /^Filters/ })).toHaveCount(0);
});

// LAYOUT-13: a Folder for every profile outgrows the row. It scrolls
// sideways inside its row, never the page, and a tab a key scrolls into
// view shows its focus ring whole (owner: rings never cut off).
test("many Folders: the Bookmarks tabs scroll inside their row, and a focused tab's ring shows whole", async ({ page }) => {
  await openApp(page, { section: "bookmarks" });
  type Mock = { __shardxMock: { state: { profiles: Record<string, { _meta: { folder: string } }> }; save: () => void } };
  await page.evaluate(() => {
    const mock = (window as unknown as Mock).__shardxMock;
    Object.values(mock.state.profiles).forEach((p, i) => { p._meta.folder = `Scrapers for the pricing team ${i + 1}`; });
    mock.save();
  });
  await reloadApp(page);
  const folders = page.locator("main").getByRole("radiogroup", { name: "Folder" });
  const row = folders.locator("..");
  await expect.poll(() => row.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await folders.getByRole("radio", { name: "All" }).focus();
  await page.keyboard.press("End");
  const last = folders.getByRole("radio").last();
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-checked", "true");
  const room = await last.evaluate((el) => {
    const s = el.parentElement!.parentElement!;
    const box = s.getBoundingClientRect();
    const left = box.left + s.clientLeft;
    const top = box.top + s.clientTop;
    const b = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    const ring = parseFloat(css.outlineWidth) + parseFloat(css.outlineOffset);
    return {
      shown: css.outlineStyle !== "none",
      left: b.left - ring - left,
      right: left + s.clientWidth - (b.right + ring),
      top: b.top - ring - top,
      bottom: top + s.clientHeight - (b.bottom + ring),
    };
  });
  expect(room.shown).toBe(true);
  for (const side of ["left", "right", "top", "bottom"] as const) expect(room[side], side).toBeGreaterThanOrEqual(0);
});

test("a GPU vendor filter goes when no fingerprint of that vendor is left (PC-083)", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  await fingerprintFilter(page, "GPU vendor", /^AMD/);
  await expect(chips(page)).toHaveText(["GPU vendor: AMD"]);
  await expect(page.locator("[data-fingerprint-id]")).toHaveCount(1);
  await appModule(page, "/src/entities/fingerprint/lib/useFingerprint.tsx", "__fp");
  type W = {
    __shardxMock: { state: { fingerprints: { id: string }[] }; save: () => void };
    __fp: { useFingerprint: { getState: () => { reload: () => Promise<void> } } };
  };
  // Its one AMD fingerprint is removed elsewhere, and the library reloads.
  await page.evaluate(async () => {
    const w = window as unknown as W;
    const list = w.__shardxMock.state.fingerprints;
    list.splice(list.findIndex((f) => f.id === "win10-rx6600"), 1);
    w.__shardxMock.save();
    await w.__fp.useFingerprint.getState().reload();
  });
  await expect(chips(page)).toHaveCount(0);
  await expect(page.locator("[data-fingerprint-id]")).toHaveCount(11);
});

// Pair 28 review M4: the PC-083 shape on Bookmarks. A Folder tab whose
// Folder is renamed in Profiles would leave the list filtered to a name no
// tab shows, with no tab checked.
test("a Bookmarks Folder tab whose Folder is renamed in Profiles goes back to All, and the list with it", async ({ page }) => {
  await openApp(page, { section: "bookmarks" });
  const folders = page.locator("main").getByRole("radiogroup", { name: "Folder" });
  await folders.getByRole("radio", { name: "Shops" }).click();
  await expect(folders.getByRole("radio", { name: "Shops" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("main")).not.toContainText("Meta Business Suite");
  await appModule(page, "/src/entities/profile/lib/useProfile.tsx", "__prof");
  type W = {
    __shardxMock: { state: { profiles: Record<string, { _meta: { folder: string } }> }; save: () => void };
    __prof: { useProfile: { getState: () => { reload: () => Promise<void> } } };
  };
  await page.evaluate(async () => {
    const w = window as unknown as W;
    for (const p of Object.values(w.__shardxMock.state.profiles)) if (p._meta.folder === "Shops") p._meta.folder = "Stores";
    w.__shardxMock.save();
    await w.__prof.useProfile.getState().reload();
  });
  await expect(folders.getByRole("radio", { name: "Shops" })).toHaveCount(0);
  await expect(folders.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("main")).toContainText("Meta Business Suite");
});

// Pair 27, F20: the search finds IDs, hosts and IPs; Tags waits for the first tag.
type MockProxies = { __shardxMock: { state: { proxies: { id: string; host: string }[]; snapshots: Record<string, { ip?: string }[]> } } };

test("search finds profiles by the start of their ID, from 4 characters (IFACE-13)", async ({ page }) => {
  await openApp(page);
  await (await openSearch(page)).fill("c31d9");
  await expect(rows(page)).toHaveCount(2);
  await (await openSearch(page)).fill("c31");
  await expect(rows(page)).toHaveCount(0);
});

test("search finds profiles by their proxy's host (IFACE-13)", async ({ page }) => {
  await openApp(page);
  const host = await page.evaluate(() => (window as unknown as MockProxies).__shardxMock.state.proxies.find((p) => p.id === "px-jp-1")!.host);
  await (await openSearch(page)).fill(host);
  await expect(rows(page)).toHaveText([/FB Ads acc-02/]);
});

test("after Proxies was open, search finds profiles by their proxy's last IP (plan ruling 12)", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const ip = await page.evaluate(() => {
    const snaps = (window as unknown as MockProxies).__shardxMock.state.snapshots["px-jp-1"];
    return snaps[snaps.length - 1].ip!;
  });
  await page.locator("aside [data-nav='profiles']").click();
  await (await openSearch(page)).fill(ip);
  await expect(rows(page)).toHaveText([/FB Ads acc-02/]);
});

test("the Tags column shows only once a tag exists (CRAFT-14)", async ({ page }) => {
  await openApp(page);
  const tagsHeader = page.locator("[role='columnheader']").filter({ hasText: "Tags" });
  await expect(tagsHeader).toHaveCount(0);
  await rows(page).filter({ hasText: "Sandbox" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit tags" }).click();
  await page.getByRole("combobox", { name: "Find or create a tag" }).fill("Farm");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(tagsHeader).toHaveCount(1);
});
