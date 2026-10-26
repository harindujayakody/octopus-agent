import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle } from "./support/app";
import { openSearch } from "./support/search";

const card = (page: Page, label: string) => page.locator("[data-fingerprint-id]", { hasText: label });
const cards = (page: Page) => page.locator("[data-fingerprint-id]");
/** The grid item round a card (F27): the element that takes focus and is aria-current. */
const item = (page: Page, label: string) => page.locator("main [role='listitem']").filter({ has: card(page, label) });
const bar = (page: Page) => page.getByRole("group", { name: "Filter fingerprints" });
/** Device and GPU vendor are in the Filters menu beside the OS (F22): the field, then the value (its count follows). */
async function pick(page: Page, field: string, value: string) {
  await bar(page).getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("option", { name: new RegExp(`^${field}`) }).click();
  await page.getByRole("option", { name: new RegExp(`^${value}`) }).click();
}

test("the OS filter keeps one OS; the header count follows", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  await expect(page.locator("main header [data-count]")).toHaveText("12");
  await bar(page).getByRole("radio", { name: "Windows", exact: true }).click();
  await expect(cards(page)).toHaveCount(5);
  await expect(page.locator("main header [data-count]")).toHaveText("5");
});

test("handset fingerprints are filed under Android", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  await expect(page.locator("main h2", { hasText: "Linux armv8l" })).toHaveCount(0);
  await expect(page.locator("main h2", { hasText: "Android" })).toBeVisible();
  await bar(page).getByRole("radio", { name: "Android", exact: true }).click();
  await expect(cards(page)).toHaveCount(2);
});

test("device type and GPU vendor combine with the OS and the text filter", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  await pick(page, "Device", "Phone");
  await expect(cards(page)).toHaveCount(2);
  await pick(page, "Device", "Desktop");
  await pick(page, "GPU vendor", "NVIDIA");
  await expect(cards(page)).toHaveCount(3);
  await (await openSearch(page)).fill("Fedora");
  await expect(cards(page)).toHaveCount(1);
  await expect(card(page, "Fedora 40, NVIDIA GTX 1660")).toBeVisible();
});

test("a filter that hides every fingerprint says so and can be cleared", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  await bar(page).getByRole("radio", { name: "macOS", exact: true }).click();
  await pick(page, "GPU vendor", "NVIDIA");
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator("main")).toContainText("No fingerprints match");
  // The empty state's Clear filters takes off the OS too (the chips' own Clear, the menu's filters only).
  await page.locator("main [data-empty-state]").getByRole("button", { name: "Clear filters" }).click();
  await expect(cards(page)).toHaveCount(12);
});

const peek = (page: Page) => page.locator("aside[data-peek='fingerprint']");
const mockCalls = (page: Page, cmd: string) => page.evaluate((c) => (window as unknown as { __shardxMock: { calls: Record<string, number> } }).__shardxMock.calls[c] ?? 0, cmd);
const profileCount = (page: Page) => page.evaluate(() => (window as unknown as { __shardxMock: { state: { order: string[] } } }).__shardxMock.state.order.length);

test("the card in Peek keeps its own surface and shows one ring, focused or not (owner)", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  const open = card(page, "Windows 11, Intel Arc A770");
  const other = card(page, "macOS 14, Apple M1");
  await open.click();
  await expect(open).toHaveAttribute("data-selected", "");
  await page.mouse.move(1, 1);
  const look = (l: ReturnType<typeof card>) => l.evaluate((el) => {
    const s = getComputedStyle(el);
    // A clear outline (the card's own, while its grid item's focus ring shows) is no ring.
    const clear = /^(transparent|rgba\(0, 0, 0, 0\))$/.test(s.outlineColor);
    return { bg: s.backgroundColor, border: s.borderTopColor, outline: clear ? "none" : `${s.outlineStyle} ${s.outlineWidth}` };
  });
  const [a, b] = [await look(open), await look(other)];
  expect(a.bg).toBe(b.bg);
  expect(a.border).toBe(b.border);
  expect(a.outline).toBe("solid 2px");
  expect(b.outline).not.toContain("solid");
  // The same card from the keyboard (F27: its grid item takes focus), still
  // in Peek: one outline, the focus ring, never two.
  const openItem = item(page, "Windows 11, Intel Arc A770");
  await openItem.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(openItem).toBeFocused();
  const rings = async () => [await look(open), await look(openItem)].filter((l) => l.outline === "solid 2px").length;
  expect(await rings()).toBe(1);
  // Back on it after Peek closes: the one outline still.
  await page.keyboard.press("Escape");
  await expect(openItem).toBeFocused();
  expect(await rings()).toBe(1);
});

test("a card opens the fingerprint in Peek with its details and this machine's verdict", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  await card(page, "Windows 11, Intel Arc A770").click();
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: Windows 11, Intel Arc A770");
  await expect(item(page, "Windows 11, Intel Arc A770")).toHaveAttribute("aria-current", "true");
  await expect(peek(page).locator("[data-peek-section='details']")).toContainText("Intel(R) Arc(TM) A770 Graphics");
  await expect(peek(page).locator("[data-peek-section='compat']")).toContainText("WEBGL_compressed_texture_s3tc_srgb");
  await page.keyboard.press("Escape");
  await expect(peek(page)).toHaveCount(0);
  await expect(item(page, "Windows 11, Intel Arc A770")).toBeFocused();
});

test("a card opens from the keyboard", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  await item(page, "macOS 14, Apple M1").focus();
  await page.keyboard.press("Enter");
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: macOS 14, Apple M1");
  await expect(peek(page).locator("[data-peek-section='compat']")).toContainText("This computer can run it");
});

test("New profile from a fingerprint opens the create form with that fingerprint chosen; nothing is made until Create profile", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  const before = await profileCount(page);
  const saves = await mockCalls(page, "profile_save");
  await card(page, "Windows 11, NVIDIA RTX 3060").click();
  await peek(page).getByRole("button", { name: "New profile with this fingerprint" }).click();
  // The Profiles page with the create form over it; the library's Peek is gone.
  const form = page.getByRole("dialog", { name: "New profile", exact: true });
  await expect(form.getByRole("button", { name: "Create profile" })).toBeVisible();
  await expect(page.locator("main header")).toContainText("All profiles");
  await expect(peek(page)).toHaveCount(0);
  // The fingerprint is the one chosen, not a random one.
  await form.getByRole("tab", { name: "Fingerprint", exact: true }).click();
  await expect(form.getByRole("combobox", { name: "Fingerprint", exact: true })).toContainText("Windows 11, NVIDIA RTX 3060");
  // Nothing exists yet.
  await page.waitForTimeout(400);
  expect(await profileCount(page)).toBe(before);
  expect(await mockCalls(page, "profile_save")).toBe(saves);
  expect(await mockCalls(page, "profile_create_from_template")).toBe(0);
  // Create profile makes it, on that fingerprint, and Peek shows it.
  await form.getByRole("button", { name: "Create profile" }).click();
  await expect(form).toHaveCount(0);
  await waitForIdle(page);
  expect(await profileCount(page)).toBe(before + 1);
  const created = await page.evaluate(() => {
    const s = (window as unknown as { __shardxMock: { state: { order: string[]; profiles: Record<string, { name: string; _meta: { id: string; gpu_preset_id: string } }> } } }).__shardxMock.state;
    const p = s.profiles[s.order[s.order.length - 1]];
    return { ...p._meta, name: p.name };
  });
  expect(created.gpu_preset_id).toBe("win11-rtx3060");
  const profilePeek = page.locator("aside[data-peek]:not([data-peek='fingerprint'])");
  await expect(profilePeek).toHaveAttribute("aria-label", `Peek: ${created.name}`);
  await expect(page.locator(`[role='row'][data-profile-id='${created.id}']`)).toBeVisible();
});

test("Cancel on the form opened from a fingerprint makes nothing", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  const before = await profileCount(page);
  const saves = await mockCalls(page, "profile_save");
  await card(page, "macOS 14, Apple M1").click();
  await peek(page).getByRole("button", { name: "New profile with this fingerprint" }).click();
  const form = page.getByRole("dialog", { name: "New profile", exact: true });
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  await page.waitForTimeout(400);
  expect(await profileCount(page)).toBe(before);
  expect(await mockCalls(page, "profile_save")).toBe(saves);
});

test("New profile from a fingerprint this machine can't back asks first; Pick another opens nothing", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  const before = await profileCount(page);
  await card(page, "Windows 11, Intel Arc A770").click();
  await peek(page).getByRole("button", { name: "New profile with this fingerprint" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Pick another" }).click();
  await page.waitForTimeout(600);
  expect(await profileCount(page)).toBe(before);
  await expect(page.getByRole("dialog", { name: "New profile", exact: true })).toHaveCount(0);
  await expect(peek(page)).toBeVisible();
});

test("Use it anyway on that question opens the create form with that fingerprint chosen", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  const before = await profileCount(page);
  await card(page, "Windows 11, Intel Arc A770").click();
  await peek(page).getByRole("button", { name: "New profile with this fingerprint" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Use it anyway" }).click();
  const form = page.getByRole("dialog", { name: "New profile", exact: true });
  await expect(form.getByRole("button", { name: "Create profile" })).toBeVisible();
  await form.getByRole("tab", { name: "Fingerprint", exact: true }).click();
  await expect(form.getByRole("combobox", { name: "Fingerprint", exact: true })).toContainText("Windows 11, Intel Arc A770");
  expect(await profileCount(page)).toBe(before);
});

test("removing an imported fingerprint closes its Peek, behind an Undo toast", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  await page.evaluate(() => {
    const m = (window as unknown as { __shardxMock: { state: { fingerprints: { id: string; label: string; builtin: boolean }[] }; save: () => void } }).__shardxMock;
    m.state.fingerprints.push({ ...m.state.fingerprints[0], id: "imported-1", label: "Imported macOS", builtin: false });
    m.save();
  });
  await page.reload();
  await card(page, "Imported macOS").click();
  // F1: Remove is in the header's … menu; it asks nothing since F38 (ruling 18).
  await peek(page).locator("[data-peek-header]").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Remove fingerprint" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator("[data-toast]").filter({ has: page.getByRole("button", { name: "Undo" }) })).toContainText("Removed “Imported macOS” from the library");
  await expect(peek(page)).toHaveCount(0);
  await expect(card(page, "Imported macOS")).toHaveCount(0);
  // The keyboard goes to the next card, not to the page (Pair 18 review, M12).
  await expect(page.locator("main [role='listitem']:focus")).toHaveCount(1);
});

test("a built-in fingerprint can't be removed", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  await card(page, "macOS 14, Apple M1").click();
  // F1: the … menu lists Remove, disabled, and says why.
  await peek(page).locator("[data-peek-header]").getByRole("button", { name: "More actions" }).click();
  const remove = page.getByRole("menuitem", { name: "Remove fingerprint" });
  await expect(remove).toHaveAttribute("aria-disabled", "true");
  await expect(remove).toContainText("Built-in");
});

test("Delete removes an imported fingerprint behind Undo; on a built-in one it only says why (F28)", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  await page.evaluate(() => {
    const m = (window as unknown as { __shardxMock: { state: { fingerprints: { id: string; label: string; builtin: boolean }[] }; save: () => void } }).__shardxMock;
    m.state.fingerprints.push({ ...m.state.fingerprints[0], id: "imported-1", label: "Imported macOS", builtin: false });
    m.save();
  });
  await page.reload();
  await item(page, "macOS 14, Apple M1").focus();
  await page.keyboard.press("Backspace");
  await expect(page.locator("[data-toast]").filter({ hasText: "Built-in fingerprints can’t be removed" })).toBeVisible();
  await expect(card(page, "macOS 14, Apple M1")).toHaveCount(1);
  await item(page, "Imported macOS").focus();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator("[data-toast]").filter({ has: page.getByRole("button", { name: "Undo" }) })).toContainText("Removed “Imported macOS” from the library");
  await expect(card(page, "Imported macOS")).toHaveCount(0);
});

test("a double click on New profile from this opens the form once and makes nothing", async ({ page }) => {
  // The Profiles page doesn't ask for this machine's GPU check; the
  // Fingerprints page does, and here it is slow: the clicks land while it runs.
  await openApp(page, { section: "profiles" });
  await page.evaluate(() => {
    (window as unknown as { __shardxMockSlow: Record<string, number> }).__shardxMockSlow = { gpu_caps_compat: 3000 };
  });
  await page.locator("aside").getByText("Fingerprints", { exact: true }).click();
  const before = await profileCount(page);
  const saves = await mockCalls(page, "profile_save");
  await card(page, "Windows 11, NVIDIA RTX 3060").click();
  await peek(page).getByRole("button", { name: "New profile with this fingerprint" }).dblclick();
  const form = page.getByRole("dialog", { name: "New profile", exact: true });
  await expect(form).toHaveCount(1, { timeout: 8000 });
  await expect(page.locator("main header")).toContainText("All profiles");
  await page.waitForTimeout(800);
  await expect(form).toHaveCount(1);
  expect(await profileCount(page)).toBe(before);
  expect(await mockCalls(page, "profile_save")).toBe(saves);
});

test("Peek shows the screen's pixel ratio as the fingerprint stores it", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  await card(page, "macOS 14, Apple M1").click();
  await expect(peek(page).locator("[data-peek-section='details']")).toContainText("at 2x");
});

test("an imported fingerprint whose platform is Win32 is filed under Windows", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  await page.evaluate(() => {
    const m = (window as unknown as { __shardxMock: { state: { fingerprints: { id: string; label: string; platform: string; builtin: boolean }[] }; save: () => void } }).__shardxMock;
    const win = m.state.fingerprints.find((f) => f.id === "win11-rtx4070")!;
    m.state.fingerprints.push({ ...win, id: "imported-win32", label: "Imported Win32", platform: "Win32", builtin: false });
    m.save();
  });
  await page.reload();
  await expect(page.locator("main h2", { hasText: "Win32" })).toHaveCount(0);
  await bar(page).getByRole("radio", { name: "Windows", exact: true }).click();
  await expect(card(page, "Imported Win32")).toBeVisible();
  await card(page, "Imported Win32").click();
  await expect(peek(page).locator("[data-peek-section='details']")).toContainText("Windows");
});

test("a card holds no control of its own: one Tab stop, and Enter opens Peek", async ({ page }) => {
  await openApp(page, { section: "fingerprints" });
  const arc = card(page, "Windows 11, Intel Arc A770");
  await expect(arc).toContainText("GPU mismatch");
  await expect(arc.locator("button, a, [tabindex]")).toHaveCount(0);
});

