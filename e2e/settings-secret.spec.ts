import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// SEC-01: after Regenerate token, a later save must not write the old signing
// key back. The mock stores the key as the backend does: an incoming key
// wins, a missing one keeps what is on disk.
type Mock = { __shardxMock: { state: { settings: { api_secret: string } } }; __shardxMockSettingsSaves?: Record<string, unknown>[] };
const secret = (page: Page) => page.evaluate(() => (window as unknown as Mock).__shardxMock.state.settings.api_secret);
const lastSave = (page: Page) => page.evaluate(() => (window as unknown as Mock).__shardxMockSettingsSaves?.at(-1) ?? null);
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name });

test("a save after Regenerate token keeps the new signing key", async ({ page }) => {
  await openApp(page, { section: "settings" });
  const original = await secret(page);
  await tab(page, "API & MCP").click();
  await page.getByRole("button", { name: "Regenerate token" }).click();
  // The new UI asks first (WRITE-23).
  await page.getByRole("alertdialog").getByRole("button", { name: "Regenerate token" }).click();
  await expect.poll(() => secret(page)).not.toBe(original);
  const regenerated = await secret(page);
  await tab(page, "General").click();
  // Settings save on Save (manual save): a flipped switch and Save is the next save.
  await page.getByRole("switch", { name: /tray/i }).click();
  await page.locator("[data-save-bar]").getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => lastSave(page)).not.toBeNull();
  expect(await secret(page)).toBe(regenerated);
});

test("the settings form never sends the signing key", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("switch", { name: /tray/i }).click();
  await page.locator("[data-save-bar]").getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => lastSave(page)).not.toBeNull();
  expect(Object.keys((await lastSave(page)) ?? {})).not.toContain("api_secret");
});

type Api = { __shardxMock: { state: { api: { token: string } } }; __shardxMockClipboard?: string };
const token = (page: Page) => page.evaluate(() => (window as unknown as Api).__shardxMock.state.api.token);
const clipboard = (page: Page) => page.evaluate(() => (window as unknown as Api).__shardxMockClipboard ?? "");

test("WRITE-23: Regenerate token asks first and says what breaks", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "API & MCP").click();
  const before = await token(page);
  await page.getByRole("button", { name: "Regenerate token" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Regenerate the API token?" });
  await expect(dialog).toContainText("Scripts and MCP clients that use the current token stop working");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  // The dialog stays mounted through its exit (C1): let it leave first.
  await expect(dialog).toHaveCount(0);
  expect(await token(page)).toBe(before);
  await page.getByRole("button", { name: "Regenerate token" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Regenerate token" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "New token ready." })).toBeVisible();
  expect(await token(page)).not.toBe(before);
});

test("SEC-11: a copied token leaves the clipboard after a minute", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "API & MCP").click();
  const value = await token(page);
  // The second Copy button is the token's (the first is the base URL's).
  await page.getByRole("button", { name: "Copy" }).nth(1).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "It clears from the clipboard in 1 minute." })).toBeVisible();
  expect(await clipboard(page)).toBe(value);
  await page.clock.fastForward("01:01");
  await expect.poll(() => clipboard(page)).toBe("");
});

test("SEC-11: something copied since stays on the clipboard", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "API & MCP").click();
  await page.getByRole("button", { name: "Copy" }).nth(1).click();
  await page.evaluate(() => { (window as unknown as Api).__shardxMockClipboard = "my own text"; });
  await page.clock.fastForward("01:01");
  await page.waitForTimeout(500);
  expect(await clipboard(page)).toBe("my own text");
});
