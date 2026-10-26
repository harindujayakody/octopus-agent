import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const pick = (page: Page, name: string) => row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
const bar = (page: Page) => page.getByRole("toolbar", { name: /selected/ });
const fail = (page: Page, cmds: Record<string, number>) => page.addInitScript((c) => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = c; }, cmds);

test("selecting shows a bar at the bottom with the count", async ({ page }) => {
  await openApp(page);
  await pick(page, "Etsy craft shop");
  await pick(page, "Sandbox");
  await expect(bar(page)).toContainText("2 selected");
  const box = (await bar(page).boundingBox())!;
  expect(box.y).toBeGreaterThan(600);
});

test("Move to folder moves every selected profile, and keeps the selection", async ({ page }) => {
  await openApp(page);
  await pick(page, "Etsy craft shop");
  await pick(page, "Sandbox");
  await bar(page).getByRole("button", { name: /Move to folder/ }).click();
  await page.getByRole("dialog", { name: "Move to folder" }).getByRole("option", { name: /^Ads/ }).click();
  await expect(page.locator("aside [data-folder='Ads'] [data-count]")).toHaveText("5");
  // Owner fix 1 (2026-09-28): a bulk action never clears the selection on its own.
  await expect(bar(page)).toContainText("2 selected");
});

test("Stop keeps the selection, then Move to Trash needs no reselecting (owner fix 1)", async ({ page }) => {
  await openApp(page);
  // eBay DE buyer runs (the mock's fixtures): Stop has one to stop.
  await pick(page, "eBay DE buyer");
  await pick(page, "Sandbox");
  await pick(page, "Scraper pricing");
  await expect(bar(page)).toContainText("3 selected");
  await bar(page).getByRole("button", { name: "Stop" }).click();
  // Wait for the run to finish, not just start, before checking the
  // selection — otherwise this would pass even against code that narrows
  // once the run ends. Start is held while Stop runs, and with all three
  // idle again it comes back.
  await expect(bar(page).getByRole("button", { name: "Start" })).toBeEnabled({ timeout: 6000 });
  await expect(bar(page)).toContainText("3 selected");
  await bar(page).getByRole("button", { name: /Move to Trash/ }).click();
  await expect(bar(page)).toHaveCount(0);
  for (const name of ["eBay DE buyer", "Sandbox", "Scraper pricing"]) {
    await expect(row(page, name)).toHaveCount(0);
  }
});

test("Start with every selected profile running, and Stop with none, say why they do nothing (Pair 39 carry)", async ({ page }) => {
  await openApp(page);
  // Amazon US seller and eBay DE buyer run (the mock's fixtures).
  await pick(page, "Amazon US seller");
  await pick(page, "eBay DE buyer");
  const start = bar(page).getByRole("button", { name: "Start" });
  await expect(start).toBeDisabled();
  await expect(bar(page).getByRole("button", { name: "Stop" })).toBeEnabled();
  await start.hover();
  await expect(page.getByRole("tooltip")).toContainText("Already running");
  // One idle profile in the selection: Start has something to start again.
  await pick(page, "Sandbox");
  await expect(start).toBeEnabled();
  await bar(page).getByRole("button", { name: "Clear selection" }).click();
  await pick(page, "Sandbox");
  const stop = bar(page).getByRole("button", { name: "Stop" });
  await expect(stop).toBeDisabled();
  await stop.hover();
  await expect(page.getByRole("tooltip")).toContainText("Not running");
  // The bar draws again when a selected profile starts.
  await start.click();
  await expect(stop).toBeEnabled({ timeout: 6000 });
  await expect(start).toBeDisabled();
});

test("a partly failed Move to Trash keeps the failed profile selected (owner fix 1, fix round 1)", async ({ page }) => {
  // Only the first `profile_delete` call fails: the ids are pressed in
  // selection order, so Etsy craft shop (picked first) is the one that fails.
  await fail(page, { profile_delete: 1 });
  await openApp(page);
  await pick(page, "Etsy craft shop");
  await pick(page, "Sandbox");
  await pick(page, "Scraper pricing");
  await bar(page).getByRole("button", { name: /Move to Trash/ }).click();
  await expect(bar(page)).toContainText("1 selected");
  await expect(row(page, "Etsy craft shop")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "Sandbox")).toHaveCount(0);
  await expect(row(page, "Scraper pricing")).toHaveCount(0);
});

test("Assign proxies binds the selection to one proxy, with sharing on", async ({ page }) => {
  await openApp(page);
  await pick(page, "Sandbox");
  await pick(page, "Scraper pricing");
  await bar(page).getByRole("button", { name: /Assign proxies/ }).click();
  const dialog = page.getByRole("dialog", { name: /Assign proxies/ });
  // Two profiles on one proxy is sharing (F12), and DC Tokyo is in use elsewhere.
  await dialog.getByRole("checkbox", { name: "Unused only" }).uncheck();
  await dialog.getByRole("option", { name: /^DC Tokyo/ }).click();
  await dialog.getByRole("checkbox", { name: "Allow sharing" }).check();
  await dialog.getByRole("button", { name: "Assign 2" }).click();
  for (const name of ["Sandbox", "Scraper pricing"]) {
    await expect(row(page, name).locator("[data-cell='proxy']")).toContainText("DC Tokyo");
  }
});

test("Regenerate fingerprint asks first, then gives each idle profile a new device", async ({ page }) => {
  await openApp(page);
  const before = await page.evaluate(() => (window as unknown as { __shardxMock: { state: { profiles: Record<string, { _meta: { gpu_preset_id: string } }> } } }).__shardxMock.state.profiles["f62a9d43"]._meta.gpu_preset_id);
  await pick(page, "Sandbox");
  await bar(page).getByRole("button", { name: "More bulk actions" }).click();
  await page.getByRole("menuitem", { name: "Regenerate fingerprint" }).click();
  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shardxMock: { state: { profiles: Record<string, { _meta: { gpu_preset_id: string } }> } } }).__shardxMock.state.profiles["f62a9d43"]._meta.gpu_preset_id)).not.toBe(before);
});

test("bulk actions act on selected rows that are scrolled out of view", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockProfiles: number }).__shardxMockProfiles = 300; });
  await openApp(page);
  await pick(page, "Sandbox");
  await page.getByRole("treegrid").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await pick(page, "Profile 0300");
  await bar(page).getByRole("button", { name: /Move to folder/ }).click();
  await page.getByRole("dialog", { name: "Move to folder" }).getByRole("option", { name: /^Shops/ }).click();
  await expect(page.locator("aside [data-folder='Shops'] [data-count]")).toHaveText("5");
});

test("bulk Start reports once: progress, then how many started, and which failed stay one click away", async ({ page }) => {
  await openApp(page);
  const rows = page.locator("[role='row'][data-profile-id]").filter({ hasNot: page.getByRole("button", { name: "Stop" }) });
  for (const i of [0, 1, 2]) await rows.nth(i).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.evaluate(() => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = { launch: 1 }; });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "Start" }).click();
  const result = page.locator("[data-toast]").filter({ hasText: "Started 2 of 3 profiles. 1 failed" });
  await expect(result).toBeVisible({ timeout: 10000 });
  await expect(page.locator("[data-toast]")).toHaveCount(1);
  await expect(result).toContainText("Mock failure: launch");
  await result.getByRole("button", { name: "Select failed" }).click();
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(1);
});

test("a failed Start names the profile and closes after 8 s", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = { launch: 1 }; });
  const r = page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" });
  await r.hover();
  await r.getByRole("button", { name: "Start" }).click();
  const toast = page.locator("[data-toast]").filter({ hasText: "Couldn’t start “Sandbox”" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Mock failure: launch");
  await page.clock.runFor(6000);
  await expect(toast).toBeVisible();
  await page.clock.runFor(3000);
  await expect(toast).toHaveCount(0);
});

// E4: the bars and the header … menus list the registry's commands.
test("the bulk bar is the registry's: same words and keys as the row menu", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/features/commands/index.ts", "__cmds");
  await pick(page, "Etsy craft shop");
  await pick(page, "FB Ads acc-02");
  const want = await page.evaluate(() => (window as unknown as { __cmds: { describe: (s: string, a: string, i: string[]) => { id: string; label: string; aria: string | null }[] } }).__cmds.describe("bulkBar", "profiles", ["aed41005", "c31d92f1"]));
  for (const w of want) {
    const b = bar(page).locator(`[data-command='${w.id}']`);
    await expect(b).toHaveAccessibleName(w.label);
    if (w.aria) await expect(b).toHaveAttribute("aria-keyshortcuts", w.aria);
  }
  await expect(bar(page).getByRole("button", { name: "Edit tags" })).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Assign proxies" })).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Clear selection" })).toHaveAttribute("aria-keyshortcuts", "Escape");
});

test("Launch synced says why it cannot run, in the bar's More menu", async ({ page }) => {
  await openApp(page);
  await pick(page, "TikTok creator"); // mobile
  await pick(page, "Sandbox"); // desktop
  await bar(page).getByRole("button", { name: "More bulk actions" }).click();
  const item = page.getByRole("menuitem", { name: /^Start in sync/ });
  await expect(item).toHaveAttribute("aria-disabled", "true");
  await expect(item).toHaveAccessibleDescription(/Mixed selection/);
});

test("the header … menus list the page's commands", async ({ page }) => {
  await openApp(page);
  await page.locator("main header").getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: /^Import profiles from clipboard/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await openApp(page, { section: "proxies" });
  await page.locator("main header").getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: /^Import proxies from clipboard/ })).toBeVisible();
});

test("the bar's Edit tags opens its picker and closes it again", async ({ page }) => {
  await openApp(page);
  await pick(page, "Etsy craft shop");
  await pick(page, "Sandbox");
  const tags = bar(page).getByRole("button", { name: "Edit tags" });
  await tags.click();
  await expect(page.getByRole("dialog", { name: "Tags" })).toBeVisible();
  await expect(tags).toHaveAttribute("aria-expanded", "true");
  await tags.click();
  await expect(page.getByRole("dialog", { name: "Tags" })).toHaveCount(0);
  await expect(bar(page)).toContainText("2 selected");
});
