import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// C20a and C21: one dialog shell with a form (Enter submits), importers that
// ask before Esc drops what was pasted, and confirms that name their action.

const importer = (page: Page) => page.getByRole("dialog", { name: "Add proxies" });

async function openImporter(page: Page) {
  await openApp(page, { section: "proxies" });
  await page.locator("main header").getByRole("button", { name: "Add proxies" }).click();
  await expect(importer(page)).toHaveAttribute("data-state", "open");
}

test("Enter in the bookmark dialog saves it", async ({ page }) => {
  await openApp(page, { section: "bookmarks" });
  await page.getByRole("button", { name: "New bookmark" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New bookmark" });
  await dialog.getByRole("textbox", { name: "URL" }).fill("https://example.com/docs");
  await dialog.getByRole("textbox", { name: "Title" }).fill("Docs");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Docs", { exact: true })).toBeVisible();
});

// MP4 review, M12: the close button's tooltip only repeats its name, so it
// takes no Esc of its own: one Esc closes the dialog, and the tooltip goes too.
test("one Esc closes a dialog from its close button, tooltip and all", async ({ page }) => {
  await openApp(page);
  await page.locator("aside").getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: /New folder/ });
  await expect(dialog.getByRole("textbox").first()).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Its own tooltip went with it (focus back on the trigger may show that one's).
  await expect(page.getByRole("tooltip").filter({ hasText: /^Close$/ })).toHaveCount(0);
});

test("Esc on an importer with pasted lines asks before throwing them away", async ({ page }) => {
  await openImporter(page);
  const lines = importer(page).getByRole("textbox", { name: "Paste one proxy per line" });
  await lines.fill("10.0.0.1:1080\n10.0.0.2:1080");
  await page.keyboard.press("Escape");
  const ask = page.getByRole("alertdialog", { name: "Discard your changes?" });
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(ask).toHaveCount(0);
  await expect(lines).toHaveValue("10.0.0.1:1080\n10.0.0.2:1080");
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

// C21 carry: Esc mid-save used to let the late onClose(added) open a Peek
// for a dialog the person had already left.
test("Esc while Add 1 proxy saves: the proxy is added and no Peek opens after the dialog is gone", async ({ page }) => {
  await openImporter(page);
  await importer(page).getByRole("textbox", { name: "Paste one proxy per line" }).fill("socks5://198.51.100.77:1080");
  await importer(page).getByRole("button", { name: "Preview" }).click();
  await page.evaluate(() => Object.assign(window, { __shardxMockSlow: { proxy_bulk_save: 800 } }));
  await importer(page).getByRole("button", { name: "Add 1 proxy" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("alertdialog", { name: "Discard your changes?" }).getByRole("button", { name: "Discard" }).click();
  await expect(importer(page)).toHaveCount(0);
  await expect(page.locator("[data-toast]").filter({ hasText: "Imported 1 proxy" })).toBeVisible();
  await expect(page.locator("aside[data-peek='proxy']")).toHaveCount(0);
});

test("a destructive question is an alertdialog that names its action and says what happens", async ({ page }) => {
  // A proxy delete waits behind Undo now (ruling 18); emptying the Trash still asks.
  await openApp(page, { section: "trash" });
  await page.locator("main header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /^Empty Trash/ }).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("button", { name: /^Empty Trash/ })).toBeVisible();
  await expect(ask).toHaveAccessibleDescription(/.+/);
});

test("the link dialog's field fits its dialog: no sideways scroll", async ({ page }) => {
  await openApp(page, { section: "extensions" });
  await page.locator("main header").getByRole("button", { name: "Add extension" }).click();
  await page.getByRole("menuitem", { name: "From a link" }).click();
  const dialog = page.getByRole("dialog", { name: "Add from a link" });
  await expect(dialog).toHaveAttribute("data-state", "open");
  const overflow = await dialog.evaluate((d) => {
    const body = d.querySelector("form > div") as HTMLElement;
    return body.scrollWidth - body.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});

