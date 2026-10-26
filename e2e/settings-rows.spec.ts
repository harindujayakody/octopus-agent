import { expect, test, type Page } from "@playwright/test";
import { openApp, storedTags } from "./support/app";

// LAYOUT-16: a setting is a row: its name and one line of help, the control at the end.
// The tabs of setting rows (F30, F31). Tags and Views are lists, Storage one card,
// About a details card (Lane E, air and hierarchy; air-hierarchy.spec checks it).
const TABS = ["General", "Appearance", "Profile defaults", "API & MCP", "Helper"];
const panel = (page: Page) => page.getByRole("tabpanel");

// The column runs to the page's edge at every width; only the help keeps a
// readable line (owner, 2026-10-23: no empty band beside a narrow column).
test("the content column reaches the page's right edge at every width, and its help keeps a readable line", async ({ page }) => {
  await openApp(page, { section: "settings" });
  const gap = () => page.evaluate(() => {
    const body = document.querySelector<HTMLElement>("[data-page-body]")!;
    const end = body.getBoundingClientRect().right - parseFloat(getComputedStyle(body).paddingRight) * Number(getComputedStyle(document.documentElement).zoom || 1);
    return Math.abs(end - document.querySelector("[role='tabpanel']")!.getBoundingClientRect().right);
  });
  expect(await gap()).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 2560, height: 1440 });
  // A 2560 screen gets 125% by Auto.
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe("1.25");
  await expect.poll(gap).toBeLessThanOrEqual(1);
  const help = panel(page).locator("[data-setting-help]").first();
  expect(await help.evaluate((el) => getComputedStyle(el).maxWidth)).not.toBe("none");
});

for (const name of TABS) {
  test(`${name}: every setting is one row with at most one line of help`, async ({ page }) => {
    await openApp(page, { section: "settings" });
    await page.getByRole("tab", { name }).click();
    const rows = panel(page).locator("[data-setting]");
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) {
      const help = row.locator("[data-setting-help]");
      if (await help.count()) expect((await help.boundingBox())!.height, await row.getAttribute("data-setting") ?? "").toBeLessThanOrEqual(19);
    }
  });
}

test("controls sit at the row's end; selects keep a short width (CRAFT-31)", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openApp(page, { section: "settings" });
  const row = panel(page).locator("[data-setting='language']");
  const select = row.getByRole("combobox");
  const r = (await row.boundingBox())!;
  const s = (await select.boundingBox())!;
  expect(s.width).toBeLessThanOrEqual(240);
  expect(r.x + r.width - (s.x + s.width)).toBeLessThanOrEqual(20);
  await expect(select).toHaveAccessibleName("Interface language");
});

test("labels say what ON does (WRITE-24)", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await expect(page.getByRole("switch", { name: "Keep running in the tray when the window closes" })).toBeVisible();
  await page.getByRole("tab", { name: "Profile defaults" }).click();
  await expect(page.getByRole("switch", { name: "Use an Octopus Agent camera in profiles" })).toBeVisible();
  await expect(panel(page).locator("[data-setting='screen']")).toContainText("Screen size shown to sites");
});

test("a click on a switch row's words toggles it, once (owner rule)", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Appearance" }).click();
  const sw = page.getByRole("switch", { name: "Reduce motion" });
  const before = await sw.isChecked();
  await panel(page).locator("[data-setting='motion'] [data-setting-help]").click();
  await expect(sw).toBeChecked({ checked: !before });
  await sw.click();
  await expect(sw).toBeChecked({ checked: before });
});

test("the API reference is one link away; nothing else links nowhere (plan ruling 8)", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "API & MCP" }).click();
  await expect(panel(page).getByRole("link", { name: /Learn more about the API/ })).toBeVisible();
  await expect(panel(page).getByText(/axum|JWT/)).toHaveCount(0);
});

test("a taken tag name is found on Save, and goes once the other tag is renamed away (PC-087)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.tags", JSON.stringify({
    version: 1, tags: [{ id: "t1", name: "warm-up", color: "green" }, { id: "t2", name: "ads", color: "sky" }], byProfile: {},
  })));
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Tags" }).click();
  const save = page.locator("[data-save-bar]").getByRole("button", { name: "Save", exact: true });
  const second = panel(page).locator("[data-tag-row='t2'] input");
  await second.fill("warm-up");
  await save.click();
  await expect(panel(page).locator("[data-tag-row='t2']").getByText(/A tag named/)).toBeVisible();
  // The other tag leaves that name, and the same Save takes both.
  const first = panel(page).locator("[data-tag-row='t1'] input");
  await first.fill("cold");
  await save.click();
  await expect(panel(page).getByText(/A tag named/)).toHaveCount(0);
  await expect(page.locator("[data-save-bar]")).toHaveCount(0);
  await expect.poll(async () => (await storedTags(page)).tags.map((t) => t.name)).toEqual(["cold", "warm-up"]);
});

test("a long data path keeps its end in view (TYPE-07)", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Storage" }).click();
  const path = panel(page).locator("[data-data-path]");
  await expect(path).toHaveAttribute("aria-label", /[\\/]/);
  const full = await path.getAttribute("title") ?? await path.evaluate((el) => el.getAttribute("aria-label") ?? "");
  const last = full.split(/[\\/]/).filter(Boolean).pop()!;
  await expect(path).toContainText(last);
  // In view, not only in the text: nothing is cut off at the end.
  expect(await path.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});
