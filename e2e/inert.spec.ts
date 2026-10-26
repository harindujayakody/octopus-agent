import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";

// C20b (A11Y-07): while a dialog, a sheet or the palette is open, the page
// behind it (#root) is inert: Tab and a screen reader's cursor stay in the
// dialog. What must stay live renders outside #root: the dialog itself, its
// menus, the toasts and the window's caption buttons.

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

const rootInert = (page: Page) => page.evaluate(() => document.getElementById("root")!.hasAttribute("inert"));
const focusInDialog = (page: Page) =>
  page.evaluate(() => !!document.activeElement?.closest("[role='dialog'][aria-modal='true']"));

test("Tab cannot leave an open dialog; the page is live again once it closes, focus back on the trigger", async ({ page }) => {
  await openApp(page);
  const trigger = page.locator("aside").getByRole("button", { name: "New folder" });
  // From the keyboard, so the trigger holds focus as the dialog opens.
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await expect(dialog).toHaveAttribute("data-state", "open");
  expect(await rootInert(page)).toBe(true);
  // The page's own controls sit inside the inert tree, so nothing behind is reachable.
  expect(await page.evaluate(() => !!document.querySelector("main")?.closest("[inert]"))).toBe(true);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await focusInDialog(page)).toBe(true);
  }
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusInDialog(page)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await rootInert(page)).toBe(false);
  await expect(trigger).toBeFocused();
});

test("the palette makes the page inert too, and lets it go when it closes", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog").first()).toBeVisible();
  expect(await rootInert(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("[role='dialog'][aria-modal='true']")).toHaveCount(0);
  expect(await rootInert(page)).toBe(false);
});

test("Peek is a side panel, not a dialog: it leaves the page live", async ({ page }) => {
  await openApp(page);
  // The Name cell: the row's middle is the Proxy cell's edit button now that
  // the column always shows (an empty cell offers Add there).
  await page.locator("[role='row'][data-profile-id]").first().locator("[data-cell='name']").click();
  await expect(page.locator("[data-region='peek']").first()).toBeVisible();
  expect(await rootInert(page)).toBe(false);
});

test("a toast stays clickable while a dialog is open", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/shared/model/toast.ts", "__toastModel");
  await page.locator("aside").getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await expect(dialog).toHaveAttribute("data-state", "open");
  await page.evaluate(() => {
    const w = window as unknown as { __undone?: boolean; __toastModel: { toast: { undo: (title: string, run: () => void) => void } } };
    w.__toastModel.toast.undo("Moved 2 profiles", () => { w.__undone = true; });
  });
  const toastEl = page.locator("[data-toast]", { hasText: "Moved 2 profiles" });
  await expect(toastEl).toBeVisible();
  // Outside #root, so the inert page does not take it along.
  expect(await toastEl.evaluate((el) => !!el.closest("[inert]") || !!document.getElementById("root")!.contains(el))).toBe(false);
  await toastEl.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __undone?: boolean }).__undone)).toBe(true);
  // The dialog is still there: the press went to the toast, not the backdrop.
  await expect(dialog).toBeVisible();
});

test.describe("on Windows", () => {
  test.use({ userAgent: WINDOWS_UA });

  test("the caption buttons stay live while a dialog is open", async ({ page }) => {
    await openApp(page);
    await page.locator("aside").getByRole("button", { name: "New folder" }).click();
    await expect(page.getByRole("dialog", { name: "New folder" })).toHaveAttribute("data-state", "open");
    const minimize = page.locator("[data-captions]").getByRole("button", { name: "Minimize" });
    expect(await minimize.evaluate((el) => !!el.closest("[inert]"))).toBe(false);
    await minimize.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shardxMock: { windowCalls: string[] } }).__shardxMock.windowCalls))
      .toContain("plugin:window|minimize");
  });
});
