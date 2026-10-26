import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle } from "./support/app";

const folderItem = (page: Page, name: string) => page.locator(`aside [data-folder='${name}']`);
// The list's row.
const listed = (page: Page, name: string) => page.getByRole("treegrid", { name: "Profiles" }).getByText(name, { exact: true });

test("the sidebar lists the Folders; choosing one shows only its profiles", async ({ page }) => {
  await openApp(page);
  await expect(folderItem(page, "Ads")).toBeVisible();
  await expect(folderItem(page, "Shops")).toBeVisible();
  await folderItem(page, "Shops").click();
  await expect(page.locator("main header h1")).toHaveText("Shops");
  await expect(listed(page, "Etsy craft shop")).toBeVisible();
  await expect(page.getByText("Sandbox", { exact: true })).toHaveCount(0);
});

test("choosing a Folder from another page opens Profiles", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await folderItem(page, "Ads").click();
  await expect(page.locator("main[data-section='profiles'] header h1")).toHaveText("Ads");
});

test("dragging a profile onto a Folder moves it there", async ({ page }) => {
  await openApp(page);
  await expect(folderItem(page, "Ads").locator("[data-count]")).toHaveText("3");
  await listed(page, "Etsy craft shop").dragTo(folderItem(page, "Ads"));
  await expect(folderItem(page, "Ads").locator("[data-count]")).toHaveText("4");
  await expect(folderItem(page, "Shops").locator("[data-count]")).toHaveText("2");
});

test("dragging a profile onto All profiles takes it out of its Folder", async ({ page }) => {
  await openApp(page);
  await listed(page, "Etsy craft shop").dragTo(page.locator("aside [data-nav='profiles']"));
  await expect(folderItem(page, "Shops").locator("[data-count]")).toHaveText("2");
});

test("right-clicking a Folder offers to delete it", async ({ page }) => {
  await openApp(page);
  await folderItem(page, "Ads").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Delete folder" })).toBeVisible();
});

test("+ beside Folders creates a Folder", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New folder" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

// Owner feedback 5r (2026-09-26, relayed by shard-64, tooltip "New folder"
// over a bare + icon): "tooltip says folder but its plus icon on profiles."
test("the Folders heading button shows a folder glyph, not a bare plus", async ({ page }) => {
  await openApp(page);
  const button = page.locator("aside").getByRole("button", { name: "New folder" });
  await expect(button.locator("svg")).toHaveAttribute("data-icon", "folder-add");
});

test("running count stays current on other pages", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  // The sidebar says how many run through the Running View ("Running 2", a
  // word beside the number) and "2/8" in All profiles (owner).
  const running = page.locator("aside [data-view='builtin:running'] [data-count]");
  await expect(running).toHaveText("2");
  // Started outside the UI (as the HTTP API or MCP would): only polling can see it.
  await page.evaluate(() =>
    (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } })
      .__TAURI_INTERNALS__.invoke("launch", { profileId: "aed41005" }),
  );
  await expect(running).toHaveText("3");
});

test("once every running profile stops, nothing in the sidebar says running", async ({ page }) => {
  await openApp(page);
  // All profiles' "2/8" and Amazon US seller, pinned.
  await expect(page.locator("aside [data-running]")).toHaveCount(2);
  await page.evaluate(() =>
    (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } })
      .__TAURI_INTERNALS__.invoke("sync_stop", { group: "" }),
  );
  await expect(page.locator("aside [data-running]")).toHaveCount(0);
  await expect(page.locator("aside [data-view='builtin:running'] [data-count]")).toHaveText("0");
  // No "0 running" anywhere, not even in a tooltip: All profiles is a plain item again.
  await page.locator("aside [data-nav='profiles']").hover();
  // Past the tooltip's 400 ms hover delay: an absence needs the wait.
  await page.waitForTimeout(600);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("in the rail the running count folds into All profiles' own name, so nothing is lost", async ({ page }) => {
  // No group header at all in the compact rail (Task 5l): the running count
  // has to live somewhere, so it joins the item's own accessible name and
  // tooltip instead. The rail is the user's choice (Mod+\, Task 8a).
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+Backslash");
  const allProfiles = page.locator("aside [data-nav='profiles']");
  await expect(allProfiles).toHaveAccessibleName(/running/);
  await allProfiles.hover();
  await expect(page.getByRole("tooltip")).toContainText("running");
});

test("the API status word opens Settings", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: /^API on/ }).click();
  await page.getByRole("button", { name: "API & MCP settings" }).click();
  await expect(page.locator("main[data-section='settings']")).toBeVisible();
});

// Fix round 1, item 3 (WCAG 2.5.3 label in name): a speech-input user who
// says the visible label ("API on") must reach this control. The accessible
// name has to start with that word, not bury it after "Automation API:".
test("the API status button's accessible name starts with its visible word", async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole("button", { name: /^API on/ })).toHaveAccessibleName(/^API on\b/);
});

test("in the rail the sidebar shows icons with tooltips", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+Backslash");
  await expect.poll(async () => (await page.locator("aside").boundingBox())?.width).toBe(56);
  await page.locator("aside [data-nav='proxies']").hover();
  // With its Go to key (Pair 44, mp4 review M11): the label and the key cap
  // are two parts with a gap between them. Their text runs together
  // ("ProxiesG P"), so each part is read on its own.
  const tip = page.getByRole("tooltip");
  const keys = tip.locator("kbd");
  const label = keys.locator("xpath=preceding-sibling::span[1]");
  await expect(label).toHaveText("Proxies");
  await expect(keys).toHaveText("G P");
  await expect.poll(async () => {
    const [l, k] = [await label.boundingBox(), await keys.boundingBox()];
    return l && k ? k.x - (l.x + l.width) : 0;
    // 7 px since vf-g's K6 (never bigger: the cap gap rounds down).
  }, { message: "a visible gap between the label and the keys" }).toBeGreaterThanOrEqual(7);
});

test("in the rail a Folder can still be created from the sidebar", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+Backslash");
  const button = page.locator("aside").getByRole("button", { name: "New folder" });
  // Same folder-add glyph in the compact rail's own New folder item.
  await expect(button.locator("svg")).toHaveAttribute("data-icon", "folder-add");
  await button.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("the Profiles table header has one cell per row cell", async ({ page }) => {
  await openApp(page);
  await waitForIdle(page);
  const headers = await page.getByRole("columnheader").count();
  const cells = await page.locator("[role='row'][data-profile-id]").first().getByRole("gridcell").count();
  expect(headers).toBeGreaterThan(0);
  expect(headers).toBe(cells);
});

// Polish PL4: text dragged in from elsewhere is not a profile id.
test("foreign text dropped on a Folder moves nothing", async ({ page }) => {
  await openApp(page);
  await folderItem(page, "Ads").click();
  const before = await page.locator("[role='row'][data-profile-id]").count();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "not-a-profile");
    const target = document.querySelector("aside [data-folder='Shops']")!;
    target.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(300);
  await expect(page.locator("[role='row'][data-profile-id]")).toHaveCount(before);
  await expect(page.getByText("not-a-profile")).toHaveCount(0);
});
