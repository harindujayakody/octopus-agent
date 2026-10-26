import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, openEditForm, reloadApp, storedTags, waitForIdle } from "./support/app";
import { filterBy } from "./support/filters";
import { openSearch } from "./support/search";

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const seedTags = (page: Page, value: unknown) => page.addInitScript((v) => {
  if (localStorage.getItem("shardx.tags") === null) localStorage.setItem("shardx.tags", JSON.stringify(v));
}, value);
const TAGS = {
  version: 1,
  tags: [{ id: "t-warm", name: "Warm-up", color: "orange" }, { id: "t-vip", name: "VIP", color: "violet" }],
  byProfile: { f62a9d43: ["t-warm"], aed41005: ["t-warm", "t-vip"] },
};

test("tags show in the Tags column, and survive a reload", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await expect(row(page, "Sandbox").locator("[data-cell='tags'] [data-tag]")).toHaveText(["Warm-up"]);
  await expect(row(page, "Etsy craft shop").locator("[data-cell='tags'] [data-tag]")).toHaveText(["Warm-up", "VIP"]);
  await page.reload();
  await expect(row(page, "Sandbox").locator("[data-cell='tags'] [data-tag]")).toHaveText(["Warm-up"]);
});

test("the search finds profiles by tag name", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await (await openSearch(page)).fill("vip");
  await expect(page.locator("[role='row'][data-profile-id]")).toHaveCount(1);
  await expect(row(page, "Etsy craft shop")).toBeVisible();
});

test("a broken tags value means no tags, not a broken app", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.tags", "{not json"));
  await openApp(page);
  await expect(row(page, "Sandbox")).toBeVisible();
  await expect(page.locator("[data-cell='tags'] [data-tag]")).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Tags" })).toHaveCount(0);
});

test("tags an older build kept move to the backend once: the key goes, and a second hand-over changes nothing", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await expect(row(page, "Etsy craft shop").locator("[data-cell='tags'] [data-tag]")).toHaveText(["Warm-up", "VIP"]);
  const moved = await storedTags(page);
  expect(moved.tags.map((t) => t.id)).toEqual(["t-warm", "t-vip"]);
  expect(moved.by_profile).toEqual(TAGS.byProfile);
  expect(await page.evaluate(() => localStorage.getItem("shardx.tags"))).toBeNull();
  // The key back with other tags (an older build run since): handed over, ignored, gone.
  await page.evaluate(() => localStorage.setItem("shardx.tags", JSON.stringify({
    version: 1, tags: [{ id: "t-old", name: "Old", color: "red" }], byProfile: { f62a9d43: ["t-old"] },
  })));
  await reloadApp(page);
  await expect(row(page, "Sandbox").locator("[data-cell='tags'] [data-tag]")).toHaveText(["Warm-up"]);
  expect(await storedTags(page)).toEqual(moved);
  expect(await page.evaluate(() => localStorage.getItem("shardx.tags"))).toBeNull();
});

test("the profile form gives a new tag and takes one away, and Save writes them", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  const form = await openEditForm(page, "Sandbox");
  // Task 14: the Tags row opens the picker in place; its rows give and take.
  const tagsRow = form.locator("[data-property='tags'] button");
  await tagsRow.click();
  // Nothing is named "Farm": Enter takes the Create row, the only one (E16).
  await page.getByRole("combobox", { name: "Find or create a tag" }).fill("Farm");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(form.locator("[data-property='tags'] [data-tag]")).toHaveText(["Warm-up", "Farm"]);
  await tagsRow.click();
  await page.getByRole("option", { name: /Warm-up/ }).click();
  await page.keyboard.press("Escape");
  await expect(form.locator("[data-property='tags'] [data-tag]")).toHaveText(["Farm"]);
  // Manual save: the list keeps the old tags until Save.
  await expect(row(page, "Sandbox").locator("[data-cell='tags'] [data-tag]")).toHaveText(["Warm-up"]);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  // Beside Peek the list would hide its Tags column; Peek is closed here.
  await expect(row(page, "Sandbox").locator("[data-cell='tags'] [data-tag]")).toHaveText(["Farm"]);
});

test("T opens the picker for the active row; a name already used picks that tag", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await row(page, "Scraper pricing").locator("[data-cell='status']").click();
  await page.keyboard.press("t");
  await page.getByRole("combobox", { name: "Find or create a tag" }).fill("vip");
  await page.keyboard.press("Enter");
  // The first Esc clears what was typed, the second closes (the kit Combobox).
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(row(page, "Scraper pricing").locator("[data-cell='tags'] [data-tag]")).toHaveText(["VIP"]);
  await expect.poll(async () => (await storedTags(page)).by_profile.e51f8c32).toEqual(["t-vip"]);
  expect((await storedTags(page)).tags).toHaveLength(2);
  await expect(row(page, "Scraper pricing")).toBeFocused();
});

// The list's picker stays mounted through its exit (FEEL-01). Opened on
// another row while it leaves, it is that row's, and starts fresh: never the
// leaving row's profiles or the text typed there (Pair 11 review, Minor 3).
test("the tag picker opened on another row while one leaves is that row's, fresh", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  if (await page.locator("aside[data-peek]").count()) await page.keyboard.press("Escape");
  await page.keyboard.press("t");
  const find = page.getByRole("combobox", { name: "Find or create a tag" });
  await find.fill("Warm");
  await expect(page.getByRole("dialog").getByRole("option", { name: /Warm-up/ })).toHaveAttribute("aria-selected", "true");
  // The press closes Sandbox's picker, the double-click opens Scraper
  // pricing's (a plain click opens Peek, EMIL-12).
  await row(page, "Scraper pricing").locator("[data-cell='tags']").dblclick();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(find).toHaveValue("");
  await expect(page.getByRole("dialog").getByRole("option", { name: /Warm-up/ })).toHaveAttribute("aria-selected", "false");
});

test("the bulk bar's Tags shows mixed state and gives a tag to every selected profile", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  for (const n of ["Sandbox", "Etsy craft shop", "Scraper pricing"]) await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "Edit tags" }).click();
  // Mixed: not selected, with the word "Some" (the kit Combobox).
  const vip = page.getByRole("option", { name: /VIP/ });
  await expect(vip).toHaveAttribute("aria-selected", "false");
  await expect(vip).toContainText("Some");
  await vip.click();
  await expect(vip).toHaveAttribute("aria-selected", "true");
  for (const n of ["Sandbox", "Etsy craft shop", "Scraper pricing"]) {
    await expect(row(page, n).locator("[data-cell='tags']")).toContainText("VIP");
  }
});

test("a tag stays on a profile moved to the Trash and brought back", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  await page.keyboard.press("Delete");
  await page.locator("[data-toast]").getByRole("button", { name: "Undo" }).click();
  await expect(row(page, "Sandbox").locator("[data-cell='tags'] [data-tag]")).toHaveText(["Warm-up"]);
});

test("the Tag filter keeps the profiles with that tag", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await filterBy(page, "Tag", "Warm-up");
  await expect(page.locator("[role='row'][data-profile-id]")).toHaveCount(2);
});

test("Settings > Tags renames, recolors and deletes a tag", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Tags" }).click();
  const warm = page.locator("[data-tag-row='t-warm']");
  await warm.getByRole("textbox", { name: "Name of the tag “Warm-up”" }).fill("Warming");
  await warm.getByRole("radio", { name: "green" }).click();
  // The rename and the color wait for Save (manual save).
  await page.locator("[data-save-bar]").getByRole("button", { name: "Save", exact: true }).click();
  await expect(warm).toContainText("2 profiles");
  await page.locator("[data-tag-row='t-vip']").getByRole("button", { name: /Delete/ }).click();
  // Nothing asked (ruling 18): the Undo toast says who loses it.
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator("[data-toast]").filter({ has: page.getByRole("button", { name: "Undo" }) })).toContainText("1 profile loses it.");
  await page.locator("aside").getByText("All profiles", { exact: true }).click();
  await expect(row(page, "Etsy craft shop").locator("[data-cell='tags'] [data-tag]")).toHaveText(["Warming"]);
  await expect(row(page, "Etsy craft shop").locator("[data-tag]")).toHaveAttribute("data-color", "green");
});

test("a profile deleted for good from the Trash takes its tags with it", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await row(page, "Sandbox").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  // The row leaves at once; the Undo toast says the move has landed.
  await expect(page.locator("[data-toast]").getByRole("button", { name: "Undo" })).toBeVisible();
  const stored = async () => (await storedTags(page)).by_profile;
  // In the Trash it keeps them: Undo or Restore brings them back.
  expect((await stored()).f62a9d43).toEqual(["t-warm"]);
  await page.locator("aside").getByText("Trash", { exact: true }).click();
  await page.locator("main header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Empty Trash" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Empty Trash" }).click();
  await expect.poll(async () => (await stored()).f62a9d43).toBeUndefined();
  expect((await stored()).aed41005).toEqual(["t-warm", "t-vip"]);
});

test("deleting the tag the list is filtered by clears that filter", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await filterBy(page, "Tag", "VIP");
  await expect(page.locator("[role='row'][data-profile-id]")).toHaveCount(1);
  await page.locator("aside").getByText("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Tags" }).click();
  await page.locator("[data-tag-row='t-vip']").getByRole("button", { name: /Delete/ }).click();
  await page.locator("aside").getByText("All profiles", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Filters", exact: true })).toBeVisible();
  expect(await page.locator("[role='row'][data-profile-id]").count()).toBeGreaterThan(1);
});

test("the bulk bar's picker keeps its profiles until closed, and never reopens by itself", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  const search = await openSearch(page);
  await search.fill("vip");
  await row(page, "Etsy craft shop").locator("[data-cell='checkbox'] input").check({ force: true });
  const bar = page.getByRole("toolbar", { name: /selected/ });
  await bar.getByRole("button", { name: "Edit tags" }).click();
  const picker = page.getByRole("dialog", { name: "Tags" });
  // Taking VIP off hides Etsy from the "vip" search; the picker stays on it.
  await picker.getByRole("option", { name: /VIP/ }).click();
  await expect(picker.getByRole("option", { name: /VIP/ })).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await search.fill("");
  await row(page, "Sandbox").locator("[data-cell='checkbox'] input").check({ force: true });
  await expect(bar).toContainText("1 selected");
  await expect(picker).toHaveCount(0);
  await bar.getByRole("button", { name: "Edit tags" }).click();
  await picker.getByRole("option", { name: /VIP/ }).click();
  await expect.poll(async () => (await storedTags(page)).by_profile.f62a9d43).toEqual(["t-warm", "t-vip"]);
  expect((await storedTags(page)).by_profile.aed41005).toEqual(["t-warm"]);
});

test("T on a selection scrolled out of view opens the picker in sight, and Esc gives the keys back to the list", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockProfiles: number }).__shardxMockProfiles = 80; });
  await seedTags(page, TAGS);
  await openApp(page);
  await row(page, "Amazon US seller").locator("[data-cell='checkbox'] input").check({ force: true });
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  await page.keyboard.press("End");
  const active = page.locator("[role='row'][data-active]");
  await expect(active).toBeFocused();
  await expect(row(page, "Amazon US seller")).toHaveCount(0);
  await page.keyboard.press("t");
  const picker = page.getByRole("dialog", { name: "Tags" });
  await expect(picker).toBeInViewport();
  await expect(picker.getByRole("combobox", { name: "Find or create a tag" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  const before = await active.getAttribute("data-profile-id");
  await page.keyboard.press("ArrowUp");
  await expect(active).not.toHaveAttribute("data-profile-id", before!);
});

test("tags of profiles deleted for good elsewhere are dropped at start; the Trash keeps its own", async ({ page }) => {
  await seedTags(page, { ...TAGS, byProfile: { ...TAGS.byProfile, gone1: ["t-vip"], "t-1": ["t-warm"] } });
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Tags" }).click();
  await expect(page.locator("[data-tag-row='t-vip']")).toContainText("1 profile");
  await expect.poll(async () => Object.keys((await storedTags(page)).by_profile).sort()).toEqual(["aed41005", "f62a9d43", "t-1"]);
});

test("Settings > Tags: an Enter that confirms an input method's text does not rename", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "Tags" }).click();
  const field = page.locator("[data-tag-row='t-warm']").getByRole("textbox", { name: "Name of the tag “Warm-up”" });
  await field.fill("Warming");
  await field.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  // WebKit (macOS) sends that Enter after the composition ends, as key code 229.
  await field.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  const stored = async () => (await storedTags(page)).tags[0].name;
  expect(await stored()).toBe("Warm-up");
  // Save is the commit, and Enter is not one: the typed name waits for the bar.
  await field.press("Enter");
  expect(await stored()).toBe("Warm-up");
  await page.locator("[data-save-bar]").getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(stored).toBe("Warming");
});

test("the tag picker: an Enter that confirms an input method's text creates nothing", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  await page.keyboard.press("t");
  const find = page.getByRole("combobox", { name: "Find or create a tag" });
  await find.fill("新");
  await find.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  await expect(page.getByRole("option", { name: /Create/ })).toBeVisible();
  await waitForIdle(page);
  expect((await storedTags(page)).tags).toHaveLength(2);
});

test("a row's Tags cell and its menu's Edit tags open the picker for that row", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  const picker = page.getByRole("dialog", { name: "Tags" });
  // A double-click on the cell opens it (a plain click opens Peek, EMIL-12).
  await row(page, "Sandbox").locator("[data-cell='tags']").dblclick();
  await picker.getByRole("option", { name: /VIP/ }).click();
  // The double-click's first press opened Peek, and the Tags cell beside it
  // is narrower: VIP may fold into "+1", which still names it.
  await expect(row(page, "Sandbox").locator("[data-cell='tags']")).toHaveText(/Warm-up.*VIP/);
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await row(page, "Scraper pricing").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit tags" }).click();
  await picker.getByRole("option", { name: /Warm-up/ }).click();
  await expect(row(page, "Scraper pricing").locator("[data-cell='tags'] [data-tag]")).toHaveText(["Warm-up"]);
});

test("a click anywhere on a tag row toggles it once; its box toggles it once", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  const form = await openEditForm(page, "Sandbox");
  await form.locator("[data-property='tags'] button").click();
  const item = page.getByRole("option", { name: /VIP/ });
  // The box is drawn only (aria-hidden): the row is the one target (E16).
  const box = item.locator("span[aria-hidden='true']").first();
  await expect(item).toHaveAttribute("aria-selected", "false");
  await item.locator("[data-tag='t-vip']").click();
  await expect(item).toHaveAttribute("aria-selected", "true");
  const w = (await item.boundingBox())!.width;
  await item.click({ position: { x: w - 6, y: 15 } });
  await expect(item).toHaveAttribute("aria-selected", "false");
  await box.click();
  await expect(item).toHaveAttribute("aria-selected", "true");
});

// Pair 12 review: in a list whose rows are whole-row labels, a click just
// under a row's box (box bottom + 2 px or lower, still inside that row)
// toggles that row, never the next one. The box's own 29 px hit area used
// to reach 3 px (ExtensionPicker) and 1.5 px (TagPicker) into the row above.
test("a click just under a box in a tight row list toggles that row, not the next", async ({ page }) => {
  await seedTags(page, TAGS);
  await openApp(page);
  // An option row of a multiple Combobox: its box is drawn only, the row
  // is the one target.
  const probe = async (first: Locator, next: Locator) => {
    // In the middle of its scroll box, clear of any edge that clips it.
    await first.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const box = (await first.locator("span[aria-hidden='true']").first().boundingBox())!;
    const r = (await first.boundingBox())!;
    const y = r.y + r.height - 1;
    expect(y, "the probe sits at least 2 px under the box").toBeGreaterThanOrEqual(box.y + box.height + 2);
    const [wasFirst, wasNext] = [await first.getAttribute("aria-selected"), await next.getAttribute("aria-selected")];
    await page.mouse.click(box.x + box.width / 2, y);
    await expect(first).toHaveAttribute("aria-selected", wasFirst === "true" ? "false" : "true");
    await expect(next).toHaveAttribute("aria-selected", wasNext!);
  };

  // ExtensionPicker (the profile form's Extensions tab; E19: the kit
  // Combobox): 30 px option rows with no gap.
  const form = await openEditForm(page, "Amazon US seller", "Extensions");
  await probe(form.getByRole("option", { name: /uBlock Origin Lite/ }), form.getByRole("option", { name: /Cookie-Editor/ }));

  // TagPicker (E16): 30 px option rows with no gap, each row the one
  // target, its box drawn only. A click just under Warm-up's box toggles
  // Warm-up, never VIP.
  await form.getByRole("tab", { name: /^Basics/ }).click();
  await form.locator("[data-property='tags'] button").click();
  const warm = page.getByRole("option", { name: /Warm-up/ });
  const vip = page.getByRole("option", { name: /VIP/ });
  const warmBox = (await warm.locator("span[aria-hidden='true']").first().boundingBox())!;
  const warmRow = (await warm.boundingBox())!;
  const y = warmRow.y + warmRow.height - 1;
  expect(y, "the probe sits at least 2 px under the box").toBeGreaterThanOrEqual(warmBox.y + warmBox.height + 2);
  const [wasWarm, wasVip] = [await warm.getAttribute("aria-selected"), await vip.getAttribute("aria-selected")];
  await page.mouse.click(warmBox.x + warmBox.width / 2, y);
  await expect(warm).toHaveAttribute("aria-selected", wasWarm === "true" ? "false" : "true");
  await expect(vip).toHaveAttribute("aria-selected", wasVip!);
});
