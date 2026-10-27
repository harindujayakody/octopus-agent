import { expect, test, type Page } from "@playwright/test";
import { openApp, row } from "./support/app";

// Settings > Browsers: Google Chrome, Chromium and Firefox, each installed,
// updated or removed on its own; a copy installed on the computer is never
// used. The mock has no Chrome or Chromium installed in the launcher, and its
// Firefox 140.0 with 144.0.2 out.
// A profile's browser is chosen once, when it is made.

const tab = (page: Page, name: string) =>
  page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name });
const browserRow = (page: Page, id: string) => page.locator(`[data-setting='browser-${id}']`);
const status = (page: Page, id: string) => page.locator(`[data-browser-status='${id}']`);

async function openBrowsers(page: Page) {
  await openApp(page, { section: "settings" });
  await tab(page, "Browsers").click();
  await expect(tab(page, "Browsers")).toHaveAttribute("aria-selected", "true");
}

test("the Browsers tab lists Chrome, Chromium and Firefox with what each has", async ({ page }) => {
  await openBrowsers(page);
  await expect(page.locator("main [data-setting^='browser-']")).toHaveCount(6);
  await expect(browserRow(page, "chrome")).toContainText("Google Chrome");
  await expect(browserRow(page, "chromium")).toContainText("Chromium");
  await expect(browserRow(page, "firefox")).toContainText("Firefox");

  // Chrome: not installed here (a copy on the computer would not count).
  await expect(status(page, "chrome")).toHaveText("Not installed");
  await expect(browserRow(page, "chrome").getByRole("button", { name: "Install" })).toBeVisible();
  // Chromium: missing.
  await expect(status(page, "chromium")).toHaveText("Not installed");
  await expect(browserRow(page, "chromium").getByRole("button", { name: "Install" })).toBeVisible();
  // Firefox: the launcher's own copy, a newer version out (opening the tab asked).
  await expect(status(page, "firefox")).toHaveText("Version 144.0.2 is out (you have 140.0)");
  await expect(browserRow(page, "firefox").getByRole("button", { name: "Update" })).toBeVisible();
  await expect(browserRow(page, "firefox").getByRole("button", { name: "Remove" })).toBeVisible();
  await expect(browserRow(page, "firefox").getByRole("button", { name: "Install" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check for updates" })).toBeVisible();
});

test("Install on Chromium shows its progress, then the installed version", async ({ page }) => {
  await openBrowsers(page);
  await browserRow(page, "chromium").getByRole("button", { name: "Install" }).click();
  await expect(status(page, "chromium")).toHaveText(/^(Downloading Chromium: \d+%|Unpacking Chromium)$/);
  await expect(status(page, "chromium")).toHaveText("Installed: version r1529133", { timeout: 10_000 });
  await expect(browserRow(page, "chromium").getByRole("button", { name: "Remove" })).toBeVisible();
  await expect(browserRow(page, "chromium").getByRole("button", { name: "Install" })).toHaveCount(0);
});

test("Remove on Firefox leaves it not installed", async ({ page }) => {
  await openBrowsers(page);
  await expect(status(page, "firefox")).toHaveText(/is out/);
  await browserRow(page, "firefox").getByRole("button", { name: "Remove" }).click();
  await expect(status(page, "firefox")).toHaveText("Not installed");
  await expect(browserRow(page, "firefox").getByRole("button", { name: "Install" })).toBeVisible();
  await expect(browserRow(page, "firefox").getByRole("button", { name: "Remove" })).toHaveCount(0);
});

test("a profile's browser is fixed once it is made; a new profile picks one", async ({ page }) => {
  await openApp(page);
  // Edit: the engine is shown, not offered, and the line under says why.
  await row(page, "Sandbox").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit Sandbox", exact: true });
  await edit.getByRole("tab", { name: "Fingerprint" }).click();
  await expect(edit.getByRole("combobox", { name: "Browser engine" })).toBeDisabled();
  await expect(edit.locator("[data-engine-fixed]")).toBeVisible();
  await edit.getByRole("button", { name: "Cancel" }).click();
  await expect(edit).toHaveCount(0);

  // New profile: the engine is a choice.
  await page.getByRole("button", { name: "New profile" }).first().click();
  const create = page.getByRole("dialog", { name: "New profile", exact: true });
  await create.getByRole("tab", { name: "Fingerprint" }).click();
  await expect(create.getByRole("combobox", { name: "Browser engine" })).toBeEnabled();
  await expect(create.locator("[data-engine-fixed]")).toHaveCount(0);
});
