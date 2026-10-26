import { expect, test, type Page } from "@playwright/test";
import { openApp, reloadApp } from "./support/app";

// The project's home, its GitHub repository: Settings → About and the palette link to it, with no tracking tags.
const SITE = "https://github.com/harindujayakody/octopus-agent";
type Mock = { __shardxMock: { log: { cmd: string; args: Record<string, unknown> }[] } };
const opened = (page: Page) => page.evaluate(() =>
  (window as unknown as Mock).__shardxMock.log.filter((l) => l.cmd === "plugin:opener|open_url").map((l) => l.args.url));
const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });

// The mock opens a link with window.open: no popup in a test.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.open = () => null; });
});

test("About has a Website row whose link opens the GitHub repository in the system browser", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "About" }).click();
  const row = page.locator("[data-details='about'] [data-detail='website']");
  await expect(row).toContainText("Website");
  const link = row.getByRole("link", { name: "github.com/harindujayakody/octopus-agent", exact: true });
  await expect(link).toHaveAttribute("href", SITE);
  await link.click();
  await expect.poll(() => opened(page)).toEqual([SITE]);
  // Opened outside, not in the launcher's own window.
  expect(new URL(page.url()).host).not.toBe("github.com");
});

test("the palette opens the GitHub repository, found by “website”", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+k");
  await palette(page).getByRole("combobox", { name: "Search commands" }).fill("website");
  await palette(page).getByRole("option", { name: /^Open / }).click();
  await expect(palette(page)).toHaveCount(0);
  await expect.poll(() => opened(page)).toEqual([SITE]);
});

test("in Russian the row is Сайт and the palette finds the site by «сайт»", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.evaluate(() => localStorage.setItem("shardx.lang", "ru"));
  await reloadApp(page);
  await page.getByRole("tab", { name: "О программе" }).click();
  await expect(page.locator("[data-details='about'] [data-detail='website']")).toContainText("Сайт");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog").getByRole("combobox").fill("сайт");
  await expect(page.getByRole("dialog").getByRole("option", { name: /^Открыть сайт/ })).toBeVisible();
});
