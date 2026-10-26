import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { openSearch } from "./support/search";

// Edge cases of the Profiles list's keyboard, inline edit, start/stop and bulk
// actions, from the 2B review.

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const byId = (page: Page, id: string) => page.locator(`[role='row'][data-profile-id='${id}']`);
const bar = (page: Page) => page.getByRole("toolbar", { name: /selected/ });
const filter = (page: Page) => page.getByRole("searchbox", { name: "Search…" });
type MockState = { running: Record<string, unknown>; profiles: Record<string, { _meta: { gpu_preset_id: string; folder: string } }> };
const mock = (page: Page) => page.evaluate(() => (window as unknown as { __shardxMock: { state: MockState } }).__shardxMock.state);

test("leaving a rename for the filter keeps the keyboard in the filter", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  await page.keyboard.press("e");
  await expect(byId(page, "f62a9d43").getByRole("textbox", { name: "Name" })).toBeFocused();
  await openSearch(page);
  await page.waitForTimeout(100);
  await page.keyboard.type("s");
  await expect(filter(page)).toBeFocused();
  await expect(filter(page)).toHaveValue("s");
  expect(Object.keys((await mock(page)).running)).not.toContain("f62a9d43");
});

test("Esc in the filter leaves an open Peek alone", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek]")).toBeVisible();
  await openSearch(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("aside[data-peek]")).toBeVisible();
});

test("an Esc that ends an input-method composition cancels nothing", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  await page.keyboard.press("e");
  const input = byId(page, "f62a9d43").getByRole("textbox", { name: "Name" });
  await expect(input).toBeFocused();
  await input.evaluate((el) => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }));
  });
  await expect(input).toBeVisible();
});

test("keys and the bar act only on profiles the list shows", async ({ page }) => {
  await openApp(page);
  // Etsy (in Shops) is active and selected; then the Ads Folder is opened.
  await row(page, "Etsy craft shop").locator("[data-cell='status']").click();
  await row(page, "Etsy craft shop").locator("[data-cell='checkbox'] input").check({ force: true });
  await page.locator("aside [data-folder='Ads']").click();
  await expect(bar(page)).toHaveCount(0);
  await page.locator("main").click({ position: { x: 400, y: 600 } });
  await page.keyboard.press("s");
  await page.waitForTimeout(300);
  expect(Object.keys((await mock(page)).running)).not.toContain("aed41005");
});

test("moving the active row to the Trash puts the keyboard on the next row", async ({ page }) => {
  await openApp(page);
  await row(page, "eBay DE buyer").locator("[data-cell='status']").click();
  await page.keyboard.press("Delete");
  await expect(row(page, "eBay DE buyer")).toHaveCount(0);
  const active = page.locator("[role='row'][data-active]");
  await expect(active).toContainText("Etsy craft shop");
  await expect(active).toBeFocused();
});

test("a selection that lost a profile still acts on all the others", async ({ page }) => {
  await openApp(page);
  for (const n of ["Etsy craft shop", "Sandbox", "Scraper pricing"]) {
    await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
  }
  // Sandbox goes to the Trash from its own Peek, which acts on it alone (the
  // row menu acts on the selection the row is part of, E3).
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  await page.locator("aside[data-peek] [data-peek-header]").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Move to Trash/ }).click();
  await expect(bar(page)).toContainText("2 selected");
  await bar(page).getByRole("button", { name: /Move to folder/ }).click();
  await page.getByRole("dialog", { name: "Move to folder" }).getByRole("option", { name: /^Ads/ }).click();
  await expect.poll(async () => {
    const s = await mock(page);
    return [s.profiles["aed41005"]._meta.folder, s.profiles["e51f8c32"]._meta.folder];
  }).toEqual(["Ads", "Ads"]);
});

test("stopping a profile brings its Status up to date", async ({ page }) => {
  await openApp(page);
  const sandbox = row(page, "Sandbox");
  await expect(sandbox.locator("[data-cell='status']")).toHaveText("Never run");
  await sandbox.hover();
  await sandbox.getByRole("button", { name: "Start" }).click();
  // Wait for the launch to return (Stop becomes clickable), then stop.
  await expect(sandbox.getByRole("button", { name: "Stop" })).toBeEnabled({ timeout: 5000 });
  await sandbox.getByRole("button", { name: "Stop" }).click();
  await expect(sandbox.locator("[data-cell='status'] [data-status-label]")).toHaveText("Just now", { timeout: 6000 });
});

test("regenerate never picks a fingerprint this machine cannot back", async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page);
  // FB Ads acc-02 is an idle Windows profile; the mock marks the Intel Arc
  // A770 Windows fingerprint incompatible with this machine.
  await byId(page, "c31d92f1").locator("[data-cell='checkbox'] input").check({ force: true });
  for (let i = 0; i < 8; i++) {
    const before = (await mock(page)).profiles["c31d92f1"]._meta.gpu_preset_id;
    await bar(page).getByRole("button", { name: "More bulk actions" }).click();
    await page.getByRole("menuitem", { name: "Regenerate fingerprint" }).click();
    await page.getByRole("button", { name: "Regenerate" }).click();
    await expect.poll(async () => (await mock(page)).profiles["c31d92f1"]._meta.gpu_preset_id).not.toBe(before);
    expect((await mock(page)).profiles["c31d92f1"]._meta.gpu_preset_id).not.toBe("win11-arc-a770");
  }
  // Owner fix 1 (2026-09-28): regenerate doesn't clear the selection.
  await expect(bar(page)).toContainText("1 selected");
});

test("row controls leave Tab to the active row, and the bulk bar comes before the list", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").locator("[data-cell='checkbox'] input").check({ force: true });
  await expect(row(page, "Sandbox").locator("[data-cell='checkbox'] input")).toHaveAttribute("tabindex", "-1");
  await expect(row(page, "Sandbox").getByRole("button", { name: "More actions" })).toHaveAttribute("tabindex", "-1");
  await openSearch(page);
  let inBar = false;
  // The action cards' buttons sit between the filter and the list (Live
  // Task 8); the bar still comes before any row.
  for (let i = 0; i < 20 && !inBar; i++) {
    await page.keyboard.press("Tab");
    inBar = await bar(page).evaluate((el) => el.contains(document.activeElement));
  }
  expect(inBar).toBe(true);
});

test("Assign proxies needs a choice before it assigns", async ({ page }) => {
  await openApp(page);
  await row(page, "Scraper pricing").locator("[data-cell='checkbox'] input").check({ force: true });
  await bar(page).getByRole("button", { name: /Change proxy/ }).click();
  const dialog = page.getByRole("dialog", { name: /Assign/ });
  await expect(dialog.getByRole("button", { name: /^Assign \d+$/ })).toBeDisabled();
});
