import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp, storedTags } from "./support/app";

// Ruling 18: a delete hides at once and offers Undo; the command runs when the toast goes.
const row = (page: Page, name: string) => page.locator("[role='row'][data-proxy-id]", { hasText: name });
const proxyExists = (page: Page, id: string) =>
  page.evaluate((i) => (window as unknown as { __shardxMock: { state: { proxies: { id: string }[] } } }).__shardxMock.state.proxies.some((p) => p.id === i), id);
const undoToast = (page: Page) => page.locator("[data-toast]").filter({ has: page.getByRole("button", { name: "Undo" }) });
const deleteFromMenu = async (page: Page, name: string) => {
  await row(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
};

test("deleting a proxy asks nothing, hides it, and Undo brings it back", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await deleteFromMenu(page, "Old datacenter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row(page, "Old datacenter")).toHaveCount(0);
  await expect(undoToast(page)).toContainText("Deleted “Old datacenter (expired)”");
  await undoToast(page).getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "Old datacenter")).toBeVisible();
  expect(await proxyExists(page, "px-dead")).toBe(true);
});

test("the delete happens when the toast goes without Undo", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await deleteFromMenu(page, "Old datacenter");
  expect(await proxyExists(page, "px-dead")).toBe(true);
  await undoToast(page).getByRole("button", { name: /Dismiss|Close/ }).click();
  await expect.poll(() => proxyExists(page, "px-dead")).toBe(false);
});

test("Cmd/Ctrl+Z undoes the newest delete", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await deleteFromMenu(page, "Old datacenter");
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+z");
  await expect(row(page, "Old datacenter")).toBeVisible();
});

test("leaving the window runs what is pending (pagehide)", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await deleteFromMenu(page, "Old datacenter");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => proxyExists(page, "px-dead")).toBe(false);
});

test("a proxy in use says who loses it and offers replacements (plan ruling 9)", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await deleteFromMenu(page, "DC Tokyo");
  const toast = undoToast(page);
  await expect(toast).toContainText("1 profile loses it.");
  await toast.getByRole("button", { name: "Assign replacements" }).click();
  await expect.poll(() => proxyExists(page, "px-jp-1")).toBe(false);
  await expect(page.getByRole("dialog", { name: /Assign a proxy/ })).toBeVisible();
});

test("while a delete waits, its profiles show the proxy as missing", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await deleteFromMenu(page, "DC Tokyo");
  await page.locator("aside [data-nav='profiles']").click();
  const acc02 = page.locator("[role='row'][data-profile-id]", { hasText: "FB Ads acc-02" });
  await expect(acc02.locator("[data-cell='proxy']")).toContainText(/missing/i);
});

test("bulk delete is one toast with one Undo", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  for (const n of ["DC New York", "Old datacenter"]) await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: /Delete/ }).click();
  await expect(undoToast(page)).toHaveCount(1);
  await expect(undoToast(page)).toContainText("Deleted 2 proxies");
  await undoToast(page).getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "DC New York")).toBeVisible();
  await expect(row(page, "Old datacenter")).toBeVisible();
  // The deleted rows left the selection; Undo puts them back in it (owner rule).
  await expect(page.getByRole("toolbar", { name: /selected/ })).toContainText("2 selected");
});

const confirmsOpened = (page: Page) => page.getByRole("alertdialog").or(page.getByRole("dialog", { name: /Delete|Remove/ }));

test("bookmarks, extensions and fingerprints delete behind Undo, with no confirm", async ({ page }) => {
  for (const [section, rowSel] of [["bookmarks", "[role='row'][data-row-id]"], ["extensions", "[data-row-id]"]] as const) {
    await openApp(page, { section });
    await page.locator("main").waitFor();
    if ((await page.locator(rowSel).count()) === 0) continue;
    const first = page.locator(rowSel).first();
    const id = (await first.getAttribute("data-row-id"))!;
    // Focus makes it the active row without opening anything (Task 23).
    await first.focus();
    await page.keyboard.press("Delete");
    await expect(confirmsOpened(page)).toHaveCount(0);
    await expect(page.locator(`[data-row-id='${id}']`)).toHaveCount(0);
    await undoToast(page).getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(`[data-row-id='${id}']`)).toHaveCount(1);
  }
  // Every seeded fingerprint is built-in (it can't go) and the grid takes no
  // Delete key, so an imported one goes from its card's menu.
  await openApp(page, { section: "fingerprints" });
  await page.evaluate(() => {
    const m = (window as unknown as { __shardxMock: { state: { fingerprints: { id: string; label: string; builtin: boolean }[] }; save: () => void } }).__shardxMock;
    m.state.fingerprints.push({ ...m.state.fingerprints[0], id: "imported-1", label: "Imported macOS", builtin: false });
    m.save();
  });
  await page.reload();
  const card = page.locator("[data-fingerprint-id='imported-1']");
  await card.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove fingerprint" }).click();
  await expect(confirmsOpened(page)).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(undoToast(page)).toContainText("Removed “Imported macOS”");
  await undoToast(page).getByRole("button", { name: "Undo" }).click();
  await expect(card).toHaveCount(1);
});

test("a tag in use deletes behind Undo and comes back with its profiles", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.tags", JSON.stringify({
    version: 1, tags: [{ id: "t1", name: "warm-up", color: "green" }], byProfile: { aed41005: ["t1"], c31d92f0: ["t1"] },
  })));
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Tags" }).click();
  await page.locator("[data-tag-row='t1']").getByRole("button", { name: /Delete/ }).click();
  await expect(confirmsOpened(page)).toHaveCount(0);
  await expect(page.locator("[data-tag-row='t1']")).toHaveCount(0);
  await undoToast(page).getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-tag-row='t1']")).toBeVisible();
  await expect.poll(async () => (await storedTags(page)).by_profile.aed41005).toEqual(["t1"]);
});

test("Undo of a tag whose name was taken since gives its profiles the tag that has the name", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.tags", JSON.stringify({
    version: 1, tags: [{ id: "t1", name: "warm-up", color: "green" }], byProfile: { aed41005: ["t1"] },
  })));
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Tags" }).click();
  await page.locator("[data-tag-row='t1']").getByRole("button", { name: /Delete/ }).click();
  await expect(page.locator("[data-tag-row='t1']")).toHaveCount(0);
  await expect.poll(async () => (await storedTags(page)).tags.length).toBe(0);
  // Made again under the same name (a picker elsewhere) while the Undo is still on offer.
  await appModule(page, "/src/entities/tag/index.ts", "__tag");
  await page.evaluate(() => {
    (window as unknown as { __tag: { useTags: { getState: () => { create: (n: string, c: string) => unknown } } } })
      .__tag.useTags.getState().create("Warm-up", "blue");
  });
  await undoToast(page).getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => {
    const s = await storedTags(page);
    return { names: s.tags.map((t) => t.name), on: s.by_profile.aed41005?.map((id) => s.tags.find((t) => t.id === id)?.name) };
  }).toEqual({ names: ["Warm-up"], on: ["Warm-up"] });
  await expect(page.locator("[data-tag-row]")).toHaveCount(1);
  await expect(page.locator("[data-toast]", { hasText: "Couldn’t save tags" })).toHaveCount(0);
});

test("the confirms left are the three the rules keep", async ({ page }) => {
  await openApp(page, { section: "trash" });
  await page.locator("main header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Empty trash/i }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
});
