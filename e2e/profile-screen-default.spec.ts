import { expect, test, type Page } from "@playwright/test";
import { openApp, openEditForm, waitForIdle } from "./support/app";
import { pickOption } from "./support/select";

// A new Windows/Linux profile claims this computer's screen; macOS and phone
// profiles keep the fingerprint's own (owner, 2026-10-23). Existing profiles
// show what they have.
type Screen = { width: number; height: number; avail_width: number; avail_height: number; device_pixel_ratio: number };
type Mock = {
  __shardxMock: {
    state: {
      order: string[];
      profiles: Record<string, { screen: Screen; _meta: { gpu_preset_id: string; screen_custom?: boolean } }>;
      fingerprints: { id: string; payload: { screen: Screen } }[];
    };
  };
};

const HOST = "This computer’s screen (2560 × 1440)";
const dialog = (page: Page) => page.getByRole("dialog", { name: "New profile", exact: true });
const screenField = (page: Page) => dialog(page).getByRole("combobox", { name: "Screen resolution", exact: true });
/** The mock library's labels per OS: a pick has landed once the Fingerprint field shows one. */
const LABEL: Record<string, RegExp> = { Windows: /Windows 1\d/, Linux: /Ubuntu|Fedora/, macOS: /macOS 1\d/ };
async function os(page: Page, name: string) {
  await dialog(page).getByRole("radiogroup", { name: "Operating system" }).getByRole("radio", { name, exact: true }).click();
  await expect(dialog(page).getByRole("combobox", { name: "Fingerprint", exact: true })).toContainText(LABEL[name]);
}

/** The app with this computer's screen as given (null: no monitor), on a new profile's Fingerprint tab. */
async function openNew(page: Page, host: [number, number, number] | null = [2560, 1440, 1.5], opened = false) {
  if (!opened) await openApp(page);
  await page.evaluate((h) => { (window as unknown as { __shardxMockHostScreen: unknown }).__shardxMockHostScreen = h; }, host);
  await page.getByRole("button", { name: "New profile" }).first().click();
  await expect(dialog(page).getByRole("textbox", { name: "Name" })).toHaveValue(/^Profile \d+$/);
  await dialog(page).getByRole("tab", { name: "Fingerprint", exact: true }).click();
}

/** Creates the profile and gives its stored screen, its mark and its template's screen. */
async function create(page: Page) {
  await dialog(page).getByRole("button", { name: "Create profile" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await waitForIdle(page);
  return page.evaluate(() => {
    const s = (window as unknown as Mock).__shardxMock.state;
    const p = s.profiles[s.order[s.order.length - 1]];
    const tpl = s.fingerprints.find((f) => f.id === p._meta.gpu_preset_id)!.payload.screen;
    return { screen: p.screen, custom: p._meta.screen_custom === true, tpl };
  });
}

test("a new Windows profile starts on this computer's screen and is saved with it", async ({ page }) => {
  await openNew(page);
  await os(page, "Windows");
  await expect(screenField(page)).toContainText(HOST);
  const { screen, custom, tpl } = await create(page);
  expect([screen.width, screen.height]).toEqual([2560, 1440]);
  // The template's taskbar stays; the size is a default, not a pick by hand.
  expect(screen.avail_height).toBe(1440 - (tpl.height - tpl.avail_height));
  // The size is in this monitor's CSS px: its pixel ratio goes with it.
  expect(screen.device_pixel_ratio).toBe(1.5);
  expect(custom).toBe(false);
});

test("switching a new profile to macOS gives it the fingerprint's own screen", async ({ page }) => {
  await openNew(page);
  await os(page, "Windows");
  await expect(screenField(page)).toContainText(HOST);
  await os(page, "macOS");
  // macOS keeps the template's screen: nothing to choose.
  await expect(screenField(page)).toHaveCount(0);
  const { screen, tpl } = await create(page);
  expect([screen.width, screen.height, screen.device_pixel_ratio]).toEqual([tpl.width, tpl.height, tpl.device_pixel_ratio]);
});

test("As in the fingerprint stays a choice, and is saved as the template's screen", async ({ page }) => {
  await openNew(page);
  await os(page, "Windows");
  await expect(screenField(page)).toContainText(HOST);
  await pickOption(dialog(page), "Screen resolution", "As in the fingerprint");
  await expect(screenField(page)).toContainText("As in the fingerprint");
  // And back.
  await pickOption(dialog(page), "Screen resolution", HOST);
  await expect(screenField(page)).toContainText(HOST);
  await pickOption(dialog(page), "Screen resolution", "As in the fingerprint");
  const { screen, custom, tpl } = await create(page);
  expect([screen.width, screen.height, screen.avail_height, screen.device_pixel_ratio])
    .toEqual([tpl.width, tpl.height, tpl.avail_height, tpl.device_pixel_ratio]);
  expect(custom).toBe(false);
});

test("As in the fingerprint, picked, stays on another Windows fingerprint", async ({ page }) => {
  await openNew(page);
  await os(page, "Windows");
  await pickOption(dialog(page), "Screen resolution", "As in the fingerprint");
  const fingerprint = dialog(page).getByRole("combobox", { name: "Fingerprint", exact: true });
  const other = /UHD 630/.test(await fingerprint.innerText()) ? "AMD RX 6600" : "Intel UHD 630";
  await pickOption(dialog(page), "Fingerprint", new RegExp(`^Windows 10, ${other}`));
  await expect(fingerprint).toContainText(other);
  await expect(screenField(page)).toContainText("As in the fingerprint");
  const { screen, tpl } = await create(page);
  expect([screen.width, screen.height]).toEqual([tpl.width, tpl.height]);
});

test("a phone fingerprint whose platform reads Linux keeps its own screen, as the backend does", async ({ page }) => {
  await openApp(page);
  // An imported handset: navigator.platform "Linux", an Android user agent.
  await page.evaluate(() => {
    type Fp = { id: string; label: string; platform: string; builtin: boolean; payload: { navigator: { platform: string } } };
    const m = (window as unknown as { __shardxMock: { state: { fingerprints: Fp[] }; save: () => void } }).__shardxMock;
    const phone = structuredClone(m.state.fingerprints.find((f) => f.id === "android-pixel-8")!);
    phone.payload.navigator.platform = "Linux";
    m.state.fingerprints.push({ ...phone, id: "imported-phone", label: "Imported Pixel", platform: "Linux", builtin: false });
    m.save();
  });
  await page.reload();
  await waitForIdle(page);
  await openNew(page, [2560, 1440, 1.5], true);
  // It is filed under Linux, so the OS pick may land on it already.
  const fingerprint = dialog(page).getByRole("combobox", { name: "Fingerprint", exact: true });
  await dialog(page).getByRole("radiogroup", { name: "Operating system" }).getByRole("radio", { name: "Linux", exact: true }).click();
  await expect(fingerprint).toContainText(/Ubuntu|Fedora|Imported Pixel/);
  await pickOption(dialog(page), "Fingerprint", /^Imported Pixel/);
  await expect(fingerprint).toContainText("Imported Pixel");
  await expect(screenField(page)).toContainText("As in the fingerprint");
  const { screen, tpl } = await create(page);
  expect([screen.width, screen.height]).toEqual([tpl.width, tpl.height]);
});

test("a size picked by hand stays on Windows and Linux, and goes with macOS", async ({ page }) => {
  await openNew(page);
  await os(page, "Windows");
  await pickOption(dialog(page), "Screen resolution", "1920 × 1080");
  await os(page, "Linux");
  await expect(screenField(page)).toContainText("1920 × 1080");
  await os(page, "macOS");
  await expect(screenField(page)).toHaveCount(0);
  // Back on Windows the default comes back: macOS took the pick with it.
  await os(page, "Windows");
  await expect(screenField(page)).toContainText(HOST);
  await pickOption(dialog(page), "Screen resolution", "1920 × 1080");
  const { screen, custom } = await create(page);
  expect([screen.width, screen.height]).toEqual([1920, 1080]);
  expect(custom).toBe(true);
});

test("with no monitor to ask, a new Windows profile starts on the fingerprint's screen", async ({ page }) => {
  await openNew(page, null);
  await os(page, "Windows");
  await expect(screenField(page)).toContainText("As in the fingerprint");
  await screenField(page).click();
  await expect(page.getByRole("option", { name: /This computer’s screen/ })).toHaveCount(0);
});

test("editing a Windows profile shows the screen it has", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => { (window as unknown as { __shardxMockHostScreen: unknown }).__shardxMockHostScreen = [2560, 1440, 1.5]; });
  const form = await openEditForm(page, "FB Ads acc-02", "Fingerprint");
  const field = form.getByRole("combobox", { name: "Screen resolution", exact: true });
  await expect(field).toContainText("1920 × 1080");
  await field.click();
  await expect(page.getByRole("option", { name: /This computer’s screen/ })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "As in the fingerprint", exact: true })).toHaveCount(1);
});
