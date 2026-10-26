import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp, row, seedATag, storedTags, waitForIdle } from "./support/app";
import { pickOption } from "./support/select";

// One profile form for creating and editing a profile (manual save, Tasks 3
// and 4): nothing is written until Save or Create profile.
type Stored = {
  name: string; notes: string;
  navigator: { hardware_concurrency: number; device_memory: number };
  _meta: { id: string; rev: number; folder: string; proxy_id: string | null };
  geolocation?: { mode: string; latitude: number };
};
type Mock = {
  __shardxMock: {
    calls: Record<string, number>;
    log: { cmd: string; args: Record<string, unknown> }[];
    state: { order: string[]; profiles: Record<string, Stored>; proxies: { id: string; host: string }[] };
    save: () => void;
  };
};
const SANDBOX = "f62a9d43";
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name, exact: true });
const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as unknown as Mock).__shardxMock.calls[c] ?? 0, cmd);
const stored = (page: Page, id: string) => page.evaluate((i) => (window as unknown as Mock).__shardxMock.state.profiles[i], id);
const count = (page: Page) => page.evaluate(() => (window as unknown as Mock).__shardxMock.state.order.length);
const toastText = (page: Page, text: string) => page.locator("[data-toast]").getByText(text, { exact: true });
const knob = (page: Page, name: string, value: unknown) =>
  page.evaluate(([n, v]) => { (window as unknown as Record<string, unknown>)[n as string] = v; }, [name, value] as const);
const saveButton = (page: Page, name = "Sandbox") => dialog(page, `Edit ${name}`).getByRole("button", { name: "Save", exact: true });

/** The row's menu, Edit: the form on that profile, read. */
async function openEdit(page: Page, name = "Sandbox") {
  await row(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const d = dialog(page, `Edit ${name}`);
  await expect(d.getByRole("textbox", { name: "Name" })).toHaveValue(name);
  return d;
}

// ---- Edit (Task 3) ---------------------------------------------------------

test("Edit opens the form on Basics with the profile's values", async ({ page }) => {
  await openApp(page);
  const d = await openEdit(page);
  await expect(d.getByRole("heading", { name: "Edit Sandbox" })).toBeVisible();
  await expect(d.getByRole("tab")).toHaveText(["Basics", "Proxy", "Fingerprint", "Extensions"]);
  await expect(d.getByRole("tab", { name: "Basics" })).toHaveAttribute("aria-selected", "true");
  // Nothing changed: Save waits, and says why in words.
  await expect(saveButton(page)).toBeDisabled();
  await expect(d.getByText("No changes to save")).toBeVisible();
});

test("section Edit link opens the matching tab", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  const peek = page.locator("aside[data-peek]");
  await peek.locator("[data-peek-section='fingerprint']").getByRole("button", { name: "Edit", exact: true }).click();
  const d = dialog(page, "Edit Sandbox");
  await expect(d.getByRole("tab", { name: "Fingerprint" })).toHaveAttribute("aria-selected", "true");
  for (const group of ["Hardware and screen", "Locale and noise", "Privacy and media"]) {
    await expect(d.getByRole("heading", { name: group })).toBeVisible();
  }
});

test("changed tab shows \"Changed\"; Save writes once and toasts \"{name} saved\"", async ({ page }) => {
  await openApp(page);
  const d = await openEdit(page);
  await d.getByRole("textbox", { name: "Name" }).fill("Sandbox two");
  await expect(d.getByRole("tab", { name: /^Basics\s*Changed$/ })).toBeVisible();
  await expect(d.getByRole("tab", { name: "Proxy", exact: true })).toBeVisible();
  const before = await calls(page, "profile_save");
  await saveButton(page).click();
  await expect(d).toHaveCount(0);
  await expect(toastText(page, "Sandbox two saved")).toBeVisible();
  expect(await calls(page, "profile_save")).toBe(before + 1);
  expect((await stored(page, SANDBOX)).name).toBe("Sandbox two");
});

test("Cancel with changes asks Discard; Keep editing keeps values", async ({ page }) => {
  await openApp(page);
  const d = await openEdit(page);
  const name = d.getByRole("textbox", { name: "Name" });
  await name.fill("Typed here");
  await d.getByRole("button", { name: "Cancel" }).click();
  const ask = page.getByRole("alertdialog", { name: "Discard your changes?" });
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(ask).toHaveCount(0);
  await expect(name).toHaveValue("Typed here");
  const before = await calls(page, "profile_save");
  await d.getByRole("button", { name: "Cancel" }).click();
  await ask.getByRole("button", { name: "Discard" }).click();
  await expect(d).toHaveCount(0);
  expect(await calls(page, "profile_save")).toBe(before);
  expect((await stored(page, SANDBOX)).name).toBe("Sandbox");
});

test("Mod+S saves; Mod+S with no changes does nothing", async ({ page }) => {
  await openApp(page);
  const d = await openEdit(page);
  const before = await calls(page, "profile_save");
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(300);
  await expect(d).toBeVisible();
  expect(await calls(page, "profile_save")).toBe(before);
  await d.getByRole("textbox", { name: "Name" }).fill("Saved by key");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(d).toHaveCount(0);
  await expect(toastText(page, "Saved by key saved")).toBeVisible();
  expect(await calls(page, "profile_save")).toBe(before + 1);
});

test("sidebar while dirty shows the guard", async ({ page }) => {
  await openApp(page);
  const d = await openEdit(page);
  await d.getByRole("textbox", { name: "Name" }).fill("Guarded");
  // An exit the dialog cannot see (the sidebar, a G key, the palette) goes through the page change.
  await appModule(page, "/src/shared/model/navigation.ts", "__nav");
  // Not awaited in the page: the change waits for the guard's answer.
  const go = () => page.evaluate(() => { void (window as unknown as { __nav: { useNav: { getState: () => { setSection: (s: string) => Promise<boolean> } } } }).__nav.useNav.getState().setSection("proxies"); });
  await go();
  const guard = page.getByRole("alertdialog", { name: "Save changes to Sandbox?" });
  await guard.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(guard).toHaveCount(0);
  await expect(d.getByRole("textbox", { name: "Name" })).toHaveValue("Guarded");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("All profiles");
  // Save there saves the form, and the page change goes on.
  await go();
  await guard.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Proxies");
  await expect(d).toHaveCount(0);
  expect((await stored(page, SANDBOX)).name).toBe("Guarded");
});

test("rev conflict keeps the form open with the conflict message", async ({ page }) => {
  await openApp(page);
  const d = await openEdit(page);
  await d.getByRole("textbox", { name: "Notes" }).fill("Mine");
  // Changed elsewhere (the API, another window) after the form read it.
  await page.evaluate((id) => {
    const m = (window as unknown as Mock).__shardxMock;
    m.state.profiles[id]._meta.rev += 1;
    m.state.profiles[id].notes = "Theirs";
    m.save();
  }, SANDBOX);
  await saveButton(page).click();
  await expect(d.getByText("This profile was changed somewhere else. Reload it or save your version.")).toBeVisible();
  await expect(d.getByRole("textbox", { name: "Notes" })).toHaveValue("Mine");
  expect((await stored(page, SANDBOX)).notes).toBe("Theirs");
  // Reload takes their version.
  await d.getByRole("button", { name: "Reload" }).click();
  await expect(d.getByRole("textbox", { name: "Notes" })).toHaveValue("Theirs");
});

test("failed save shows the error next to Save and keeps values", async ({ page }) => {
  await openApp(page);
  const d = await openEdit(page);
  await d.getByRole("textbox", { name: "Name" }).fill("Will fail");
  await knob(page, "__shardxMockSaveFails", true);
  await saveButton(page).click();
  await expect(d.getByText("Couldn’t save. Your changes are still here.")).toBeVisible();
  // The backend's own words, beside Save and in the toast.
  await expect(d.getByText("No space left on device (os error 28)")).toBeVisible();
  await expect(d.getByRole("textbox", { name: "Name" })).toHaveValue("Will fail");
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn’t save “Will fail”" })).toContainText("No space left on device (os error 28)");
  await expect(saveButton(page)).toBeEnabled();
  expect((await stored(page, SANDBOX)).name).toBe("Sandbox");
});

test("empty Name disables Save and says \"Enter a name\"", async ({ page }) => {
  await openApp(page);
  const d = await openEdit(page);
  const name = d.getByRole("textbox", { name: "Name" });
  await name.fill("");
  await expect(saveButton(page)).toBeDisabled();
  await expect(d.getByText("Enter a name").first()).toBeVisible();
  await expect(d.getByRole("tab", { name: /^Basics\s*Error$/ })).toBeVisible();
  // Under the field once it was left.
  await name.blur();
  await expect(d.getByText("Enter a name")).toHaveCount(2);
});

test("Add a new proxy on the Proxy tab creates it only on Save", async ({ page }) => {
  await openApp(page);
  const d = await openEdit(page);
  await d.getByRole("tab", { name: "Proxy", exact: true }).click();
  await expect(d.getByText("A proxy hides your real IP from sites.")).toBeVisible();
  await d.locator("[data-property='proxy'] button").click();
  await page.getByRole("button", { name: "Add a new proxy" }).click();
  await page.getByRole("textbox", { name: "Proxy line" }).fill("9.8.7.6:1080:user:pass");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(d.locator("[data-property='proxy']")).toContainText("New");
  await expect(d.getByRole("tab", { name: /^Proxy\s*Changed$/ })).toBeVisible();
  expect(await calls(page, "proxy_save")).toBe(0);
  expect(await calls(page, "proxy_bulk_save")).toBe(0);
  await saveButton(page).click();
  await expect(d).toHaveCount(0);
  expect(await calls(page, "proxy_save")).toBe(1);
  const added = await page.evaluate(() => (window as unknown as Mock).__shardxMock.state.proxies.find((p) => p.host === "9.8.7.6")?.id);
  expect(added).toBeTruthy();
  expect((await stored(page, SANDBOX))._meta.proxy_id).toBe(added);
});

/** Picks Folder "Ads", the tag "Warm-up" and a new tag "Fresh tag" in the open form. */
async function pickFolderAndTags(page: Page, d: ReturnType<typeof dialog>) {
  await d.locator("[data-property='folder'] button").click();
  await page.getByRole("option", { name: "Ads", exact: true }).click();
  await d.locator("[data-property='tags'] button").click();
  const picker = page.getByRole("dialog", { name: "Tags", exact: true });
  await picker.getByRole("option", { name: "Warm-up" }).click();
  await picker.getByRole("combobox", { name: "Find or create a tag" }).fill("Fresh tag");
  await picker.getByRole("option", { name: /Create/ }).click();
  await d.getByRole("textbox", { name: "Name" }).click();
  await expect(picker).toHaveCount(0);
  await expect(d.locator("[data-property='tags']")).toContainText("Fresh tag");
  await expect(d.locator("[data-property='folder']")).toContainText("Ads");
}
const tagStore = async (page: Page) => JSON.stringify(await storedTags(page));

test("Folder and tag picks change nothing until Save; Cancel and Discard leave them as they were", async ({ page }) => {
  await seedATag(page);
  await openApp(page);
  const tagsBefore = await tagStore(page);
  const moves = await calls(page, "profile_set_folder");
  let d = await openEdit(page);
  await pickFolderAndTags(page, d);
  await expect(d.getByRole("tab", { name: /^Basics\s*Changed$/ })).toBeVisible();
  expect(await calls(page, "profile_set_folder")).toBe(moves);
  expect(await tagStore(page)).toBe(tagsBefore);
  await d.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("alertdialog", { name: "Discard your changes?" }).getByRole("button", { name: "Discard" }).click();
  await expect(d).toHaveCount(0);
  expect(await calls(page, "profile_set_folder")).toBe(moves);
  expect(await tagStore(page)).toBe(tagsBefore);
  expect((await stored(page, SANDBOX))._meta.folder).toBe("");
  // Again, and Save: both land, once.
  d = await openEdit(page);
  await pickFolderAndTags(page, d);
  await saveButton(page).click();
  await expect(d).toHaveCount(0);
  expect(await calls(page, "profile_set_folder")).toBe(moves + 1);
  expect((await stored(page, SANDBOX))._meta.folder).toBe("Ads");
  const names = async () => {
    const s = await storedTags(page);
    return (s.by_profile[SANDBOX] ?? []).map((tid) => s.tags.find((x) => x.id === tid)?.name).sort();
  };
  await expect.poll(names).toEqual(["Fresh tag", "Warm-up"]);
});

// ---- Create (Task 4) -------------------------------------------------------

test("New profile opens \"New profile\" with Create profile; Cancel creates nothing", async ({ page }) => {
  await openApp(page);
  const before = await calls(page, "profile_save");
  await page.getByRole("button", { name: "New profile" }).first().click();
  const d = dialog(page, "New profile");
  await expect(d.getByRole("button", { name: "Create profile" })).toBeVisible();
  // "Profile N", selected: typing replaces it.
  const name = d.getByRole("textbox", { name: "Name" });
  await expect(name).toHaveValue(/^Profile \d+$/);
  await expect(name).toBeFocused();
  const value = await name.inputValue();
  expect(await name.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe(value.length);
  await d.getByRole("button", { name: "Cancel" }).click();
  await expect(d).toHaveCount(0);
  expect(await calls(page, "profile_save")).toBe(before);
  expect(await count(page)).toBe(8);
});

test("Create profile adds the row, selects it, opens its panel, toasts \"{name} created\"", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New profile" }).first().click();
  const d = dialog(page, "New profile");
  await expect(d.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.type("Fresh one");
  await d.getByRole("button", { name: "Create profile" }).click();
  await expect(d).toHaveCount(0);
  await expect(row(page, "Fresh one")).toHaveCount(1);
  await expect(page.locator("[role='row'][data-active]")).toContainText("Fresh one");
  await expect(page.locator("aside[data-peek]")).toHaveAttribute("aria-label", "Peek: Fresh one");
  await expect(toastText(page, "Fresh one created")).toBeVisible();
  expect(await count(page)).toBe(9);
});

test("double Create makes one profile", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New profile" }).first().click();
  const d = dialog(page, "New profile");
  await expect(d.getByRole("textbox", { name: "Name" })).toBeFocused();
  await knob(page, "__shardxMockSlow", { profile_save: 600 });
  await d.getByRole("button", { name: "Create profile" }).dblclick();
  await page.keyboard.press("Enter");
  await expect(d).toHaveCount(0);
  await waitForIdle(page);
  const created = await page.evaluate(() => (window as unknown as Mock).__shardxMock.log
    .filter((c) => c.cmd === "profile_save" && !(c.args.payload as Stored)._meta.id).length);
  expect(created).toBe(1);
  expect(await count(page)).toBe(9);
});

test("key C and the empty list's New profile open the create form", async ({ page }) => {
  await openApp(page);
  await page.locator("main").click({ position: { x: 600, y: 700 } });
  await page.keyboard.press("c");
  await expect(dialog(page, "New profile")).toBeVisible();
  await dialog(page, "New profile").getByRole("button", { name: "Cancel" }).click();
  expect(await count(page)).toBe(8);
  // No profiles: the list's own empty state offers New profile.
  await page.addInitScript(() => {
    (window as unknown as { __shardxMockEmpty: boolean }).__shardxMockEmpty = true;
    localStorage.removeItem("shardx.onboarding");
  });
  await openApp(page);
  await page.locator("main [data-empty-state]").getByRole("button", { name: "New profile" }).click();
  await expect(dialog(page, "New profile")).toBeVisible();
});

test("create failure keeps the form open with the error", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New profile" }).first().click();
  const d = dialog(page, "New profile");
  await expect(d.getByRole("textbox", { name: "Name" })).toBeFocused();
  await page.keyboard.type("Not made");
  await knob(page, "__shardxMockSaveFails", true);
  await d.getByRole("button", { name: "Create profile" }).click();
  await expect(d.getByText("Couldn’t create the profile. Your changes are still here.")).toBeVisible();
  await expect(d.getByText("No space left on device (os error 28)")).toBeVisible();
  await expect(d.getByRole("textbox", { name: "Name" })).toHaveValue("Not made");
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn’t create a profile" })).toContainText("No space left on device (os error 28)");
  expect(await count(page)).toBe(8);
});

test("a create whose Folder step fails keeps the profile once, and Save finishes it", async ({ page }) => {
  await openApp(page);
  await page.locator("aside [data-folder='Ads']").click();
  await page.getByRole("button", { name: "New profile" }).first().click();
  const d = dialog(page, "New profile");
  await expect(d.getByRole("textbox", { name: "Name" })).toHaveValue(/^Profile \d+$/);
  const name = await d.getByRole("textbox", { name: "Name" }).inputValue();
  await knob(page, "__shardxMockFail", { profile_set_folder: 1 });
  await d.getByRole("button", { name: "Create profile" }).click();
  // The profile exists: the form is its edit form now, and says what is left.
  const edit = dialog(page, `Edit ${name}`);
  await expect(edit.getByText("Created, but couldn’t move it to Ads. Save tries again.")).toBeVisible();
  await expect(edit.getByText("Mock failure: profile_set_folder")).toBeVisible();
  await expect(page.locator("[data-toast]").filter({ hasText: `Created “${name}”, but not all of it was saved` })).toBeVisible();
  expect(await count(page)).toBe(9);
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit).toHaveCount(0);
  expect(await count(page)).toBe(9);
  const created = await page.evaluate(() => (window as unknown as Mock).__shardxMock.log
    .filter((c) => c.cmd === "profile_save" && !(c.args.payload as Stored)._meta.id).length);
  expect(created).toBe(1);
  const last = await page.evaluate(() => { const s = (window as unknown as Mock).__shardxMock.state; return s.order[s.order.length - 1]; });
  expect((await stored(page, last))._meta.folder).toBe("Ads");
});

test("an edit whose Folder move fails stays open with the move still to save, and Save finishes it", async ({ page }) => {
  await openApp(page);
  const d = await openEdit(page);
  await d.locator("[data-property='folder'] button").click();
  await page.getByRole("option", { name: "Ads", exact: true }).click();
  await knob(page, "__shardxMockFail", { profile_set_folder: 1 });
  await saveButton(page).click();
  await expect(d.getByText("Saved, but couldn’t move it to Ads. Save tries again.")).toBeVisible();
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn’t move “Sandbox”" })).toBeVisible();
  await expect(toastText(page, "Sandbox saved")).toHaveCount(0);
  expect((await stored(page, SANDBOX))._meta.folder).toBe("");
  await saveButton(page).click();
  await expect(d).toHaveCount(0);
  expect((await stored(page, SANDBOX))._meta.folder).toBe("Ads");
  await expect(toastText(page, "Sandbox saved")).toBeVisible();
});

test("a new profile keeps the hardware the form shows, not what the backend rolls", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New profile" }).first().click();
  const d = dialog(page, "New profile");
  await expect(d.getByRole("textbox", { name: "Name" })).toHaveValue(/^Profile \d+$/);
  await d.getByRole("tab", { name: "Fingerprint", exact: true }).click();
  await pickOption(d, "CPU cores", "12");
  await pickOption(d, "Memory (GB)", "32");
  await d.getByRole("button", { name: "Create profile" }).click();
  await expect(d).toHaveCount(0);
  await waitForIdle(page);
  const last = await page.evaluate(() => { const s = (window as unknown as Mock).__shardxMock.state; return s.order[s.order.length - 1]; });
  const nav = (await stored(page, last)).navigator;
  expect(nav.hardware_concurrency).toBe(12);
  expect(nav.device_memory).toBe(32);
});

test("a picked screen resolution stays picked and is saved, width and height both", async ({ page }) => {
  // 2.0.3 wrote width, height and the mark as updates of one stale draft: each
  // put the others back, so no pick ever stuck.
  await openApp(page);
  const d = await openEdit(page, "FB Ads acc-01"); // a Windows fingerprint, 1920 × 1080
  await d.getByRole("tab", { name: "Fingerprint", exact: true }).click();
  const screen = d.getByRole("combobox", { name: "Screen resolution", exact: true });
  await expect(screen).toContainText("1920 × 1080");
  await pickOption(d, "Screen resolution", "1280 × 720");
  await expect(screen).toHaveText("1280 × 720");
  await saveButton(page, "FB Ads acc-01").click();
  await expect(d).toHaveCount(0);
  const saved = (await stored(page, "c31d92f0")) as unknown as { screen: { width: number; height: number }; _meta: { screen_custom?: boolean } };
  expect([saved.screen.width, saved.screen.height]).toEqual([1280, 720]);
  expect(saved._meta.screen_custom).toBe(true);
});

test("a latitude that is not a number disables Save with the error; a number brings it back", async ({ page }) => {
  await openApp(page);
  const d = await openEdit(page);
  await d.getByRole("tab", { name: "Fingerprint", exact: true }).click();
  await d.getByRole("radio", { name: "Set manually" }).click();
  const lat = d.getByRole("textbox", { name: "Latitude" });
  await expect(saveButton(page)).toBeEnabled();
  const before = await calls(page, "profile_save");
  for (const text of ["abc", ""]) {
    await lat.fill(text);
    await expect(saveButton(page)).toBeDisabled();
    await expect(d.getByText("Enter a valid number")).toBeVisible();
    await lat.blur();
    await expect(d.getByText("Enter a number from -90 to 90.")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+s");
    await page.waitForTimeout(300);
    await expect(d).toBeVisible();
    expect(await calls(page, "profile_save")).toBe(before);
  }
  await lat.fill("48.8566");
  await expect(saveButton(page)).toBeEnabled();
  await expect(d.getByText("Enter a valid number")).toHaveCount(0);
  await saveButton(page).click();
  await expect(d).toHaveCount(0);
  expect(await calls(page, "profile_save")).toBe(before + 1);
});

test("Mod+S commits the field that has the keyboard: a latitude typed past its range is saved brought into range", async ({ page }) => {
  await openApp(page);
  const d = await openEdit(page);
  await d.getByRole("tab", { name: "Fingerprint", exact: true }).click();
  await d.getByRole("radio", { name: "Set manually" }).click();
  const lat = d.getByRole("textbox", { name: "Latitude" });
  const before = await calls(page, "profile_save");
  // In range: saved as typed.
  await lat.fill("12.5");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(d).toHaveCount(0);
  expect(await calls(page, "profile_save")).toBe(before + 1);
  expect((await stored(page, SANDBOX)).geolocation).toMatchObject({ mode: "manual", latitude: 12.5 });
  // Past the range, with the keyboard still in the field: the form held Save
  // for it, and Mod+S brings it in range (90) and saves that.
  const again = await openEdit(page);
  await again.getByRole("tab", { name: "Fingerprint", exact: true }).click();
  const field = again.getByRole("textbox", { name: "Latitude" });
  await field.fill("95");
  await expect(saveButton(page)).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(again).toHaveCount(0);
  expect((await stored(page, SANDBOX)).geolocation).toMatchObject({ latitude: 90 });
});

test("Mod+S takes a port still being typed in Ports to block", async ({ page }) => {
  await openApp(page);
  const d = await openEdit(page);
  await d.getByRole("tab", { name: "Fingerprint", exact: true }).click();
  // Not yet a chip: no Enter, no comma, no blur.
  await d.getByPlaceholder("Add port…").fill("4444");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(d).toHaveCount(0);
  expect((await stored(page, SANDBOX) as unknown as { blocked_ports: number[] }).blocked_ports).toContain(4444);
});
