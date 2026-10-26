import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// The Chinese UI is announced as Chinese, and dates follow the UI language,
// not the computer's (TYPE-03, A11Y-11, WRITE-11).
//
// Adaptation (P20/P21, since this brief was written): Task 5d merged the
// Profiles list's dot column and its "Last run" column into one Status cell
// — there is no `[data-cell='lastrun']` any more. The Status cell's own date
// is a relative word ("12 min ago", "Yesterday"), not the fixed
// "Sep 1, 9:12 AM" `fmtTs` shape the brief expects, and Amazon US seller is
// seeded running (no idle "last run" word to read at all). The absolute
// last-run date is in Profile Peek's activity line (Pair 21), which is
// unaffected by whether the profile is currently running — so the two date
// tests below open Peek and read that line instead of a row cell.
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const peek = (page: Page) => page.locator("aside[data-peek]");
// Peek's facts are label and value rows (Created, Last run, Total time),
// dates as days, in the UI language.
const activity = (page: Page) => peek(page).locator("[data-peek-activity]");
const zh = (page: Page) => page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
const ru = (page: Page) => page.addInitScript(() => localStorage.setItem("shardx.lang", "ru"));
const RU = JSON.parse(readFileSync("src/shared/i18n/locales/ru.json", "utf8")) as Record<string, string>;

test("dates read the English way in the English UI", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await row(page, "Amazon US seller").locator("[data-cell='name']").click();
  await expect(activity(page)).toContainText(/Last run\s*Sep 1(?!\d)/);
});

test("in Chinese the page says so and dates are Chinese", async ({ page }) => {
  await zh(page);
  await openApp(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await row(page, "Amazon US seller").locator("[data-cell='name']").click();
  await expect(activity(page)).toContainText(/上次运行\s*(\d{4}年)?9月1日/);
});

test("in Russian the page says so and dates are Russian", async ({ page }) => {
  await ru(page);
  await openApp(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await row(page, "Amazon US seller").locator("[data-cell='name']").click();
  await expect(activity(page)).toContainText(RU["peek.activityLastRun"]);
  await expect(activity(page)).toContainText(/1 сент\./);
});

test.describe("on a Russian system", () => {
  test.use({ locale: "ru-RU" });

  // Not through openApp, which stores English before the app reads it.
  test("the first start is in Russian, without being asked", async ({ page }) => {
    await page.goto("/?mock=reset&section=profiles");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  });

  test("a stored choice wins over the system's", async ({ page }) => {
    await openApp(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test("switching the language in Settings switches the page language", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("combobox", { name: "Interface language" }).click();
  await page.getByRole("option", { name: "中文（简体）" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.getByRole("combobox", { name: "界面语言" }).click();
  await page.getByRole("option", { name: "Русский" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
});

test("dates stored as ISO text are formatted too", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id]", { hasText: "DC Tokyo" }).locator("[data-cell='name']").click();
  const first = page.locator("aside[data-peek='proxy'] [data-history-item]").first();
  await expect(first).toBeVisible();
  await expect(first).not.toContainText(/\d{4}-\d{2}-\d{2}T/);
});

test("the window title names the page", async ({ page }) => {
  await openApp(page);
  await expect(page).toHaveTitle("All profiles – Octopus Agent");
  await page.locator("aside [data-nav='proxies']").click();
  await expect(page).toHaveTitle("Proxies – Octopus Agent");
});

test("kit defaults speak the UI language", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
  await openApp(page);
  await page.evaluate(() => (window as unknown as { __shardxToast: { ok: (t: string) => void } }).__shardxToast.ok("x"));
  await expect(page.getByRole("button", { name: "关闭通知" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
});
