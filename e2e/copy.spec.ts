import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";
import { openSearch } from "./support/search";

// Audit Phase G: one word per concept (CONTEXT.md, "Words in the interface"),
// checked where people read it. Tasks 3, 6, 12 and 13 add to this file.
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const proxyRow = (page: Page, name: string) => page.locator("[role='row'][data-proxy-id]", { hasText: name });

test("assigning proxies is one verb from the button to the toast", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await proxyRow(page, "DC Tokyo").locator("[data-cell='checkbox'] input").check({ force: true });
  await proxyRow(page, "DC New York").locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("button", { name: "Assign to profiles" }).click();
  // Pair 47's one Assign dialog names its proxies ("Assign 2 proxies").
  const dialog = page.getByRole("dialog", { name: /^Assign 2 proxies/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Assign \d+$|^Nothing to assign$/ })).toBeVisible();
  await expect(dialog).not.toContainText(/\b(?:[Bb]ind|[Dd]istribut)/);
});

test("Peek is named as Peek", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek]")).toHaveAttribute("aria-label", "Peek: Etsy craft shop");
});

test("a fingerprint is never called a template", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek]")).not.toContainText(/template/i);
});

test("the local HTTP API is the Local API", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name: "API & MCP" }).click();
  await expect(page.getByText("Local API", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Automation API/)).toHaveCount(0);
});

test("every command label uses the glossary's verbs, for one and for many", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/shared/commands/index.ts", "__cmds");
  const labels: string[] = await page.evaluate(() => {
    type C = { id: string; label: (n: number) => string };
    const { allCommands } = (window as unknown as { __cmds: { allCommands(): C[] } }).__cmds;
    return allCommands().flatMap((c) => [c.label(1), c.label(2)]);
  });
  expect(labels.length).toBeGreaterThan(20);
  for (const l of labels) expect(l, l).not.toMatch(/\b(?:[Bb]ind|[Dd]istribut|[Ll]aunch|[Tt]emplate)\b/);
});

test("sentence case: views, the Trash and All profiles", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("aside [data-nav='profiles'], aside").getByText("All profiles", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.getByText(/Save as View/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await row(page, "Sandbox").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Moved “Sandbox” to Trash" })).toBeVisible();
});

test("the Trash names itself as a place", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockEmpty?: boolean }).__shardxMockEmpty = true; });
  await openApp(page, { section: "trash" });
  await expect(page.getByText("Trash is empty", { exact: true })).toBeVisible();
});

test("US spelling where people read it", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek]")).not.toContainText(/Colour/);
});

test("names are in curly quotes; labels carry no arrows", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.getByRole("button", { name: /Add proxies|New proxy/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Preview" })).toBeVisible();
  await expect(dialog).not.toContainText(/[→←✓]/);
  await page.keyboard.press("Escape");
  await openApp(page);
  await row(page, "Sandbox").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Moved “Sandbox” to Trash" })).toBeVisible();
});

test("a copy toast says what it copied", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='checkbox'] input").check({ force: true });
  await row(page, "Etsy craft shop").locator("[data-cell='checkbox'] input").check({ force: true });
  // Copy as JSON sits in the bulk bar's More menu.
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "More bulk actions" }).click();
  await page.getByRole("menuitem", { name: "Copy as JSON" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Copied 2 profiles as JSON" })).toBeVisible();
});

// Pair 57, G13: Chinese terms. A profile is 配置, Pin is 置顶, Peek is 预览.
const zh = (page: Page) => page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));

test("Chinese: Pin is 置顶 everywhere, Peek is 预览", async ({ page }) => {
  await zh(page);
  await openApp(page);
  await row(page, "Sandbox").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /^(置顶|取消置顶)$/ })).toBeVisible();
  await expect(page.getByRole("menu")).not.toContainText("固定");
  await page.keyboard.press("Escape");
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "标签" }).click();
  await expect(page.locator("main")).not.toContainText("Peek");
});

test("Chinese: What's new says the notes are in English", async ({ page }) => {
  await zh(page);
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("更新内容");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("更新说明仅提供英文版");
});

test("Chinese: no button, tab or menu label is clipped", async ({ page }) => {
  await zh(page);
  for (const section of ["profiles", "proxies", "trash", "settings"]) {
    await openApp(page, { section });
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("button, [role='tab'], [role='menuitem'], aside a")]
        .filter((el) => el.offsetParent !== null && el.innerText.trim() !== "" && el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.innerText.trim()),
    );
    expect(clipped, section).toEqual([]);
  }
});

test("a no-match state says it once, with the query", async ({ page }) => {
  await openApp(page);
  await (await openSearch(page)).fill("qqqqq");
  await expect(page.getByText("No profiles match “qqqqq”", { exact: true })).toBeVisible();
  await expect(page.getByText(/No results for “qqqqq”/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear search" })).toBeVisible();
});
