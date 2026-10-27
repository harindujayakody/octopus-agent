import { expect, test, type Page } from "@playwright/test";
import { openApp, openEditForm, storedTags } from "./support/app";

// Every picker is the kit Combobox (IFACE-04, EMIL-08, EMIL-09): type to
// filter, the first match is highlighted, the arrows move, Enter picks,
// creating is the explicit last row or Cmd/Ctrl+Enter.
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const seedTags = (page: Page, value: unknown) => page.addInitScript((v) => {
  if (localStorage.getItem("shardx.tags") === null) localStorage.setItem("shardx.tags", JSON.stringify(v));
}, value);
const TAGS = {
  version: 1,
  tags: [
    { id: "t-warm", name: "Warm-up", color: "orange" },
    { id: "t-wallet", name: "wallet", color: "green" },
    { id: "t-2fa", name: "needs 2fa", color: "red" },
  ],
  byProfile: {},
};
const tagNames = async (page: Page) => (await storedTags(page)).tags.map((t) => t.name);
const chips = (page: Page, name: string) => row(page, name).locator("[data-cell='tags'] [data-tag]");

test("T, w, Enter gives the first match and creates nothing (EMIL-08)", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("t");
  const field = page.getByRole("combobox", { name: "Find or create a tag" });
  await expect(field).toBeFocused();
  await page.keyboard.type("w");
  await page.keyboard.press("Enter");
  await expect(chips(page, "Sandbox")).toHaveText(["Warm-up"]);
  expect(await tagNames(page)).not.toContain("w");
});

test("the arrows pick another match; Create is the last row; Cmd/Ctrl+Enter creates", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("t");
  await page.keyboard.type("wa");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(chips(page, "Sandbox")).toHaveText(["wallet"]);
  const field = page.getByRole("combobox", { name: "Find or create a tag" });
  await field.fill("vip");
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveText([/Create “vip”/]);
  await page.keyboard.press("Enter");
  await field.fill("warm");
  await page.keyboard.press("ControlOrMeta+Enter"); // create "warm" although "Warm-up" matches
  await expect.poll(() => tagNames(page)).toEqual(expect.arrayContaining(["vip", "warm"]));
});

test("a typed name is single-spaced and cut to 32 characters before it is compared (PC-085)", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("t");
  const field = page.getByRole("combobox", { name: "Find or create a tag" });
  await page.keyboard.type("needs   2fa");
  await expect(field).toHaveValue("needs 2fa");
  await expect(page.getByRole("option", { name: /Create/ })).toHaveCount(0);
  await field.fill("");
  await page.keyboard.type("x".repeat(40));
  await expect(field).toHaveValue("x".repeat(32));
});

test("a click anywhere on a tag's row toggles it (FEEL-25)", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("t");
  const option = page.getByRole("option", { name: /needs 2fa/ });
  const box = (await option.boundingBox())!;
  await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2);
  await expect(chips(page, "Sandbox")).toHaveText(["needs 2fa"]);
});

test("several profiles: a tag some of them have is mixed, and a pick gives it to all", async ({ page }) => {
  await seedTags(page, { ...TAGS, byProfile: { f62a9d43: ["t-warm"] } });
  await openApp(page);
  for (const n of ["Sandbox", "Etsy craft shop"]) await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "Edit tags" }).click();
  // The kit shows a mixed option as not selected, with the word "Some".
  const warm = page.getByRole("option", { name: /Warm-up/ });
  await expect(warm).toHaveAttribute("aria-selected", "false");
  await expect(warm).toContainText("Some");
  await warm.click();
  await expect(warm).toHaveAttribute("aria-selected", "true");
  await expect(chips(page, "Etsy craft shop")).toHaveText(["Warm-up"]);
});

// R16: the profile form's Tags row opens the same picker. Taking a tag off
// keeps the keys in the picker; Esc gives them back to the row (focus never
// falls to the page). The pick is the form's until Save.
test("the form's Tags row: taking a tag off keeps focus in the picker; Esc returns it to the row", async ({ page }) => {
  await seedTags(page, { ...TAGS, byProfile: { f62a9d43: ["t-warm"] } });
  await openApp(page);
  const form = await openEditForm(page, "Sandbox");
  const tagsRow = form.locator("[data-property='tags'] button");
  await tagsRow.click();
  const field = page.getByRole("combobox", { name: "Find or create a tag" });
  await expect(field).toBeFocused();
  await page.keyboard.press("Enter"); // the first row, Warm-up, comes off
  await expect(tagsRow).toHaveAccessibleName("Tags No tags");
  await expect(field).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Tags" })).toHaveCount(0);
  await expect(tagsRow).toBeFocused();
  // Only the picker closed: the form is still open, with its change unsaved.
  await expect(form).toBeVisible();
  expect(await tagNames(page)).toEqual(["Warm-up", "wallet", "needs 2fa"]);
});

const folderPicker = (page: Page) => page.getByRole("dialog", { name: "Move to folder" });

test("M, Ads, Enter moves the row to Ads (EMIL-09)", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("m");
  const field = folderPicker(page).getByRole("combobox", { name: "Find or create a folder" });
  await expect(field).toBeFocused();
  await page.keyboard.type("Ads");
  await page.keyboard.press("Enter");
  await expect(folderPicker(page)).toHaveCount(0);
  await page.locator("aside [data-folder='Ads']").click();
  await expect(row(page, "Sandbox")).toHaveCount(1);
});

test("the picker lists Folders with their look and count; the arrows pick one", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("m");
  const options = folderPicker(page).getByRole("option");
  await expect(options).toHaveText([/^Ads.*3/, /^Shops.*3/]);
  // Each Folder is its chip: one look for a Folder everywhere (owner 5t).
  await expect(options.first().locator("[data-folder-chip]")).toHaveText("Ads");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.locator("aside [data-folder='Shops']").click();
  await expect(row(page, "Sandbox")).toHaveCount(1);
});

test("Create folder “x” opens the Folder dialog with the name; Create moves the rows into it", async ({ page }) => {
  await openApp(page);
  for (const n of ["Sandbox", "Scraper pricing"]) await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "Move to folder" }).click();
  await expect(folderPicker(page).getByRole("combobox", { name: "Find or create a folder" })).toBeFocused();
  await page.keyboard.type("Crypto");
  await expect(folderPicker(page).getByRole("option")).toHaveText([/Create folder “Crypto”/]);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Crypto");
  await page.keyboard.press("Enter"); // the dialog is a form (C Task 20)
  // The selection stays as it was (owner rule: bulk actions keep it).
  await expect(page.getByRole("toolbar", { name: /selected/ })).toContainText("2 selected");
  await page.locator("aside [data-folder='Crypto']").click();
  await expect(row(page, "Sandbox")).toHaveCount(1);
  await expect(row(page, "Scraper pricing")).toHaveCount(1);
});

// E4, Task 18: P is a search over the proxies that the keyboard finishes.
test("P, the arrows and Enter bind a proxy, all from the keyboard (IFACE-04)", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("p");
  const field = page.getByRole("dialog", { name: "Proxy" }).getByRole("combobox", { name: "Proxy" });
  await expect(field).toBeFocused();
  // No proxy is Sandbox's value and the first row; DC Tokyo is four down.
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: /^DC Tokyo/ })).toHaveAttribute("data-highlighted", "");
  await page.keyboard.press("Enter");
  await expect(row(page, "Sandbox").locator("[data-cell='proxy']")).toContainText("DC Tokyo");
});

test("P finds a proxy by host or country, and a pasted line adds and binds a new one", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").focus();
  await page.keyboard.press("p");
  const field = page.getByRole("dialog", { name: "Proxy" }).getByRole("combobox", { name: "Proxy" });
  await field.fill("198.51");
  await expect(page.getByRole("option").first()).toHaveAccessibleName(/^ISP Frankfurt/);
  // A plain search never ends in "Add proxy".
  await expect(page.getByRole("option", { name: /Add proxy/ })).toHaveCount(0);
  await field.fill("192.0.2.200:1080");
  await expect(page.getByRole("option")).toHaveText([/Add proxy “192\.0\.2\.200:1080”/]);
  await page.keyboard.press("Enter");
  await expect(row(page, "Sandbox").locator("[data-cell='proxy']")).toContainText("192.0.2.200");
});

test("Spread: search, Unused only, and each proxy's last test (IFACE-03)", async ({ page }) => {
  await openApp(page);
  for (const n of ["Sandbox", "Scraper pricing"]) await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: /Assign proxies/ }).click();
  const dialog = page.getByRole("dialog", { name: /Assign/ });
  const list = dialog.getByRole("combobox", { name: "Proxies to spread" });
  // Unused only starts on (F12: never share by default); DC Tokyo is FB Ads acc-02's.
  await dialog.getByRole("checkbox", { name: "Unused only" }).uncheck();
  await list.fill("tokyo");
  await expect(dialog.getByRole("option")).toHaveText([/^DC Tokyo/]);
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("option", { name: /^DC Tokyo/ })).toHaveAttribute("aria-selected", "true");
  await list.fill("");
  await dialog.getByRole("checkbox", { name: "Unused only" }).check();
  // Every listed proxy is bound to no profile.
  await expect(dialog.getByRole("option", { name: /^ProxyShard resi US/ })).toHaveCount(0);
  // The expired proxy's last test failed, and says so.
  await expect(dialog.getByRole("option", { name: /^Old datacenter/ })).toContainText("Failed");
});

// Extensions are global: the profile form's Extensions tab only lists what
// the profile's browser gets, with nothing to pick.
test("the form's extensions: the library, with nothing to pick", async ({ page }) => {
  await openApp(page);
  const form = await openEditForm(page, "Sandbox", "Extensions");
  await expect(form.locator("[data-extensions-global]")).toContainText("pinned on its toolbar");
  await expect(form.getByRole("combobox", { name: "Extensions" })).toHaveCount(0);
});
