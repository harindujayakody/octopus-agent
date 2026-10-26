import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";

// One guard asks before any exit drops unsaved changes (manual save, Task 2):
// an editor joins the registry while it is dirty, and every page change asks
// it first. A fake editor stands in for the real ones here.
type U = typeof import("../src/shared/model/unsaved");
type Nav = typeof import("../src/shared/model/navigation");
type Ui = typeof import("../src/entities/profile/lib/useProfileUi");
type Counts = { saves: number; discards: number };
type W = { __unsaved: U; __nav: Nav; __ui: Ui; fakes: Record<string, Counts>; navResult?: boolean };

/** Fake editors, oldest first, each counting its saves and discards. */
async function addFakes(page: Page, editors: { label: string; saveOk?: boolean }[]) {
  await appModule(page, "/src/shared/model/unsaved.ts", "__unsaved");
  await page.evaluate((list) => {
    const w = window as unknown as W;
    w.fakes = {};
    w.__unsaved.unsavedStore.setState({
      editors: list.map(({ label, saveOk = true }) => {
        const n = (w.fakes[label] = { saves: 0, discards: 0 });
        return {
          id: label,
          label,
          save: async () => { n.saves++; return saveOk; },
          discard: () => { n.discards++; },
        };
      }),
    });
  }, editors);
}
const addFake = (page: Page, saveOk = true) => addFakes(page, [{ label: "Fake", saveOk }]);
const fake = (page: Page, label = "Fake") => page.evaluate((l) => {
  const w = window as unknown as W;
  return { ...w.fakes[l], editors: w.__unsaved.unsavedStore.getState().editors.length };
}, label);
const nav = (page: Page, section: string) => page.locator(`aside [data-nav='${section}']`).click();
const section = (page: Page) => page.locator("main");
const guard = (page: Page, label = "Fake") => page.getByRole("alertdialog", { name: `Save changes to ${label}?` });
/** Calls a `useNav` action through the app's own module; its answer lands on `navResult`. */
async function callNav(page: Page, call: "openSettings" | "setSection", arg: string) {
  await appModule(page, "/src/shared/model/navigation.ts", "__nav");
  await page.evaluate(([c, a]) => {
    const w = window as unknown as W;
    w.navResult = undefined;
    const nav = w.__nav.useNav.getState();
    const done = c === "openSettings" ? nav.openSettings(a as never) : nav.setSection(a as never);
    void done.then((r) => { w.navResult = r; });
  }, [call, arg] as const);
}
const navResult = (page: Page) => page.evaluate(() => (window as unknown as W).navResult);

test("no editor: sidebar link navigates at once", async ({ page }) => {
  await openApp(page);
  await nav(page, "proxies");
  await expect(section(page)).toHaveAttribute("data-section", "proxies");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("dirty editor: sidebar asks; Cancel stays", async ({ page }) => {
  await openApp(page);
  await addFake(page);
  await nav(page, "proxies");
  await expect(guard(page)).toBeVisible();
  await expect(guard(page)).toContainText("Your changes will be lost if you don’t save them.");
  await expect(guard(page).getByRole("button", { name: "Save", exact: true })).toBeFocused();
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect(guard(page)).toHaveCount(0);
  await expect(section(page)).toHaveAttribute("data-section", "profiles");
  // Esc is Cancel.
  await nav(page, "proxies");
  await expect(guard(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guard(page)).toHaveCount(0);
  await expect(section(page)).toHaveAttribute("data-section", "profiles");
  expect(await fake(page)).toEqual({ saves: 0, discards: 0, editors: 1 });
});

test("Don't save: discard runs and navigation goes on", async ({ page }) => {
  await openApp(page);
  await addFake(page);
  await nav(page, "proxies");
  await guard(page).getByRole("button", { name: "Don’t save" }).click();
  await expect(section(page)).toHaveAttribute("data-section", "proxies");
  await expect(guard(page)).toHaveCount(0);
  expect(await fake(page)).toMatchObject({ saves: 0, discards: 1 });
});

test("Save success: save runs, navigation goes on", async ({ page }) => {
  await openApp(page);
  await addFake(page, true);
  await nav(page, "proxies");
  await guard(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(section(page)).toHaveAttribute("data-section", "proxies");
  await expect(guard(page)).toHaveCount(0);
  expect(await fake(page)).toMatchObject({ saves: 1, discards: 0 });
});

test("Save failure: dialog closes, section unchanged, editor still registered", async ({ page }) => {
  await openApp(page);
  await addFake(page, false);
  await nav(page, "proxies");
  await guard(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(guard(page)).toHaveCount(0);
  await expect(section(page)).toHaveAttribute("data-section", "profiles");
  expect(await fake(page)).toEqual({ saves: 1, discards: 0, editors: 1 });
});

test("palette command and G key also ask", async ({ page }) => {
  await openApp(page);
  await addFake(page);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Search commands" }).fill("proxies");
  await palette.getByRole("group", { name: "Go to" }).getByRole("option", { name: /^Proxies/ }).click();
  await expect(guard(page)).toBeVisible();
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect(guard(page)).toHaveCount(0);
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect(guard(page)).toBeVisible();
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect(section(page)).toHaveAttribute("data-section", "profiles");
});

test("toast.saved closes after 3 s", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => (window as unknown as { __shardxToast: { saved: (t: string) => number } }).__shardxToast.saved("Profile 7 saved"));
  const toast = page.locator("[data-toast]").filter({ hasText: "Profile 7 saved" });
  await expect(toast).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(toast).toBeVisible();
  // Gone by 4.5 s at the latest: a plain 5 s toast would still show.
  await page.waitForTimeout(1000);
  await expect(toast).toHaveCount(0, { timeout: 1000 });
});

test("openSettings asks too, and reports that the person stayed", async ({ page }) => {
  await openApp(page);
  await addFake(page);
  await callNav(page, "openSettings", "appearance");
  await expect(guard(page)).toBeVisible();
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => navResult(page)).toBe(false);
  await expect(section(page)).toHaveAttribute("data-section", "profiles");
});

test("moving to the page you are on does not ask", async ({ page }) => {
  await openApp(page);
  await addFake(page);
  await nav(page, "profiles");
  await callNav(page, "setSection", "profiles");
  // With nothing to ask, the answer is there at once.
  expect(await navResult(page)).toBe(true);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("switching Settings tabs does not ask", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await addFake(page);
  await page.getByRole("tab", { name: "Appearance" }).click();
  await expect(page.getByRole("tab", { name: "Appearance" })).toHaveAttribute("aria-selected", "true");
  await callNav(page, "openSettings", "general");
  expect(await navResult(page)).toBe(true);
  await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("two dirty editors are asked newest first", async ({ page }) => {
  await openApp(page);
  await addFakes(page, [{ label: "Older" }, { label: "Newer" }]);
  await nav(page, "proxies");
  await guard(page, "Newer").getByRole("button", { name: "Don’t save" }).click();
  await guard(page, "Older").getByRole("button", { name: "Save", exact: true }).click();
  await expect(section(page)).toHaveAttribute("data-section", "proxies");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await fake(page, "Newer")).toMatchObject({ saves: 0, discards: 1 });
  expect(await fake(page, "Older")).toMatchObject({ saves: 1, discards: 0 });
});

test("palette Open in Peek from another page: Cancel opens no Peek", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await addFake(page);
  await appModule(page, "/src/entities/profile/lib/useProfileUi.tsx", "__ui");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox", { name: "Search commands" }).fill("etsy");
  await page.keyboard.press("ControlOrMeta+Enter");
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect(guard(page)).toHaveCount(0);
  await expect(section(page)).toHaveAttribute("data-section", "proxies");
  expect(await page.evaluate(() => (window as unknown as W).__ui.useProfileUi.getState().peekId)).toBeNull();
});
