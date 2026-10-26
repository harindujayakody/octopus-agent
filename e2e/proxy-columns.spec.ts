import { expect, test, type Page } from "@playwright/test";
import { expectScrollsInCard, openApp, reloadApp } from "./support/app";

// The Proxies list's columns (owner feature 2026-09-26): chosen from the
// header, remembered, every one kept beside Peek too (the list scrolls
// sideways inside its card).
const grid = (page: Page) => page.getByRole("treegrid", { name: "Proxies" });
const header = (page: Page) => grid(page).locator("[role='row'][aria-rowindex='1']");
const titles = (page: Page) => header(page).locator("[data-col]").allTextContents();
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("shardx.proxies.layout") ?? "null"));
const DEFAULT = ["Name", "Type", "Host and port", "Country", "Profiles", "Test result"];

test("Proxies show the columns a person picks from a title's menu, and keep them", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  expect(await titles(page)).toEqual(DEFAULT);
  const b = (await header(page).locator("[data-col='type']").boundingBox())!;
  await page.mouse.click(b.x + 8, b.y + b.height / 2, { button: "right" });
  await page.getByRole("menu", { name: "Type column" }).getByRole("menuitemcheckbox", { name: "Type" }).click();
  await page.keyboard.press("Escape");
  expect(await titles(page)).toEqual(["Name", "Host and port", "Country", "Profiles", "Test result"]);
  expect(await stored(page)).toMatchObject({ v: 2, hidden: ["type"] });
  await reloadApp(page);
  expect(await titles(page)).toEqual(["Name", "Host and port", "Country", "Profiles", "Test result"]);
});

test("a title drags and an edge sizes on Proxies too", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const country = (await header(page).locator("[data-col='country']").boundingBox())!;
  const type = (await header(page).locator("[data-col='type']").boundingBox())!;
  await page.mouse.move(country.x + 6, country.y + country.height / 2);
  await page.mouse.down();
  await page.mouse.move(country.x - 20, country.y + country.height / 2, { steps: 2 });
  await page.mouse.move(type.x + 4, type.y + type.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await titles(page)).toEqual(["Name", "Country", "Type", "Host and port", "Profiles", "Test result"]);
  // Narrower: the next column takes the 8 px (at 1280 the columns after it have little to give).
  await header(page).locator("[data-col-edge='address']").focus();
  const v0 = Number(await header(page).locator("[data-col-edge='address']").getAttribute("aria-valuenow"));
  await page.keyboard.press("ArrowLeft");
  expect((await stored(page)).widths.address).toBe(v0 - 8);
});

test("beside Peek every chosen Proxies column stays: the list scrolls inside its card, Name and the row actions pinned, never the page (Review Focus 5)", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id='px-us-2'] [data-cell='name']").click();
  await expect(page.locator("aside[data-peek='proxy']")).toBeVisible();
  expect(await titles(page)).toEqual(DEFAULT);
  await expectScrollsInCard(page, grid(page), page.locator("[role='row'][data-proxy-id='px-us-2']"), "Open in Peek");
});

test("keys pressed on the Proxies header never act on a row (Review Focus 4)", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id='px-us-2'] [data-cell='address']").click();
  await header(page).getByRole("button", { name: "Columns" }).focus();
  for (const key of ["Backspace", "Delete", "t", "x"]) await page.keyboard.press(key);
  await page.waitForTimeout(300);
  // A delete asks nothing (ruling 18): it would hide the row.
  await expect(page.locator("[role='row'][data-proxy-id='px-us-2']")).toHaveCount(1);
  await expect(page.getByRole("dialog").or(page.getByRole("alertdialog"))).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator("[role='row'][data-proxy-id][aria-selected='true']")).toHaveCount(0);
  await expect(page.locator("[role='row'][data-proxy-id='px-us-2'] [data-cell='test']")).not.toContainText("Testing");
});

test("a column's note in the Proxies Display menu describes its box, as on Profiles", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.getByRole("button", { name: "Display", exact: true }).click();
  const display = page.getByRole("dialog", { name: "Display" });
  const notes = display.locator("[data-column-note]");
  await expect(notes.first()).toBeVisible();
  for (const note of await notes.all()) {
    const box = note.locator("xpath=..").getByRole("checkbox");
    await expect(box).toHaveAccessibleDescription((await note.textContent())!);
  }
});
