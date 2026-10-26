import { expect, test, type Page } from "@playwright/test";
import { openApp, openEditForm, reloadApp, storedFolders } from "./support/app";
import { parseColor } from "./support/color";

const folder = (page: Page, name: string) => page.locator(`aside [data-folder='${name}']`);

test("a new Folder gets the chosen color and icon, and keeps them after a reload", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: /New folder/ });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Clients");
  await dialog.getByRole("radio", { name: "Violet" }).click();
  await dialog.getByRole("radio", { name: "Briefcase" }).click();
  await dialog.getByRole("button", { name: "Create" }).click();
  const icon = folder(page, "Clients").locator("[data-folder-icon]");
  await expect(icon).toHaveAttribute("data-folder-icon", "briefcase");
  await expect(icon).toHaveCSS("color", "rgb(185, 136, 251)");
  await page.reload();
  await expect(folder(page, "Clients").locator("[data-folder-icon]")).toHaveAttribute("data-folder-icon", "briefcase");
});

test("folders and looks an older build kept move to the backend once: the keys go, and a second hand-over changes nothing", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("shardx-folders") === null) localStorage.setItem("shardx-folders", JSON.stringify(["Empty1"]));
    // The first build's hex color still maps onto the palette.
    if (localStorage.getItem("shardx.folderMeta") === null) localStorage.setItem("shardx.folderMeta", JSON.stringify({ Shops: { color: "#12b76a", icon: "cart" } }));
  });
  const legacy = () => page.evaluate(() => [localStorage.getItem("shardx-folders"), localStorage.getItem("shardx.folderMeta")]);
  await openApp(page);
  await expect(folder(page, "Empty1")).toBeVisible();
  await expect(folder(page, "Shops").locator("[data-folder-icon]")).toHaveAttribute("data-folder-icon", "cart");
  const moved = await storedFolders(page);
  expect(moved).toEqual({ registry: ["Empty1"], meta: { Shops: { color: "green", icon: "cart" } } });
  expect(await legacy()).toEqual([null, null]);
  // The keys back with other values (an older build run since): handed over, ignored, gone.
  await page.evaluate(() => {
    localStorage.setItem("shardx-folders", JSON.stringify(["Old"]));
    localStorage.setItem("shardx.folderMeta", JSON.stringify({ Shops: { color: "red", icon: "folder" } }));
  });
  await reloadApp(page);
  await expect(folder(page, "Shops").locator("[data-folder-icon]")).toHaveAttribute("data-folder-icon", "cart");
  await expect(folder(page, "Old")).toHaveCount(0);
  expect(await storedFolders(page)).toEqual(moved);
  expect(await legacy()).toEqual([null, null]);
});

test("a renamed Folder's kept entry and look move with it in the backend; a deleted one's go", async ({ page }) => {
  await page.addInitScript(() => { if (localStorage.getItem("shardx-folders") === null) localStorage.setItem("shardx-folders", JSON.stringify(["Empty1"])); });
  await openApp(page);
  await folder(page, "Empty1").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit folder" }).click();
  const dialog = page.getByRole("dialog", { name: /Edit folder/ });
  await dialog.getByRole("radio", { name: "Violet" }).click();
  await dialog.getByRole("textbox", { name: "Name" }).fill("Empty2");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(folder(page, "Empty2")).toBeVisible();
  await expect.poll(() => storedFolders(page)).toEqual({ registry: ["Empty2"], meta: { Empty2: { color: "violet", icon: "folder" } } });
  await folder(page, "Empty2").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete folder" }).click();
  await expect(folder(page, "Empty2")).toHaveCount(0);
  await expect.poll(() => storedFolders(page)).toEqual({ registry: [], meta: {} });
  await reloadApp(page);
  await expect(folder(page, "Empty2")).toHaveCount(0);
});

test("editing a Folder renames it and keeps its profiles and look", async ({ page }) => {
  await openApp(page);
  await folder(page, "Ads").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit folder" }).click();
  const dialog = page.getByRole("dialog", { name: /Edit folder/ });
  await dialog.getByRole("radio", { name: "Orange" }).click();
  await dialog.getByRole("textbox", { name: "Name" }).fill("Ads EU");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(folder(page, "Ads")).toHaveCount(0);
  await expect(folder(page, "Ads EU").locator("[data-count]")).toHaveText("3");
  await expect(folder(page, "Ads EU").locator("[data-folder-icon]")).toHaveCSS("color", "rgb(251, 124, 30)");
  // Renamed here, it is kept even once its profiles leave.
  await expect.poll(() => storedFolders(page)).toEqual({ registry: ["Ads EU"], meta: { "Ads EU": { color: "orange", icon: "folder" } } });
});

// Owner (WCAG 2.5.8, Task 14 fix round): the close button draws at 21 px, its
// size before the 4 px grid, with an invisible 24 px hit area around it.
test("a click 1 px outside the dialog's visible close button still closes it", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: /New folder/ });
  await expect(dialog).toHaveAttribute("data-state", "open");
  const b = (await dialog.getByRole("button", { name: "Close" }).boundingBox())!;
  expect(Math.round(b.width)).toBe(21);
  expect(Math.round(b.height)).toBe(21);
  await page.mouse.click(b.x - 1, b.y + b.height / 2);
  await expect(dialog).toHaveCount(0);
});

test("a Folder can't be renamed onto another Folder's name", async ({ page }) => {
  await openApp(page);
  await folder(page, "Ads").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit folder" }).click();
  const dialog = page.getByRole("dialog", { name: /Edit folder/ });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Shops");
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("a row's Folder chip is tinted in the Folder's color, no dot (owner feedback 5j)", async ({ page }) => {
  await openApp(page);
  await folder(page, "Shops").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit folder" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "Green" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.locator("aside [data-nav='profiles']").click();
  const chip = page.locator("[role='row'][data-profile-id='aed41005'] [data-cell='folder'] [data-color='green']");
  await expect(chip).toBeVisible();
  // Fix round 1 (M2): dropped a vacuous check for `[data-identity-dot]`,
  // an attribute nothing renders any more — the chip's own single-child
  // shape (checked elsewhere, label-chips.spec.ts) already carries "no dot".
  // Fix round 1 (M8): not just "not transparent" — the tint's hue actually
  // comes from green (the green channel dominates the other two). Chromium
  // serializes this `color-mix(in oklch, ...)` background as an `oklch(...)`
  // function, not `rgb()`, so it needs the same OKLCH-aware parser as
  // label-chips.spec.ts, not a naive number scrape.
  const [r, g, b] = parseColor(await chip.evaluate((el) => getComputedStyle(el).backgroundColor));
  expect(g, `green chip background rgb(${r}, ${g}, ${b})`).toBeGreaterThan(r);
  expect(g, `green chip background rgb(${r}, ${g}, ${b})`).toBeGreaterThan(b);
});

test("Mod+digit opens Folders from any page; Mod+0 is All profiles", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.keyboard.press("ControlOrMeta+2");
  await expect(page.locator("main[data-section='profiles'] header h1")).toHaveText("Shops");
  await page.keyboard.press("ControlOrMeta+1");
  await expect(page.locator("main header h1")).toHaveText("Ads");
  await page.keyboard.press("ControlOrMeta+0");
  await expect(page.locator("main header h1")).toHaveText("All profiles");
});

test("Mod+digit does nothing while a dialog is open", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New folder" }).click();
  await page.keyboard.press("ControlOrMeta+1");
  await expect(page.locator("main header h1")).toHaveText("All profiles");
});

test("arrow keys move the choice and the focus in the Folder dialog", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openApp(page);
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: /New folder/ });
  await dialog.getByRole("radio", { name: "No color" }).focus();
  await page.keyboard.press("ArrowRight");
  const blue = dialog.getByRole("radio", { name: "Blue" });
  await expect(blue).toHaveAttribute("aria-checked", "true");
  await expect(blue).toBeFocused();
  expect(errors).toEqual([]);
});

/** WCAG contrast ratio of two CSS colors as the browser resolves them. */
async function contrastOnSidebar(page: Page, cssColor: string) {
  return page.evaluate((color) => {
    const probe = document.createElement("span");
    probe.style.color = color;
    document.body.appendChild(probe);
    const fg = getComputedStyle(probe).color;
    probe.remove();
    const bg = getComputedStyle(document.querySelector("aside")!).backgroundColor;
    const lum = (rgb: string) => {
      const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  }, cssColor);
}

for (const theme of ["light", "dark"] as const) {
  test(`every Folder color keeps 3:1 contrast on the ${theme} sidebar`, async ({ page }) => {
    await openApp(page, { theme });
    for (const id of ["blue", "violet", "magenta", "red", "orange", "yellow", "green", "sky"]) {
      const defined = await page.evaluate((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), `--label-${id}`);
      expect(defined, `--label-${id} is defined`).not.toBe("");
      expect(await contrastOnSidebar(page, `var(--label-${id})`), id).toBeGreaterThanOrEqual(3);
    }
  });
}

/** WCAG contrast of a CSS color on a checked row: --bg-selected laid over the surface. */
async function contrastOnSelectedRow(page: Page, cssColor: string) {
  return page.evaluate((color) => {
    const read = (css: string) => {
      const probe = document.createElement("span");
      probe.style.color = css;
      document.body.appendChild(probe);
      const v = getComputedStyle(probe).color;
      probe.remove();
      return (v.match(/[\d.]+/g) ?? []).map(Number);
    };
    const [fr, fg, fb] = read(color);
    const [sr, sg, sb] = read("var(--bg-white-0)");
    const [r, g, b, a = 1] = read("var(--bg-selected)");
    const bg = [r * a + sr * (1 - a), g * a + sg * (1 - a), b * a + sb * (1 - a)];
    const lum = ([x, y, z]: number[]) => {
      const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(x) + 0.7152 * f(y) + 0.0722 * f(z);
    };
    const [hi, lo] = [lum([fr, fg, fb]), lum(bg)].sort((m, n) => n - m);
    return (hi + 0.05) / (lo + 0.05);
  }, cssColor);
}

for (const theme of ["light", "dark"] as const) {
  test(`every Folder color keeps 3:1 on a checked row (${theme})`, async ({ page }) => {
    await openApp(page, { theme });
    for (const id of ["blue", "violet", "magenta", "red", "orange", "yellow", "green", "sky"]) {
      expect(await contrastOnSelectedRow(page, `var(--label-${id})`), id).toBeGreaterThanOrEqual(3);
    }
  });
}

type Calls = { __shardxMock: { calls: Record<string, number> } };
const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as unknown as Calls).__shardxMock.calls[c] ?? 0, cmd);
const deleteFolderDialog = async (page: Page, folder: string) => {
  await page.locator(`aside [data-folder='${folder}']`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  return page.getByRole("alertdialog", { name: `Delete folder “${folder}”?` });
};

test("deleting a Folder with its profiles stops them, moves them to the Trash, and one Undo brings all back", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.folderMeta", JSON.stringify({ Shops: { color: "green", icon: "cart" } })));
  await openApp(page);
  const dialog = await deleteFolderDialog(page, "Shops");
  await expect(dialog).toContainText("It holds 3 profiles. Keep them in “All profiles”, or move them to Trash with the folder.");
  await dialog.getByRole("button", { name: "Move profiles to Trash" }).click();
  const toast = page.locator("[data-toast]").filter({ hasText: 'Deleted “Shops” and moved 3 profiles to Trash' });
  await expect(toast).toBeVisible();
  // Amazon US seller and eBay DE buyer were running: stopped before the Trash.
  expect(await calls(page, "process_kill")).toBe(2);
  expect(await calls(page, "profile_delete")).toBe(3);
  await expect(page.locator("aside [data-folder='Shops']")).toHaveCount(0);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("aside [data-folder='Shops'] [data-count]")).toHaveText("3");
  await expect(page.locator("aside [data-folder='Shops'] [data-folder-icon]")).toHaveAttribute("data-folder-icon", "cart");
});

test("when a profile can't be moved to the Trash, the Folder stays with it", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = { profile_delete: 1 }; });
  await openApp(page);
  const dialog = await deleteFolderDialog(page, "Shops");
  await dialog.getByRole("button", { name: "Move profiles to Trash" }).click();
  // G8: the title names the action; the backend's words are the detail.
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn’t move 1 of 3 profiles to Trash" })).toContainText("Mock failure: profile_delete");
  await expect(page.locator("aside [data-folder='Shops'] [data-count]")).toHaveText("1");
  expect(await calls(page, "folder_delete")).toBe(0);
});

test("Delete folder only keeps its profiles in All profiles", async ({ page }) => {
  await openApp(page);
  const dialog = await deleteFolderDialog(page, "Ads");
  await dialog.getByRole("button", { name: "Delete folder only" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: 'Deleted “Ads”. Its 3 profiles are in “All profiles”.' })).toBeVisible();
  await expect(page.locator("aside [data-folder='Ads']")).toHaveCount(0);
  await expect(page.locator("aside [data-nav='profiles'] [data-total]")).toHaveText("8");
});

test("SEC-14: deleting a Folder named like an object property restores the plain look on Undo, and never throws", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openApp(page);
  // Through the backend, not the New folder dialog (which would store an
  // explicit look first): "constructor" has no own key in folderMeta's
  // storage, so lookOf must read it as no look, never Object.prototype's.
  await page.evaluate(() =>
    (window as any).__TAURI_INTERNALS__.invoke("profile_set_folder", { id: "f62a9d43", folder: "constructor" }),
  );
  await page.reload();
  const dialog = await deleteFolderDialog(page, "constructor");
  await dialog.getByRole("button", { name: "Move profiles to Trash" }).click();
  const toast = page.locator("[data-toast]").filter({ hasText: 'Deleted “constructor” and moved 1 profile to Trash' });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("aside [data-folder='constructor'] [data-folder-icon]")).toHaveAttribute("data-folder-icon", "folder");
  expect(errors).toEqual([]);
});

test("when folder_delete fails after every profile reached the Trash, the Folder stays (kept, now empty) and Undo still restores into it", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = { folder_delete: 1 }; });
  await openApp(page);
  const dialog = await deleteFolderDialog(page, "Ads");
  await dialog.getByRole("button", { name: "Move profiles to Trash" }).click();
  // Honest error: the folder wasn't deleted, not a fake success.
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn’t delete folder “Ads”. It’s kept, now empty." })).toContainText("Mock failure: folder_delete");
  expect(await calls(page, "profile_delete")).toBe(3);
  expect(await calls(page, "folder_delete")).toBe(1);
  // The Folder is still registered (never forgotten) but now empty: the
  // backend has no profiles left tagged "Ads", they're all in the Trash.
  await expect(page.locator("aside [data-folder='Ads']")).toHaveCount(1);
  await expect(page.locator("aside [data-folder='Ads'] [data-count]")).toHaveText("0");
  const undo = page.locator("[data-toast]").filter({ hasText: "Moved 3 profiles to Trash" });
  await expect(undo).toBeVisible();
  await undo.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("aside [data-folder='Ads'] [data-count]")).toHaveText("3");
});

test("two Folder deletes overlapping (second while the first's Undo toast is still up) each restore only their own folder and profiles", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.folderMeta", JSON.stringify({ Shops: { color: "green", icon: "cart" } })));
  await openApp(page);
  const shopsDialog = await deleteFolderDialog(page, "Shops");
  await shopsDialog.getByRole("button", { name: "Move profiles to Trash" }).click();
  const shopsToast = page.locator("[data-toast]").filter({ hasText: 'Deleted “Shops” and moved 3 profiles to Trash' });
  await expect(shopsToast).toBeVisible();

  const adsDialog = await deleteFolderDialog(page, "Ads");
  await adsDialog.getByRole("button", { name: "Move profiles to Trash" }).click();
  const adsToast = page.locator("[data-toast]").filter({ hasText: 'Deleted “Ads” and moved 3 profiles to Trash' });
  await expect(adsToast).toBeVisible();
  // Both toasts stack: the second delete didn't replace or lose the first's Undo.
  await expect(shopsToast).toBeVisible();

  await shopsToast.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("aside [data-folder='Shops'] [data-count]")).toHaveText("3");
  await expect(page.locator("aside [data-folder='Shops'] [data-folder-icon]")).toHaveAttribute("data-folder-icon", "cart");
  // Ads is still gone: its own Undo hasn't run yet, and Shops's Undo didn't touch it.
  await expect(page.locator("aside [data-folder='Ads']")).toHaveCount(0);

  await adsToast.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("aside [data-folder='Ads'] [data-count]")).toHaveText("3");
  // Nothing lost across the overlap: all 8 profiles are back.
  await expect(page.locator("aside [data-nav='profiles'] [data-total]")).toHaveText("8");
});


test("the profile form's Folder picker creates a Folder that does not exist yet, and Save moves the profile in, as the tag picker does (owner, 2026-10-02)", async ({ page }) => {
  await openApp(page);
  const form = await openEditForm(page, "Sandbox");
  await form.locator("[data-property='folder'] button").first().click();
  const search = page.getByRole("combobox", { name: "Folder" });
  await search.fill("Clients");
  await expect(page.getByRole("option", { name: "Create folder “Clients”" })).toBeVisible();
  await search.press("Enter");
  await expect(form.locator("[data-property='folder'] button").first()).toContainText("Clients");
  // Manual save: the pick is the form's until Save; no Folder exists yet.
  await expect(page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='folder']")).not.toContainText("Clients");
  await expect(folder(page, "Clients")).toHaveCount(0);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='folder']")).toContainText("Clients");
  await expect(folder(page, "Clients")).toBeVisible();
});
