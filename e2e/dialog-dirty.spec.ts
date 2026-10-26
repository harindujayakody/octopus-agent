import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// Manual save (Task 10): the bookmark, folder, view and link dialogs know
// when a field differs from what it opened with. Esc, the close button and
// Cancel then ask Discard first; Save says it saved, in a toast.
const toast = (page: Page, text: string) => page.locator("[data-toast]").getByText(text, { exact: true });
const ask = (page: Page) => page.getByRole("alertdialog", { name: "Discard your changes?" });
const sidebar = (page: Page) => page.locator("aside nav");

type Dialog = { open: (page: Page) => Promise<Locator>; type: (dialog: Locator) => Promise<void>; typed: string };

/** Esc and Cancel with a typed change both ask; Keep editing keeps the value, Discard closes. */
function guards(label: string, d: Dialog) {
  test(`${label}: type then Esc asks Discard`, async ({ page }) => {
    const dialog = await d.open(page);
    await d.type(dialog);
    await page.keyboard.press("Escape");
    await expect(ask(page)).toBeVisible();
    await ask(page).getByRole("button", { name: "Keep editing" }).click();
    await expect(ask(page)).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox").first()).toHaveValue(d.typed);
    await page.keyboard.press("Escape");
    await ask(page).getByRole("button", { name: "Discard" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test(`${label}: type then Cancel asks Discard`, async ({ page }) => {
    const dialog = await d.open(page);
    await d.type(dialog);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(ask(page)).toBeVisible();
    await ask(page).getByRole("button", { name: "Discard" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(ask(page)).toHaveCount(0);
  });

  test(`${label}: untouched, Esc just closes`, async ({ page }) => {
    const dialog = await d.open(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(ask(page)).toHaveCount(0);
  });
}

// ---- Bookmark --------------------------------------------------------------
const bookmark: Dialog = {
  open: async (page) => {
    await openApp(page, { section: "bookmarks" });
    await page.getByRole("button", { name: "New bookmark" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New bookmark" });
    await expect(dialog).toHaveAttribute("data-state", "open");
    return dialog;
  },
  type: (dialog) => dialog.getByRole("textbox", { name: "URL" }).fill("https://example.com/docs"),
  typed: "https://example.com/docs",
};
guards("bookmark", bookmark);

test("bookmark: Save toasts", async ({ page }) => {
  const dialog = await bookmark.open(page);
  await dialog.getByRole("textbox", { name: "URL" }).fill("https://example.com/docs");
  await dialog.getByRole("textbox", { name: "Title" }).fill("Docs");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page, "Docs saved")).toBeVisible();
});

test("bookmark: an edit asks only once a field differs, and toasts when saved", async ({ page }) => {
  await openApp(page, { section: "bookmarks" });
  const open = () => page.locator("main").getByText("Seller Central", { exact: true }).first().click();
  await open();
  const dialog = page.getByRole("dialog", { name: "Edit bookmark" });
  await expect(dialog).toHaveAttribute("data-state", "open");
  // Typed and put back: the same as it opened, so nothing to ask.
  const title = dialog.getByRole("textbox", { name: "Title" });
  await title.fill("Seller Central 2");
  await title.fill("Seller Central");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(ask(page)).toHaveCount(0);
  await open();
  await expect(dialog).toHaveAttribute("data-state", "open");
  await title.fill("Seller Central 2");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page, "Seller Central 2 saved")).toBeVisible();
});

// ---- Folder ----------------------------------------------------------------
const newFolder: Dialog = {
  open: async (page) => {
    await openApp(page);
    await page.locator("aside").getByRole("button", { name: "New folder" }).click();
    const dialog = page.getByRole("dialog", { name: /New folder/ });
    await expect(dialog).toHaveAttribute("data-state", "open");
    return dialog;
  },
  type: (dialog) => dialog.getByRole("textbox", { name: "Name" }).fill("Clients"),
  typed: "Clients",
};
guards("folder", newFolder);

async function editFolder(page: Page) {
  await openApp(page);
  await page.locator("aside [data-folder='Ads']").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit folder" }).click();
  const dialog = page.getByRole("dialog", { name: /Edit folder/ });
  await expect(dialog).toHaveAttribute("data-state", "open");
  return dialog;
}

test("folder: Save toasts", async ({ page }) => {
  const dialog = await editFolder(page);
  await dialog.getByRole("textbox", { name: "Name" }).fill("Ads EU");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page, "Ads EU saved")).toBeVisible();
});

test("folder: Create toasts, and a color or an icon alone is a change", async ({ page }) => {
  const dialog = await newFolder.open(page);
  await dialog.getByRole("radio", { name: "Orange" }).click();
  await page.keyboard.press("Escape");
  await expect(ask(page)).toBeVisible();
  await ask(page).getByRole("button", { name: "Keep editing" }).click();
  await dialog.getByRole("textbox", { name: "Name" }).fill("Clients");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page, "Clients created")).toBeVisible();
});

test("folder: a name typed and put back is not a change", async ({ page }) => {
  const dialog = await editFolder(page);
  const name = dialog.getByRole("textbox", { name: "Name" });
  await name.fill("Ads EU");
  await name.fill("Ads");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(ask(page)).toHaveCount(0);
});

// ---- View ------------------------------------------------------------------
const ALL_COLUMNS = { folder: true, tags: true, lastRun: true, notes: true };
const seedView = (page: Page) => page.addInitScript((v) => {
  if (localStorage.getItem("shardx.views") === null) localStorage.setItem("shardx.views", JSON.stringify(v));
}, {
  version: 1,
  views: [{ id: "v-a", name: "Alpha", pinned: true, query: { folder: "all", filters: { status: "all", country: "", proxy: "all", tag: "", lastRun: "any" }, sort: "name-asc", columns: ALL_COLUMNS } }],
});
const renameView: Dialog = {
  open: async (page) => {
    await seedView(page);
    await openApp(page);
    await sidebar(page).locator("[data-view='v-a']").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const dialog = page.getByRole("dialog", { name: /Rename view/ });
    await expect(dialog).toHaveAttribute("data-state", "open");
    return dialog;
  },
  type: (dialog) => dialog.getByRole("textbox", { name: "View name" }).fill("Beta"),
  typed: "Beta",
};
guards("view", renameView);

test("view: Save toasts", async ({ page }) => {
  const dialog = await renameView.open(page);
  await dialog.getByRole("textbox", { name: "View name" }).fill("Beta");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page, "Beta saved")).toBeVisible();
});

test("view: Save as view toasts, and its switch alone is a change", async ({ page }) => {
  await openApp(page);
  await page.locator("main header").getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("option", { name: /^Status/ }).click();
  await page.getByRole("option", { name: /^Idle/ }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save as view" }).click();
  const dialog = page.getByRole("dialog", { name: /Save as view/ });
  await expect(dialog).toHaveAttribute("data-state", "open");
  await dialog.getByRole("switch", { name: "Show in the sidebar" }).click();
  await page.keyboard.press("Escape");
  await expect(ask(page)).toBeVisible();
  await ask(page).getByRole("button", { name: "Keep editing" }).click();
  await dialog.getByRole("textbox", { name: "View name" }).fill("Idle ones");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page, "Idle ones saved")).toBeVisible();
});

// ---- Extension link ---------------------------------------------------------
const link: Dialog = {
  open: async (page) => {
    await openApp(page, { section: "extensions" });
    await page.locator("main header").getByRole("button", { name: "Add extension" }).click();
    await page.getByRole("menuitem", { name: "From a link" }).click();
    const dialog = page.getByRole("dialog", { name: "Add from a link" });
    await expect(dialog).toHaveAttribute("data-state", "open");
    return dialog;
  },
  type: (dialog) => dialog.getByRole("textbox", { name: /Web Store page/ }).fill("https://example.com/ext.crx"),
  typed: "https://example.com/ext.crx",
};
guards("extension link", link);

test("extension link: Download toasts", async ({ page }) => {
  const dialog = await link.open(page);
  await dialog.getByRole("textbox", { name: /Web Store page/ }).fill("https://chromewebstore.google.com/detail/ublock/cjpalhdlnbpafiamejdnhcphjbkeiagm");
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("[data-toast]").filter({ hasText: "Added “Web Store" })).toBeVisible();
});
