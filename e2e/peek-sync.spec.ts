import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle } from "./support/app";
import { pickOption } from "./support/select";

// Peek against the rest of the app: what it must never write by itself (it
// only shows; the form saves, by hand), and what it must pick up from
// elsewhere.

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const peek = (page: Page) => page.locator("aside[data-peek]");
const SANDBOX = "f62a9d43";
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name, exact: true });
const calls = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as unknown as { __shardxMock: Mock }).__shardxMock.calls[c] ?? 0, cmd);

type Stored = { name: string; notes: string; webgl?: { vendor?: string }; _meta: { rev: number; gpu_preset_id: string; proxy_id: string | null } };
type Mock = {
  state: { profiles: Record<string, Stored>; order: string[]; fingerprints: { id: string }[] };
  calls: Record<string, number>;
  save: () => void;
};
const stored = (page: Page, id = SANDBOX) =>
  page.evaluate((id) => (window as unknown as { __shardxMock: Mock }).__shardxMock.state.profiles[id], id);
/** Changes the stored profile behind the app's back, as the API would. */
const changeOnDisk = (page: Page, change: string) =>
  page.evaluate(([id, change]) => {
    const p = (window as unknown as { __shardxMock: Mock }).__shardxMock.state.profiles[id];
    new Function("p", change)(p);
  }, [SANDBOX, change] as const);
const openSandbox = async (page: Page) => {
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  await expect(peek(page).locator("[data-property='notes']")).toContainText("Throwaway. Direct connection.");
};
/** Peek's header Edit: the form on this profile. */
const openForm = async (page: Page, name = "Sandbox") => {
  await peek(page).locator("[data-peek-header]").getByRole("button", { name: "Edit", exact: true }).click();
  const d = dialog(page, `Edit ${name}`);
  await expect(d.getByRole("textbox", { name: "Name" })).toHaveValue(name);
  return d;
};
const save = async (page: Page, d: ReturnType<typeof dialog>) => {
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d).toHaveCount(0);
};

/** Deletes a proxy behind the app's back (the API, another window), then reloads the app on the same data. */
async function dropProxy(page: Page, id: string) {
  await page.evaluate(
    (id) => (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("proxy_delete", { id }),
    id,
  );
  await page.reload();
  await waitForIdle(page);
}

test("opening Peek on a profile whose template left the library writes nothing", async ({ page }) => {
  await openApp(page);
  await changeOnDisk(page, "p._meta.gpu_preset_id = 'gone-template'");
  const before = (await stored(page))._meta.rev;
  await openSandbox(page);
  await expect(peek(page).locator("[data-peek-section='fingerprint']")).toContainText("isn’t in the library any more");
  await page.waitForTimeout(1500);
  const after = await stored(page);
  expect(after._meta.gpu_preset_id).toBe("gone-template");
  expect(after._meta.rev).toBe(before);
  expect(await calls(page, "profile_save")).toBe(0);
});

test("a notes edit in the form keeps the parts of the fingerprint the form doesn't show", async ({ page }) => {
  await openApp(page);
  await changeOnDisk(page, "p.webgl = { ...p.webgl, vendor: 'Custom Vendor' }");
  await openSandbox(page);
  const d = await openForm(page);
  await d.getByRole("textbox", { name: "Notes" }).fill("edited");
  await save(page, d);
  const after = await stored(page);
  expect(after.notes).toBe("edited");
  expect(after.webgl?.vendor).toBe("Custom Vendor");
  await expect(peek(page).locator("[data-property='notes']")).toContainText("edited");
});

test("a notes edit on a profile whose template left the library keeps its fingerprint", async ({ page }) => {
  await openApp(page);
  await changeOnDisk(page, "p._meta.gpu_preset_id = 'gone-template'; p.webgl = { ...p.webgl, vendor: 'Custom Vendor' }");
  await openSandbox(page);
  const d = await openForm(page);
  await d.getByRole("textbox", { name: "Notes" }).fill("edited");
  await save(page, d);
  const after = await stored(page);
  expect(after._meta.gpu_preset_id).toBe("gone-template");
  expect(after.webgl?.vendor).toBe("Custom Vendor");
});

test("a rename in the list shows in Peek, and the form saved next keeps it", async ({ page }) => {
  await openApp(page);
  await openSandbox(page);
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  await page.keyboard.press("e");
  const input = page.locator(`[data-profile-id='${SANDBOX}']`).getByRole("textbox", { name: "Name" });
  await input.fill("Sandbox 2");
  await page.keyboard.press("Enter");
  await expect(peek(page).locator("[data-peek-header]").getByRole("heading", { level: 2 })).toHaveText("Sandbox 2");
  const d = await openForm(page, "Sandbox 2");
  await d.getByRole("textbox", { name: "Notes" }).fill("after rename");
  await save(page, d);
  const after = await stored(page);
  expect([after.name, after.notes]).toEqual(["Sandbox 2", "after rename"]);
});

test("a proxy chosen in the list while Peek is open shows in Peek, and the form saved next keeps it", async ({ page }) => {
  await openApp(page);
  await openSandbox(page);
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  await page.keyboard.press("p");
  const picker = page.getByRole("dialog", { name: /Proxy/ });
  await picker.getByRole("combobox", { name: "Proxy", exact: true }).click();
  await page.getByRole("option", { name: /DC Tokyo/ }).click();
  await expect(row(page, "Sandbox").locator("[data-cell='proxy']")).toContainText("DC Tokyo");
  await expect(picker).toHaveCount(0);
  await expect(peek(page).locator("[data-property='proxy']")).toContainText("DC Tokyo");
  const d = await openForm(page);
  await d.getByRole("textbox", { name: "Notes" }).fill("after proxy");
  await save(page, d);
  expect((await stored(page))._meta.proxy_id).toBe("px-jp-1");
});

test("Start right after saving a proxy in the form launches with that proxy", async ({ page }) => {
  await openApp(page);
  await openSandbox(page);
  await peek(page).locator("[data-property='proxy'] button").click();
  const d = dialog(page, "Edit Sandbox");
  await d.locator("[data-property='proxy'] button").click();
  await page.getByRole("option", { name: /DC Tokyo/ }).click();
  await save(page, d);
  await peek(page).getByRole("button", { name: "Start" }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __shardxMockLaunches?: { id: string; proxy_id: string | null }[] }).__shardxMockLaunches ?? [],
  )).toEqual([{ id: SANDBOX, proxy_id: "px-jp-1" }]);
});

// The proxy-missing guard reads the list's copy of the profile: a proxy
// fixed in the form and saved, then Start at once, must not be refused on
// the copy from before the save.
test("Start right after fixing a deleted proxy in the form launches, not refused on stale data", async ({ page }) => {
  await openApp(page);
  await dropProxy(page, "px-jp-1"); // FB Ads acc-02's proxy
  await row(page, "FB Ads acc-02").locator("[data-cell='name']").click();
  await expect(peek(page).locator("[data-property='proxy'] button")).toContainText("Proxy missing");
  await peek(page).locator("[data-property='proxy'] button").click();
  const d = dialog(page, "Edit FB Ads acc-02");
  await d.locator("[data-property='proxy'] button").click();
  await page.getByRole("option", { name: /DC New York/ }).click();
  await save(page, d);
  await peek(page).getByRole("button", { name: "Start" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "won’t start" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __shardxMockLaunches?: { id: string; proxy_id: string | null }[] }).__shardxMockLaunches ?? [],
  )).toEqual([{ id: "c31d92f1", proxy_id: "px-us-2" }]);
});

test("moving Peek's profile to the Trash closes Peek, and the list fits its card again", async ({ page }) => {
  await openApp(page);
  await openSandbox(page);
  const grid = page.getByRole("treegrid", { name: "Profiles" });
  // Beside Peek every column stays: the list scrolls sideways inside its card.
  await expect(page.getByRole("columnheader", { name: "Notes" })).toHaveCount(1);
  expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await row(page, "Sandbox").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(row(page, "Sandbox")).toHaveCount(0);
  await expect(peek(page)).toHaveCount(0);
  await expect.poll(() => grid.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  // Nothing waited on, nothing written: Peek has no pending edit to flush.
  expect(await calls(page, "profile_save")).toBe(0);
});

test("a fingerprint saved in the form shows in Peek's rows", async ({ page }) => {
  await openApp(page);
  await openSandbox(page);
  await expect(peek(page).locator("[data-property='timezone']")).toContainText("Auto (from proxy)");
  await peek(page).locator("[data-peek-section='fingerprint']").getByRole("button", { name: "Edit", exact: true }).click();
  const d = dialog(page, "Edit Sandbox");
  await pickOption(d, "Timezone", "Europe/Berlin");
  await save(page, d);
  await expect(peek(page).locator("[data-property='timezone']")).toContainText("Europe/Berlin");
});

test("a profile changed on disk is read again when Peek comes back to it", async ({ page }) => {
  await openApp(page);
  await openSandbox(page);
  await expect(peek(page).locator("[data-property='timezone']")).toContainText("Auto (from proxy)");
  await changeOnDisk(page, "p.timezone = 'Asia/Tokyo'; p._meta.rev += 1");
  await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: Etsy craft shop");
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  await expect(peek(page).locator("[data-property='timezone']")).toContainText("Asia/Tokyo");
});

test("saving from the form doesn't re-read the whole profile list", async ({ page }) => {
  await openApp(page);
  await openSandbox(page);
  await waitForIdle(page);
  const d = await openForm(page);
  await page.evaluate(() => {
    const calls = (window as unknown as { __shardxMock: Mock }).__shardxMock.calls;
    for (const k of Object.keys(calls)) delete calls[k];
  });
  await d.getByRole("textbox", { name: "Notes" }).fill("cheap");
  await save(page, d);
  await page.waitForTimeout(500);
  await expect(row(page, "Sandbox").locator("[data-cell='name']")).toBeVisible();
  expect(await calls(page, "profile_list")).toBe(0);
});

test("with reduced motion Peek appears without sliding", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openApp(page);
  await openSandbox(page);
  expect(await peek(page).evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

test("switching the form's OS picks a fingerprint this machine can back", async ({ page }) => {
  await openApp(page);
  // The first Linux fingerprint in the library is one this machine can't back.
  await page.evaluate(() => {
    const m = (window as unknown as { __shardxMock: Mock }).__shardxMock;
    const fps = m.state.fingerprints;
    const i = fps.findIndex((f) => f.id === "linux-nvidia-1660");
    fps.unshift(...fps.splice(i, 1));
    m.save();
  });
  await page.reload();
  await waitForIdle(page);
  await openSandbox(page);
  await peek(page).locator("[data-peek-section='fingerprint']").getByRole("button", { name: "Edit", exact: true }).click();
  const d = dialog(page, "Edit Sandbox");
  await d.getByRole("radio", { name: "Linux", exact: true }).click();
  await save(page, d);
  await expect.poll(async () => (await stored(page))._meta.gpu_preset_id, { timeout: 5000 }).toMatch(/^linux-/);
  expect((await stored(page))._meta.gpu_preset_id).not.toBe("linux-nvidia-1660");
  await expect(peek(page).locator("[data-property='os']")).toContainText("Linux");
});
