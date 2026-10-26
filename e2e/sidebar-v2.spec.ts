import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";

// F3: the sidebar holds at the user's scale (LAYOUT-01). Tasks 7 and 8 append.
// The folding half came first (owner feedback 5s, was e2e/sidebar-groups.spec.ts).

// 12 Folders and 5 pinned profiles, as the layout audit measured (the seed has 2 and 2).
const scale = (page: Page) =>
  page.addInitScript(() => Object.assign(window, { __shardxMockFolders: 10, __shardxMockPinned: 3 }));
const groupHeading = (page: Page, name: string) => page.locator("aside nav").getByRole("button", { name, exact: true });
const PAGES = ["proxies", "fingerprints", "extensions", "bookmarks", "automation", "trash", "settings"];

test("with 12 Folders and 5 pinned at 1280 x 800 every page link is on screen", async ({ page }) => {
  await scale(page);
  await openApp(page);
  for (const id of PAGES) await expect(page.locator(`aside [data-nav='${id}']`), id).toBeInViewport({ ratio: 1 });
});

test("the Folders list shows 8, then Show 4 more expands it in place", async ({ page }) => {
  await scale(page);
  await openApp(page);
  const folders = page.locator("aside [data-folder]");
  await expect(folders).toHaveCount(8);
  await expect(page.locator("aside [data-show-more]")).toHaveText("Show 4 more");
  await page.locator("aside [data-show-more]").click();
  await expect(folders).toHaveCount(12);
  await page.locator("aside [data-show-less]").click();
  await expect(folders).toHaveCount(8);
});

test("Show more and Show fewer keep the keyboard focus (Pair 5 review)", async ({ page }) => {
  await scale(page);
  await openApp(page);
  const folders = page.locator("aside [data-folder]");
  const more = page.locator("aside [data-show-more]");
  await more.focus();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(folders).toHaveCount(12);
  const fewer = page.locator("aside [data-show-less]");
  await expect(fewer).toBeFocused();
  await expect(fewer).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Enter");
  await expect(folders).toHaveCount(8);
  await expect(more).toBeFocused();
});

test("the Folder open in the list stays listed past the cap", async ({ page }) => {
  await scale(page);
  await openApp(page);
  // Mod+9 opens the ninth Folder in sidebar order (Ads, Folder 01 … Folder 08): the first past the cap.
  await page.keyboard.press("ControlOrMeta+9");
  await expect(page.locator("main header h1")).toHaveText("Folder 08");
  await expect(page.locator("aside [data-folder='Folder 08']")).toHaveAttribute("aria-current", "page");
  // It takes one of the hidden four's places, so three are left to show.
  await expect(page.locator("aside [data-folder]")).toHaveCount(9);
  await expect(page.locator("aside [data-show-more]")).toHaveText("Show 3 more");
});

test("the list fades at the bottom while more is below", async ({ page }) => {
  await scale(page);
  await openApp(page);
  await page.locator("aside [data-show-more]").click();
  const scroll = page.locator("aside [data-sidebar-scroll]");
  await expect(scroll).toHaveAttribute("data-more-below", "true");
  await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); });
  await expect(scroll).not.toHaveAttribute("data-more-below", /.*/);
});

test("groups are named; the one-item groups are gone (CRAFT-16, A11Y-19)", async ({ page }) => {
  await openApp(page);
  const names = await page.locator("aside [role='group']").evaluateAll((els) =>
    els.map((el) => document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent?.trim()));
  expect(names).toEqual(["Pinned", "Folders", "Views"]);
  await expect(page.locator("aside [data-sidebar-fixed] [data-nav='profiles']")).toBeVisible();
  await expect(page.locator("aside [data-sidebar-fixed] [data-nav='automation']")).toBeVisible();
});

// ---- Folding (owner feedback 5s) --------------------------------------------

const seedCollapsed = (page: Page, rail = false) => page.addInitScript((rail) => {
  localStorage.setItem("shardx.sidebar", JSON.stringify({
    v: 1,
    collapsed: { pinned: true, folders: true, views: true },
    foldersOpen: false,
    rail,
  }));
}, rail);

test.describe("a group collapses from its heading, and stays collapsed after a reload", () => {
  for (const [name, item] of [["Pinned", "data-pinned"], ["Folders", "data-folder"], ["Views", "data-view"]] as const) {
    test(name, async ({ page }) => {
      await openApp(page);
      const h = groupHeading(page, name);
      await expect(h).toHaveAttribute("aria-expanded", "true");
      await h.click();
      await expect(h).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(`aside [${item}]`)).toHaveCount(0);
      // All profiles is a fixed destination: folding never hides it.
      await expect(page.locator("aside [data-nav='profiles']")).toBeVisible();
      await page.reload();
      await expect(groupHeading(page, name)).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(`aside [${item}]`)).toHaveCount(0);
      await groupHeading(page, name).click();
      await expect(page.locator(`aside [${item}]`).first()).toBeVisible();
    });
  }
});

test("the heading's aria-controls names the list element while open", async ({ page }) => {
  await openApp(page);
  const controlsId = await groupHeading(page, "Folders").getAttribute("aria-controls");
  expect(controlsId).toBeTruthy();
  await expect(page.locator(`#${controlsId}`)).toBeVisible();
  await expect(page.locator(`#${controlsId} [data-folder]`).first()).toBeVisible();
});

test("no button is nested in another button inside the sidebar", async ({ page }) => {
  await openApp(page);
  expect(await page.locator("aside button button").count()).toBe(0);
});

test("compact rail: no fold headings, named groups, and every item shows even with a collapsed saved state", async ({ page }) => {
  await seedCollapsed(page, true);
  await openApp(page);
  await expect(page.locator("aside [aria-expanded]")).toHaveCount(0);
  await expect(page.locator("aside [data-folder]").first()).toBeVisible();
  await expect(page.locator("aside [data-pinned]").first()).toBeVisible();
  await expect(page.locator("aside [data-view]").first()).toBeVisible();
  await expect(page.locator("aside").getByRole("group", { name: "Folders" })).toHaveCount(1);
});

test("a broken shardx.sidebar value loads with every group open", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.sidebar", "{"));
  await openApp(page);
  for (const name of ["Pinned", "Folders", "Views"]) await expect(groupHeading(page, name)).toHaveAttribute("aria-expanded", "true");
});

// Fix round 1 (M8): a keyboard toggle, not just a click, and focus stays on
// the heading (never lost, never moved into the now-hidden list) so the next
// Enter or Space folds it right back.
test("a heading folds and unfolds from the keyboard, and keeps focus", async ({ page }) => {
  await openApp(page);
  const h = groupHeading(page, "Views");
  await h.focus();
  await expect(h).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(h).toHaveAttribute("aria-expanded", "false");
  await expect(h).toBeFocused();
  await page.keyboard.press("Space");
  await expect(h).toHaveAttribute("aria-expanded", "true");
  await expect(h).toBeFocused();
});

// ---- Counts and Pinned (Task 7a) --------------------------------------------

const pinnedItem = (page: Page, id: string) => page.locator(`aside [data-pinned='${id}']`);
const mockRunning = (page: Page) =>
  page.evaluate(() => Object.keys((window as unknown as { __shardxMock: { state: { running: Record<string, unknown> } } }).__shardxMock.state.running));

const mockInvoke = (page: Page, cmd: string, args: unknown) =>
  page.evaluate(([cmd, args]) =>
    (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } })
      .__TAURI_INTERNALS__.invoke(cmd as string, args), [cmd, args] as const);

test("All profiles shows its total, which reads running/total only while something runs, and explains it on hover (CRAFT-17, owner)", async ({ page }) => {
  await openApp(page);
  const all = page.locator("aside [data-nav='profiles']");
  // One count, "2/8", in words for a screen reader.
  await expect(all.locator("[data-running-of]")).toHaveText("2/8");
  await expect(all.locator("[data-total]")).toHaveText("8");
  await expect(all).toHaveAccessibleName("All profiles 8 profiles, 2 running");
  // Resting the pointer on the count explains it in the same words.
  await all.locator("[data-running-of]").hover();
  await expect(page.getByRole("tooltip")).toHaveText("8 profiles, 2 running");
  await expect(page.locator("aside [data-group='folders'] [data-running]")).toHaveCount(0);
  await mockInvoke(page, "sync_stop", { group: "" });
  await expect(all.locator("[data-running-of]")).toHaveCount(0);
  await expect(all).toHaveAccessibleName("All profiles 8 profiles");
  await all.locator("[data-total]").hover();
  await expect(page.getByRole("tooltip")).toHaveText("8 profiles");
  // Started outside the UI (as the HTTP API would): the poll sees it.
  await mockInvoke(page, "launch", { profileId: "aed41005" });
  await expect(all.locator("[data-running-of]")).toHaveText("1/8");
  await expect(all.locator("[data-running-of]")).toBeVisible();
  await expect(all).toHaveAccessibleName("All profiles 8 profiles, 1 running");
  await mockInvoke(page, "process_kill", { profileId: "aed41005" });
  await expect(all.locator("[data-running-of]")).toHaveCount(0);
  await expect(all.locator("[data-running]")).toHaveCount(0);
  await expect(all.locator("[data-total]")).toHaveText("8");
});

// Live layer (Task 7): the counts roll (CountRoll), each number on its own.
test("every sidebar count is a CountRoll, and starting a profile rolls All profiles from 2/8 to 3/8 (Live, spec 6.2)", async ({ page }) => {
  // The suite runs under Reduce motion, where a count swaps at once: here it rolls.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openApp(page);
  const all = page.locator("aside [data-nav='profiles']");
  const running = all.locator("[data-running] > [data-count-roll]");
  await expect(all.locator("[data-running-of]")).toHaveText("2/8");
  await expect(running).toHaveCount(1);
  await expect(all.locator("[data-total] > [data-count-roll]")).toHaveCount(1);
  // The Folders' and the Views' counts too.
  const counts = await page.locator("aside [data-count]").count();
  expect(counts).toBeGreaterThan(0);
  await expect(page.locator("aside [data-count] > [data-count-roll]")).toHaveCount(counts);
  // Every roll the running count starts, counted on its moving track.
  await running.evaluate((el) => {
    const w = window as unknown as { __rolls: number };
    w.__rolls = 0;
    const track = el.firstElementChild as HTMLElement;
    const animate = track.animate.bind(track);
    track.animate = (...args: Parameters<HTMLElement["animate"]>) => { w.__rolls++; return animate(...args); };
  });
  await mockInvoke(page, "launch", { profileId: "aed41005" });
  // Mid-roll the old number is still on the tape; it ends on the new one alone.
  await expect(all.locator("[data-running-of]")).toHaveText("3/8");
  expect(await page.evaluate(() => (window as unknown as { __rolls: number }).__rolls)).toBeGreaterThanOrEqual(1);
  await expect(all).toHaveAccessibleName("All profiles 8 profiles, 3 running");
});

test("the / and the total hold still when the running count gains a digit (owner)", async ({ page }) => {
  // 12 profiles, 2 of them running ("2/12"); then all of them ("12/12").
  await page.addInitScript(() => Object.assign(window, { __shardxMockProfiles: 4 }));
  await openApp(page);
  const count = page.locator("aside [data-nav='profiles'] [data-running-of]");
  await expect(count).toHaveText("2/12");
  const place = () => count.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { left: box.left, width: box.width, total: el.querySelector("[data-total]")!.getBoundingClientRect().left };
  });
  const before = await place();
  const ids = await page.locator("[role='row'][data-profile-id]").evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.profileId!));
  expect(ids).toHaveLength(12);
  await mockInvoke(page, "sync_launch", { profileIds: ids, group: "" });
  await expect(count).toHaveText("12/12");
  expect(await place()).toEqual(before);
});

test("clicking a pinned profile shows it in the list and Peek, without starting it (6.2)", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const before = await mockRunning(page);
  await pinnedItem(page, "c31d92f0").click();
  await expect(page.locator("aside[data-peek]")).toHaveAttribute("aria-label", /FB Ads acc-01/);
  await expect(page.locator("[role='row'][data-active]")).toContainText("FB Ads acc-01");
  expect(await mockRunning(page)).toEqual(before);
});

test("the stop button on a running pinned profile stops it", async ({ page }) => {
  await openApp(page);
  await pinnedItem(page, "a78a0eea").hover();
  await pinnedItem(page, "a78a0eea").locator("[data-pinned-action]").getByRole("button", { name: "Stop Amazon US seller" }).click();
  await expect.poll(() => mockRunning(page)).not.toContain("a78a0eea");
});

test("a pinned item's name starts with the profile's name; its icon stays out of it (PC-046)", async ({ page }) => {
  await openApp(page);
  await expect(pinnedItem(page, "c31d92f0").locator("button").first()).toHaveAccessibleName(/^FB Ads acc-01/);
});

test("after Unpin the keyboard stays in the sidebar (PC-046)", async ({ page }) => {
  await openApp(page);
  await pinnedItem(page, "c31d92f0").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Unpin" }).click();
  await expect(pinnedItem(page, "c31d92f0")).toHaveCount(0);
  await expect(page.locator("aside nav :focus")).toHaveCount(1);
});

test("a View applied, then hidden from the sidebar, stays listed until the list leaves it (PC-099)", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/entities/profile/lib/views.ts", "__views");
  const id = await page.evaluate(() => {
    type Views = { useViews: { getState: () => { save: (n: string, q: unknown, pinned: boolean) => { id: string } | null } }; BUILTIN_VIEWS: { query: unknown }[] };
    const v = (window as unknown as { __views: Views }).__views;
    return v.useViews.getState().save("Mine", v.BUILTIN_VIEWS[1].query, true)!.id;
  });
  const view = page.locator(`aside [data-view='${id}']`);
  await view.click();
  await view.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Hide from sidebar" }).click();
  await expect(view).toHaveAttribute("aria-current", "page");
  // Listed only because it is applied: its menu offers the way back.
  await view.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Show in sidebar" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("aside [data-nav='profiles']").click();
  await expect(view).toHaveCount(0);
});

// ---- The rail is a choice (Task 8a) -----------------------------------------

const aside = (page: Page) => page.locator("aside").first();
// The full sidebar panel is 232: its 240 less the 8 px of ground beside it (borderless, owner 2026-10-01).
const asideWidth = async (page: Page) => (await aside(page).boundingBox())!.width;

test("Mod+\\ folds the sidebar to the rail and back, and it stays after a reload (6.2)", async ({ page }) => {
  await openApp(page);
  expect(await asideWidth(page)).toBe(232);
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect.poll(() => asideWidth(page)).toBe(56);
  await page.reload();
  await expect.poll(() => asideWidth(page)).toBe(56);
  await aside(page).getByRole("button", { name: "Expand sidebar" }).click();
  await expect.poll(() => asideWidth(page)).toBe(232);
  await aside(page).getByRole("button", { name: "Collapse sidebar" }).click();
  await expect.poll(() => asideWidth(page)).toBe(56);
});

test("below 1280 px the sidebar stays whole until Peek opens (LAYOUT-10)", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await openApp(page);
  expect(await asideWidth(page)).toBe(232);
  await page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek]")).toBeVisible();
  await expect.poll(() => asideWidth(page)).toBe(56);
  await page.keyboard.press("Escape");
  await expect(page.locator("aside[data-peek]")).toHaveCount(0);
  await expect.poll(() => asideWidth(page)).toBe(232);
});

test("the rail Peek folded opens again from its button, until that Peek closes", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await openApp(page);
  const openPeek = () => page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='name']").click();
  await openPeek();
  await expect.poll(() => asideWidth(page)).toBe(56);
  await aside(page).getByRole("button", { name: "Expand sidebar" }).click();
  await expect.poll(() => asideWidth(page)).toBe(232);
  await expect(page.locator("aside[data-peek]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("aside[data-peek]")).toHaveCount(0);
  // Not a saved choice: the next Peek folds the sidebar again.
  await openPeek();
  await expect.poll(() => asideWidth(page)).toBe(56);
});

test("in the rail every Folder has its own color; the full sidebar keeps an uncolored Folder neutral (LAYOUT-10)", async ({ page }) => {
  await openApp(page);
  const icons = page.locator("aside [data-folder] [data-folder-icon]");
  const labels = () => icons.evaluateAll((els) => els.map((el) => (el as HTMLElement).style.getPropertyValue("--label")));
  // The seed's Ads and Shops have no color of their own.
  expect(await labels()).toEqual(["", ""]);
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect.poll(async () => (await labels()).every((c) => c !== "")).toBe(true);
  const colors = await icons.evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
  expect(new Set(colors).size).toBe(colors.length);
});

test("in the rail pinned profiles show their two letters, and the tooltip says which runs", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect(pinnedItem(page, "a78a0eea").locator("[data-initials]")).toHaveText("AU");
  await expect(pinnedItem(page, "c31d92f0").locator("[data-initials]")).toHaveText("FA");
  // Plain letters: no tile, border, ring or fill.
  const look = await pinnedItem(page, "c31d92f0").locator("[data-initials]").evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, border: s.borderTopWidth, shadow: s.boxShadow };
  });
  expect(look).toEqual({ bg: "rgba(0, 0, 0, 0)", border: "0px", shadow: "none" });
  const running = pinnedItem(page, "a78a0eea").locator("button").first();
  await expect(running).toHaveAccessibleName("Amazon US seller, running");
  await running.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Amazon US seller, running");
});

test("with traffic lights the panels start below a 38 px strip and the rail stays 56 px (LAYOUT-09)", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { isTauri: boolean }).isTauri = true; });
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect.poll(() => asideWidth(page)).toBe(56);
  // The lights sit in the strip above the panel, so the panel starts at y 38
  // and the fold button needs no clearance of its own.
  expect((await aside(page).boundingBox())!.y).toBe(38);
  const toggle = (await aside(page).getByRole("button", { name: "Expand sidebar" }).boundingBox())!;
  expect(toggle.y).toBeGreaterThanOrEqual(38);
});

// F8b: the rail's keys through the kit's `shortcut`, and "Toggle sidebar" in the registry.
test("the rail's Search tooltip shows its key (PC-109)", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect.poll(() => asideWidth(page)).toBe(56);
  await page.locator("aside [data-nav='search']").hover();
  await expect(page.getByRole("tooltip")).toContainText("Search");
  await expect(page.getByRole("tooltip")).toContainText(/K$/);
});

test("the fold button's tooltip shows Mod+\\", async ({ page }) => {
  await openApp(page);
  await aside(page).getByRole("button", { name: "Collapse sidebar" }).hover();
  await expect(page.getByRole("tooltip")).toContainText("Collapse sidebar");
  await expect(page.getByRole("tooltip")).toContainText("\\");
});

test("Toggle sidebar is a command with the rail's key; running it folds and unfolds what is drawn", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/shared/commands/index.ts", "__core");
  type Core = { __core: { command: (id: string) => { label: (n: number) => string; keys?: string[]; run: (s: { ids: string[] }, ctx: { from: string }) => void } } };
  const info = await page.evaluate(() => {
    const c = (window as unknown as Core).__core.command("app.toggleSidebar");
    return { label: c.label(1), keys: c.keys };
  });
  expect(info).toEqual({ label: "Toggle sidebar", keys: ["Mod+\\"] });
  const run = () => page.evaluate(() => (window as unknown as Core).__core.command("app.toggleSidebar").run({ ids: [] }, { from: "palette" }));
  await run();
  await expect.poll(() => asideWidth(page)).toBe(56);
  await run();
  await expect.poll(() => asideWidth(page)).toBe(232);
});

test("Folder and View counts are spoken with a word (A11Y-09)", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("aside [data-folder='Ads']")).toHaveAccessibleName(/Ads.*\d+ profiles?/);
  await expect(page.locator("aside [data-view='builtin:running']")).toHaveAccessibleName(/Running.*\d+ profiles?/);
});
