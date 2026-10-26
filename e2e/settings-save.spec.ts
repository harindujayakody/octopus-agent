import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp, storedTags } from "./support/app";

// Manual save (Task 8): Settings change only on Save. The page holds a draft;
// the bar at its bottom saves or drops it; leaving asks.
type Mock = { __shardxMock: { state: { settings: Record<string, unknown> }; calls: Record<string, number> } };
const stored = (page: Page, key: string) => page.evaluate((k) => (window as unknown as Mock).__shardxMock.state.settings[k], key);
const writes = (page: Page) => page.evaluate(() => (window as unknown as Mock).__shardxMock.calls.settings_save ?? 0);
const tab = (page: Page, name: string) => page.getByRole("tab", { name });
const bar = (page: Page) => page.locator("[data-save-bar]");
const tray = (page: Page) => page.getByRole("switch", { name: /tray/i });
const saveButton = (page: Page) => bar(page).getByRole("button", { name: "Save", exact: true });
const dontSave = (page: Page) => bar(page).getByRole("button", { name: "Don’t save" });
const guard = (page: Page) => page.getByRole("alertdialog", { name: "Save changes to Settings?" });
const toast = (page: Page, text: string) => page.locator("[data-toast]").getByText(text, { exact: true });
const nav = (page: Page, section: string) => page.locator(`aside [data-nav='${section}']`).click();
const port = (page: Page) => page.getByRole("textbox", { name: "Port" });

const html = (page: Page) => page.locator("html");
const local = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key);

const TAGS = {
  version: 1,
  tags: [{ id: "t-warm", name: "Warm-up", color: "orange" }, { id: "t-vip", name: "VIP", color: "violet" }],
  byProfile: {},
};
const seedTags = (page: Page) => page.addInitScript((v) => {
  if (localStorage.getItem("shardx.tags") === null) localStorage.setItem("shardx.tags", JSON.stringify(v));
}, TAGS);
const tagStore = async (page: Page) => (await storedTags(page)).tags.map((t) => `${t.name}:${t.color}`);

test("flipping a switch writes nothing and shows the bar", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await expect(bar(page)).toHaveCount(0);
  const before = await tray(page).isChecked();
  const sent = await writes(page);
  await tray(page).click();
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toContainText("Unsaved changes");
  await expect(dontSave(page)).toBeVisible();
  await expect(saveButton(page)).toBeVisible();
  // The old autosave waited 400 ms: well past that, nothing is written.
  await page.waitForTimeout(700);
  expect(await writes(page)).toBe(sent);
  expect(await stored(page, "minimize_to_tray")).toBe(before);
  // The switch put back leaves nothing to save.
  await tray(page).click();
  await expect(bar(page)).toHaveCount(0);
});

test("Save writes once and toasts \"Settings saved\"", async ({ page }) => {
  await openApp(page, { section: "settings" });
  const before = await tray(page).isChecked();
  const sent = await writes(page);
  await tray(page).click();
  await tab(page, "API & MCP").click();
  await port(page).fill("41000");
  await expect(bar(page)).toBeVisible();
  await saveButton(page).click();
  await expect(toast(page, "Settings saved")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  // Two fields on two tabs, one write.
  expect(await writes(page)).toBe(sent + 1);
  expect(await stored(page, "api_port")).toBe(41000);
  expect(await stored(page, "minimize_to_tray")).toBe(!before);
});

test("Don't save restores the old values", async ({ page }) => {
  await openApp(page, { section: "settings" });
  const before = await tray(page).isChecked();
  const sent = await writes(page);
  await tray(page).click();
  await tab(page, "API & MCP").click();
  await port(page).fill("41000");
  await dontSave(page).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(port(page)).toHaveValue("40325");
  await tab(page, "General").click();
  await expect(tray(page)).toBeChecked({ checked: before });
  expect(await writes(page)).toBe(sent);
  expect(await stored(page, "api_port")).toBe(40325);
});

test("leaving Settings while dirty shows the guard", async ({ page }) => {
  await openApp(page, { section: "settings" });
  const before = await tray(page).isChecked();
  const sent = await writes(page);
  await tray(page).click();
  await nav(page, "proxies");
  await expect(guard(page)).toBeVisible();
  await expect(guard(page).getByRole("button", { name: "Save", exact: true })).toBeFocused();
  // Cancel stays, draft and all.
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-section", "settings");
  await expect(tray(page)).toBeChecked({ checked: !before });
  // Don't save leaves with nothing written.
  await nav(page, "proxies");
  await guard(page).getByRole("button", { name: "Don’t save" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-section", "proxies");
  expect(await writes(page)).toBe(sent);
  await nav(page, "settings");
  await expect(tray(page)).toBeChecked({ checked: before });
  // Save writes, then leaves.
  await tray(page).click();
  await nav(page, "proxies");
  await guard(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute("data-section", "proxies");
  expect(await stored(page, "minimize_to_tray")).toBe(!before);
  await expect(toast(page, "Settings saved")).toBeVisible();
});

test("switching Settings tabs keeps the draft and does not ask", async ({ page }) => {
  await openApp(page, { section: "settings" });
  const before = await tray(page).isChecked();
  await tray(page).click();
  await tab(page, "Helper").click();
  await expect(guard(page)).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await tab(page, "General").click();
  await expect(tray(page)).toBeChecked({ checked: !before });
  await expect(bar(page)).toBeVisible();
});

test("Cmd or Ctrl+S saves; with nothing unsaved it does nothing", async ({ page }) => {
  await openApp(page, { section: "settings" });
  const before = await tray(page).isChecked();
  const sent = await writes(page);
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(300);
  expect(await writes(page)).toBe(sent);
  await tray(page).click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect(toast(page, "Settings saved")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  expect(await writes(page)).toBe(sent + 1);
  expect(await stored(page, "minimize_to_tray")).toBe(!before);
});

test("a tag rename and a new color wait for Save", async ({ page }) => {
  await seedTags(page);
  await openApp(page, { section: "settings" });
  await tab(page, "Tags").click();
  const row = page.locator("[data-tag-row='t-warm']");
  const name = row.getByRole("textbox", { name: "Name of the tag “Warm-up”" });
  await name.fill("Warmed");
  await row.getByRole("radio", { name: "Red" }).click();
  await expect(bar(page)).toBeVisible();
  // Enter and leaving the field are not Save.
  await name.press("Enter");
  await name.blur();
  expect(await tagStore(page)).toEqual(["Warm-up:orange", "VIP:violet"]);
  await saveButton(page).click();
  await expect(toast(page, "Settings saved")).toBeVisible();
  await expect.poll(() => tagStore(page)).toEqual(["Warmed:red", "VIP:violet"]);
  await expect(bar(page)).toHaveCount(0);
  // The row is named by the saved name, which is Warmed now.
  await expect(row.getByRole("textbox", { name: "Name of the tag “Warmed”" })).toHaveValue("Warmed");
});

test("Esc in a tag name puts the name back, and nothing is left to save", async ({ page }) => {
  await seedTags(page);
  await openApp(page, { section: "settings" });
  await tab(page, "Tags").click();
  const name = page.locator("[data-tag-row='t-warm']").getByRole("textbox", { name: "Name of the tag “Warm-up”" });
  await name.fill("Warmed");
  await expect(bar(page)).toBeVisible();
  await name.press("Escape");
  await expect(name).toHaveValue("Warm-up");
  await expect(bar(page)).toHaveCount(0);
});

test("a taken tag name fails Save with the error, and nothing is written", async ({ page }) => {
  await seedTags(page);
  await openApp(page, { section: "settings" });
  const before = await tray(page).isChecked();
  const sent = await writes(page);
  await tray(page).click();
  await tab(page, "Tags").click();
  const row = page.locator("[data-tag-row='t-warm']");
  const name = row.getByRole("textbox", { name: "Name of the tag “Warm-up”" });
  await name.fill("vip");
  await saveButton(page).click();
  const taken = "A tag named “vip” already exists. Pick another name.";
  await expect(row).toContainText(taken);
  await expect(bar(page)).toContainText(taken);
  await expect(bar(page)).toBeVisible();
  // The settings did not go ahead of the name.
  expect(await writes(page)).toBe(sent);
  expect(await tagStore(page)).toEqual(["Warm-up:orange", "VIP:violet"]);
  // Another name, and the same Save goes through with everything.
  await name.fill("Warmed");
  await expect(row).not.toContainText(taken);
  await saveButton(page).click();
  await expect(toast(page, "Settings saved")).toBeVisible();
  await expect.poll(() => tagStore(page)).toEqual(["Warmed:orange", "VIP:violet"]);
  expect(await stored(page, "minimize_to_tray")).toBe(!before);
});

test("risky launch arguments ask on Save, not when the field is left", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "Profile defaults").click();
  const args = page.getByRole("textbox", { name: /start arguments/i });
  await args.fill("--proxy-server=socks5://203.0.113.9:1080");
  await args.blur();
  await expect(bar(page)).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await saveButton(page).click();
  const ask = page.getByRole("alertdialog", { name: "Save these start arguments?" });
  await expect(ask).toBeVisible();
  // Cancel saves nothing and keeps what was typed.
  await ask.getByRole("button", { name: "Cancel" }).click();
  expect(await stored(page, "extra_args")).toBe("");
  await expect(args).toHaveValue("--proxy-server=socks5://203.0.113.9:1080");
  await expect(bar(page)).toBeVisible();
  await saveButton(page).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Save anyway" }).click();
  await expect(toast(page, "Settings saved")).toBeVisible();
  expect(await stored(page, "extra_args")).toBe("--proxy-server=socks5://203.0.113.9:1080");
});

test("a port that is not a number holds Save, and the bar says why", async ({ page }) => {
  await openApp(page, { section: "settings" });
  const sent = await writes(page);
  await tray(page).click();
  await tab(page, "API & MCP").click();
  await port(page).fill("80a");
  await expect(bar(page)).toContainText("Enter a number from 1024 to 65535.");
  await expect(saveButton(page)).toHaveAttribute("aria-disabled", "true");
  await port(page).press("ControlOrMeta+s");
  await page.waitForTimeout(300);
  expect(await writes(page)).toBe(sent);
  // A port again, and Save is free.
  await port(page).fill("41000");
  await expect(bar(page)).not.toContainText("Enter a number");
  await expect(saveButton(page)).not.toHaveAttribute("aria-disabled", "true");
  await saveButton(page).click();
  await expect.poll(() => stored(page, "api_port")).toBe(41000);
});

test("a change to the API server says it needs a restart once it is saved (O6)", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "API & MCP").click();
  await expect(page.locator("[data-restart-note]")).toHaveCount(0);
  await port(page).fill("41002");
  // Unsaved, nothing differs from the running server yet.
  await expect(page.locator("[data-restart-note]")).toHaveCount(0);
  await saveButton(page).click();
  await expect(page.locator("[data-restart-note]")).toHaveText("Restart Octopus Agent to apply.");
});

test("a save that fails keeps the draft, says why beside Save and toasts", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __shardxMockFail: { settings_save: 1 } }));
  await openApp(page, { section: "settings" });
  const before = await tray(page).isChecked();
  await tray(page).click();
  await saveButton(page).click();
  await expect(bar(page).getByRole("alert")).toHaveText("Couldn’t save. Your changes are still here.");
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn’t save settings" })).toBeVisible();
  await expect(tray(page)).toBeChecked({ checked: !before });
  expect(await stored(page, "minimize_to_tray")).toBe(before);
  // The same Save, once more, goes through.
  await saveButton(page).click();
  await expect(toast(page, "Settings saved")).toBeVisible();
  expect(await stored(page, "minimize_to_tray")).toBe(!before);
});

test("a save with no answer in 10 s fails, and Save works again (Pair 34 ruling)", async ({ page }) => {
  test.setTimeout(40_000);
  await openApp(page, { section: "settings" });
  const before = await tray(page).isChecked();
  await tray(page).click();
  await page.evaluate(() => Object.assign(window, { __shardxMockSlow: { settings_save: 60_000 } }));
  await saveButton(page).click();
  await expect(bar(page).getByRole("button", { name: "Saving" })).toBeVisible();
  await expect(bar(page).getByRole("alert")).toHaveText("Couldn’t save. Your changes are still here.", { timeout: 15_000 });
  await expect(tray(page)).toBeChecked({ checked: !before });
  await page.evaluate(() => Object.assign(window, { __shardxMockSlow: {} }));
  await saveButton(page).click();
  await expect.poll(() => stored(page, "minimize_to_tray")).toBe(!before);
});

test("nothing is shown until the settings are read, so nothing flips (LAYOUT-21)", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __shardxMockSlow: { settings_get: 800 } }));
  await openApp(page, { section: "settings", idle: false });
  await expect(tray(page)).toHaveCount(0);
  await expect(tray(page)).toBeVisible({ timeout: 5000 });
});

// ---- This window's own preferences join the draft (fix round 1, ruling 7) ----

test("the theme previews at once, is stored only on Save, and Don't save puts the old one back", async ({ page }) => {
  await openApp(page, { section: "settings", theme: "light" });
  await tab(page, "Appearance").click();
  const theme = page.locator("[data-setting='theme']");
  await theme.getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(bar(page)).toContainText("Unsaved changes");
  expect(await local(page, "shardx-ui-kit-theme")).toBe("light");
  await dontSave(page).click();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await expect(theme.getByRole("radio", { name: "Light", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(bar(page)).toHaveCount(0);
  expect(await local(page, "shardx-ui-kit-theme")).toBe("light");
  // Save stores it.
  await theme.getByRole("radio", { name: "Dark", exact: true }).click();
  await saveButton(page).click();
  await expect(toast(page, "Settings saved")).toBeVisible();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  expect(await local(page, "shardx-ui-kit-theme")).toBe("dark");
});

test("a theme picked from the palette shows at once and replaces the pick waiting in Settings", async ({ page }) => {
  await openApp(page, { section: "settings", theme: "light" });
  await tab(page, "Appearance").click();
  await page.locator("[data-setting='theme']").getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("light theme");
  await page.getByRole("option", { name: /^Use light theme/ }).click();
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  // The pick that waited is gone: nothing left to save, and no Save would put dark back.
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator("[data-setting='theme']").getByRole("radio", { name: "Light", exact: true })).toHaveAttribute("aria-checked", "true");
  expect(await local(page, "shardx-ui-kit-theme")).toBe("light");
});

test("leaving by the guard's Don't save restores the previewed theme and motion", async ({ page }) => {
  await openApp(page, { section: "settings", theme: "light" });
  await tab(page, "Appearance").click();
  await page.locator("[data-setting='theme']").getByRole("radio", { name: "Dark", exact: true }).click();
  await page.getByRole("switch", { name: "Reduce motion" }).check();
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
  await expect(html(page)).toHaveAttribute("data-reduce-motion", "true");
  await nav(page, "proxies");
  await guard(page).getByRole("button", { name: "Don’t save" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-section", "proxies");
  await expect(html(page)).toHaveAttribute("data-theme", "light");
  await expect(html(page)).toHaveAttribute("data-reduce-motion", "false");
  expect(await local(page, "shardx-ui-kit-theme")).toBe("light");
  expect(await local(page, "shardx.reduceMotion")).not.toBe("true");
});

test("Interface size is stored only on Save: a reload without it keeps the old size", async ({ page }) => {
  await openApp(page, { section: "settings" });
  const zoom = () => page.evaluate(() => document.documentElement.style.getPropertyValue("zoom"));
  await tab(page, "Appearance").click();
  await page.getByRole("combobox", { name: "Interface size" }).click();
  await page.getByRole("option", { name: "125%" }).click();
  await expect.poll(zoom).toBe("1.25");
  await expect(bar(page)).toBeVisible();
  expect(await local(page, "shardx.interfaceSize")).toBeNull();
  await page.reload();
  await expect.poll(zoom).toBe("");
  // The same choice with Save survives the reload.
  await tab(page, "Appearance").click();
  await page.getByRole("combobox", { name: "Interface size" }).click();
  await page.getByRole("option", { name: "125%" }).click();
  await saveButton(page).click();
  await expect.poll(() => local(page, "shardx.interfaceSize")).toBe("125");
  await page.reload();
  await expect.poll(zoom).toBe("1.25");
});

test("the language previews at once, the draft survives the rebuild, and Don't save puts it back", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("combobox", { name: "Interface language" }).click();
  await page.getByRole("option", { name: "中文（简体）" }).click();
  await expect(html(page)).toHaveAttribute("lang", "zh-CN");
  // The page was rebuilt in Chinese; its unsaved change is still there, in words.
  await expect(bar(page)).toContainText("有未保存的更改");
  expect(await local(page, "shardx.lang")).toBe("en");
  await bar(page).getByRole("button", { name: "不保存" }).click();
  await expect(html(page)).toHaveAttribute("lang", "en");
  await expect(bar(page)).toHaveCount(0);
  expect(await local(page, "shardx.lang")).toBe("en");
});

test("single keys change nothing until Save, and count as unsaved", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("switch", { name: "Single-key shortcuts" }).uncheck();
  await expect(bar(page)).toBeVisible();
  await page.waitForTimeout(300);
  expect(await local(page, "shardx.singleKeys")).toBeNull();
  // The guard counts them.
  await nav(page, "proxies");
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-section", "settings");
  await saveButton(page).click();
  await expect(toast(page, "Settings saved")).toBeVisible();
  expect(await local(page, "shardx.singleKeys")).toBe("false");
  await expect(bar(page)).toHaveCount(0);
});

// ---- Fix round 1: a failure never leaves "Saving", and Save commits the focused field ----

test("a store that throws while the changes are applied ends in an error, not in \"Saving\"", async ({ page }) => {
  await seedTags(page);
  await openApp(page, { section: "settings" });
  await appModule(page, "/src/entities/tag/index.ts", "__tags");
  await page.evaluate(() => (window as unknown as { __tags: { useTags: { setState: (p: object) => void } } }).__tags.useTags.setState({
    recolor: () => { throw new Error("storage is full"); },
  }));
  await tab(page, "Tags").click();
  await page.locator("[data-tag-row='t-warm']").getByRole("radio", { name: "Red" }).click();
  await saveButton(page).click();
  await expect(bar(page).getByRole("alert")).toHaveText("Couldn’t save. Your changes are still here.");
  await expect(bar(page).getByRole("button", { name: "Saving" })).toHaveCount(0);
  await expect(saveButton(page)).not.toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn’t save settings" })).toBeVisible();
  expect(await tagStore(page)).toEqual(["Warm-up:orange", "VIP:violet"]);
});

test("Mod+S commits the number being typed: in range it is saved as typed, past the range as the field brings it in", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "API & MCP").click();
  await port(page).fill("41000");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(toast(page, "Settings saved")).toBeVisible();
  expect(await stored(page, "api_port")).toBe(41000);
  // 99999 is no port: leaving the field would make it 65535, and so does Save.
  await port(page).fill("99999");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => stored(page, "api_port")).toBe(65535);
  await expect(port(page)).toHaveValue("65535");
  await expect(bar(page)).toHaveCount(0);
});
