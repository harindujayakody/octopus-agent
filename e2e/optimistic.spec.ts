import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp, openEditForm, pressCreate, reloadApp, waitForIdle } from "./support/app";

// Every edit shows before the backend answers and goes back, with a
// message, when it fails (overview section 2; PERF-13, LQ-03, IFACE-14).
// Tasks 3 to 7 of the Phase D plan add to this file.
type M = { __shardxMock: { pending: number; calls: Record<string, number>; emit: (e: string, p: unknown) => void; state: { order: string[]; profiles: Record<string, { name: string }> } } };
const SANDBOX = "f62a9d43";
const ETSY = "aed41005";
const row = (page: Page, id: string) => page.locator(`[role='row'][data-profile-id='${id}']`);
const cell = (page: Page, id: string, c: string) => row(page, id).locator(`[data-cell='${c}']`);
/** A failure toast (C23 `toast.fail`): its title names what failed, and the
 *  backend's words are its detail, a line of their own. */
async function expectFailure(page: Page, title: string, detail: string) {
  const toast = page.locator("[data-toast]").filter({ has: page.getByText(title, { exact: true }) });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(detail);
}
/** Words on a toast. The live region says them too (C24), so a check scoped
 *  to the page would find them twice. */
const toastText = (page: Page, text: string | RegExp) => page.locator("[data-toast]").getByText(text);
/** Sets a mock knob (`__shardxMockSlow`, `__shardxMockFail`, …) on the running page. */
const knob = (page: Page, name: string, value: unknown) =>
  page.evaluate(([n, v]) => { (window as unknown as Record<string, unknown>)[n as string] = v; }, [name, value] as const);
/** Slow mock calls still in flight. */
const inFlight = (page: Page) => page.evaluate(() => (window as unknown as M).__shardxMock.pending);
const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as unknown as M).__shardxMock.calls[c] ?? 0, cmd);

type O = typeof import("../src/entities/profile/lib/optimistic");

test("pending edits and placeholder rows stay over every list the backend returns", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/entities/profile/lib/optimistic.ts", "__o");
  const out = await page.evaluate(() => {
    const o = (window as unknown as { __o: O }).__o;
    const meta = (id: string, name: string) => ({
      id, name, notes: "", proxy_id: null, last_launched_at: null, created_at: null, pinned: false,
      folder: "", total_runtime_ms: 0, color: null, extensions: [] as string[], mobile: false,
    });
    const fresh = [meta("a", "A"), meta("b", "B"), meta("c", "C")];
    const edit = o.beginEdit("a", { name: "A2" });
    const pid = o.newPlaceholderId();
    o.addPlaceholder(meta(pid, "New"), 1);
    const view = o.localView(fresh, new Set(["c"])).map((p) => p.name);
    o.endEdit(edit);
    o.dropPlaceholder(pid);
    const after = o.localView(fresh, new Set()).map((p) => p.name);
    const copy = fresh.map((p) => ({ ...p, extensions: [...p.extensions] }));
    const same = o.shareRows(fresh, copy, o.sameMeta);
    const changed = o.shareRows(fresh, [copy[0], { ...copy[1], name: "B2" }, copy[2]], o.sameMeta);
    return {
      view, after, placeholder: o.isPlaceholder(pid), real: o.isPlaceholder("a"),
      sameArray: same === fresh, keptA: changed[0] === fresh[0], newB: changed[1] !== fresh[1], keptC: changed[2] === fresh[2],
    };
  });
  expect(out).toEqual({
    view: ["A2", "New", "B"], after: ["A", "B", "C"], placeholder: true, real: false,
    sameArray: true, keptA: true, newB: true, keptC: true,
  });
});

test("a failed edit goes back past older edits of its field, never past newer ones", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/entities/profile/lib/optimistic.ts", "__o");
  const out = await page.evaluate(() => {
    const o = (window as unknown as { __o: O }).__o;
    const a = {
      id: "r", name: "A", notes: "", proxy_id: null, last_launched_at: null, created_at: null, pinned: false,
      folder: "", total_runtime_ms: 0, color: null, extensions: [] as string[], mobile: false,
    };
    const shows = (name: string) => ({ ...a, name });
    // Both fail, the older first: the newer takes over its before-value.
    const b = o.beginEdit("r", { name: "B" }, shows("A"));
    const c = o.beginEdit("r", { name: "C" }, shows("B"));
    o.endEdit(b);
    const olderFirst = o.revertOf(b, shows("C"));
    o.endEdit(c);
    const thenNewer = o.revertOf(c, shows("C"));
    // The newer fails while the older is on its way: back to the older's value.
    const d = o.beginEdit("r", { name: "D" }, shows("A"));
    const e = o.beginEdit("r", { name: "E" }, shows("D"));
    o.endEdit(e);
    const newerFirst = o.revertOf(e, shows("E"));
    o.endEdit(d);
    return { olderFirst, thenNewer, newerFirst };
  });
  expect(out).toEqual({ olderFirst: {}, thenNewer: { name: "A" }, newerFirst: { name: "D" } });
});

test("a reload keeps the object of every row that did not change", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/entities/profile/index.ts", "__profile");
  type P = { __profile: { useProfile: { getState: () => { profiles: { id: string }[]; reload: () => Promise<void> } } } };
  const unchanged = await page.evaluate(async () => {
    const s = (window as unknown as P).__profile.useProfile;
    const before = s.getState().profiles;
    await s.getState().reload();
    return s.getState().profiles === before;
  });
  expect(unchanged).toBe(true);
  // The backend renames one profile behind the app's back.
  await page.evaluate((id) => { const m = (window as unknown as M).__shardxMock; m.state.profiles[id].name = "Renamed elsewhere"; }, SANDBOX);
  const kept = await page.evaluate(async (id) => {
    const s = (window as unknown as P).__profile.useProfile;
    const before = s.getState().profiles;
    await s.getState().reload();
    const after = s.getState().profiles;
    return { others: after.filter((p) => p.id !== id).every((p) => before.includes(p)), changed: !before.includes(after.find((p) => p.id === id)!) };
  }, SANDBOX);
  expect(kept).toEqual({ others: true, changed: true });
});

test("a store skips its own echo on the bus, and hears the others", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/shared/lib/storeBus.ts", "__bus");
  type B = { __bus: { storeBus: { emit: (topic: string, from?: string) => void } } };
  const before = await calls(page, "profile_list");
  await page.evaluate(() => (window as unknown as B).__bus.storeBus.emit("profiles", "profiles"));
  await page.waitForTimeout(400);
  expect(await calls(page, "profile_list")).toBe(before);
  await page.evaluate(() => (window as unknown as B).__bus.storeBus.emit("profiles", "trash"));
  await expect.poll(() => calls(page, "profile_list")).toBe(before + 1);
  await waitForIdle(page);
});

async function renameInline(page: Page, id: string, name: string) {
  await row(page, id).focus();
  await page.keyboard.press("e");
  const box = page.getByRole("textbox", { name: "Name" });
  await box.fill(name);
  await box.press("Enter");
  // The keyboard goes back to the row a frame after Enter; a rename started
  // inside that frame would lose its field to it.
  await expect(row(page, id)).toBeFocused();
}

test("an inline rename shows at once, before the backend answers", async ({ page }) => {
  await openApp(page);
  await knob(page, "__shardxMockSlow", { profile_save: 3000 });
  await renameInline(page, SANDBOX, "Sandbox two");
  await expect(cell(page, SANDBOX, "name")).toHaveText("Sandbox two", { timeout: 1000 });
  expect(await inFlight(page)).toBeGreaterThan(0);
  await waitForIdle(page);
  await expect(cell(page, SANDBOX, "name")).toHaveText("Sandbox two");
  // No list read after its own edit (PERF-13).
});

test("a rename the backend refuses goes back, and says what failed", async ({ page }) => {
  await openApp(page);
  await knob(page, "__shardxMockFail", { profile_save: 1 });
  await renameInline(page, SANDBOX, "Sandbox two");
  await expectFailure(page, 'Couldn’t rename “Sandbox”', "Mock failure: profile_save");
  await expect(cell(page, SANDBOX, "name")).toHaveText("Sandbox");
});

test("a rename that fails does not undo the rename made after it", async ({ page }) => {
  await openApp(page);
  // The first save fails; the second rename is made while the first is on its way.
  await knob(page, "__shardxMockSlow", { profile_get: 800 });
  await knob(page, "__shardxMockFail", { profile_save: 1 });
  await renameInline(page, SANDBOX, "First");
  await renameInline(page, SANDBOX, "Second");
  await expect(toastText(page, 'Couldn’t rename “Sandbox”')).toBeVisible();
  await waitForIdle(page);
  await expect(cell(page, SANDBOX, "name")).toHaveText("Second");
});

test("two renames that both fail end on the name the backend has", async ({ page }) => {
  await openApp(page);
  // The second rename is made while the first is on its way; both saves fail.
  await knob(page, "__shardxMockSlow", { profile_get: 800 });
  await knob(page, "__shardxMockFail", { profile_save: 2 });
  await renameInline(page, SANDBOX, "First");
  await renameInline(page, SANDBOX, "Second");
  await waitForIdle(page);
  await expect(cell(page, SANDBOX, "name")).toHaveText("Sandbox");
});

// The Proxy cell names the proxy since F17 (Pairs 22+23), so these read
// "DC Tokyo" where they read its address.
test("a bind that fails while an earlier bind is on its way ends on the earlier proxy", async ({ page }) => {
  await openApp(page);
  const pick = async (proxy: RegExp) => {
    // A double-click edits the cell; a plain click opens Peek (E14, EMIL-12).
    await cell(page, SANDBOX, "proxy").dblclick();
    await page.getByRole("combobox", { name: "Proxy", exact: true }).last().click();
    await page.getByRole("option", { name: proxy }).click();
  };
  await knob(page, "__shardxMockSlow", { profile_bind_proxy: 3000 });
  await pick(/DC Tokyo/);
  await expect(cell(page, SANDBOX, "proxy")).toContainText("DC Tokyo", { timeout: 1000 });
  await knob(page, "__shardxMockSlow", {});
  await knob(page, "__shardxMockFail", { profile_bind_proxy: 1 });
  await pick(/DC New York/);
  await expect(toastText(page, 'Couldn’t change the proxy of “Sandbox”')).toBeVisible();
  await expect(cell(page, SANDBOX, "proxy")).toContainText("DC Tokyo");
  await waitForIdle(page);
  await expect(cell(page, SANDBOX, "proxy")).toContainText("DC Tokyo");
});

test("a reload while a rename is on its way keeps the new name", async ({ page }) => {
  await openApp(page);
  await knob(page, "__shardxMockSlow", { profile_save: 3000 });
  await renameInline(page, SANDBOX, "Sandbox two");
  await expect(cell(page, SANDBOX, "name")).toHaveText("Sandbox two", { timeout: 1000 });
  // The API changed something: the app reloads 200 ms after the event.
  await page.evaluate(() => (window as unknown as M).__shardxMock.emit("store-changed", "profiles"));
  await page.waitForTimeout(700);
  await expect(cell(page, SANDBOX, "name")).toHaveText("Sandbox two");
});

test("notes typed in the row show at once", async ({ page }) => {
  await openApp(page);
  await knob(page, "__shardxMockSlow", { profile_save: 3000 });
  // Near its left edge: the row's hover actions cover the rest of the Notes
  // cell. The edit starts from the cell's edit button, and Enter saves it
  // (as in profiles-inline-edit.spec.ts).
  const at = (await cell(page, SANDBOX, "notes").boundingBox())!;
  await page.mouse.move(at.x + 4, at.y + 8);
  await row(page, SANDBOX).getByRole("button", { name: /^Edit notes/ }).click();
  const box = row(page, SANDBOX).getByRole("textbox", { name: "Notes" });
  await box.fill("Keep for tests");
  await box.press("Enter");
  await expect(cell(page, SANDBOX, "notes")).toContainText("Keep for tests", { timeout: 1000 });
  expect(await inFlight(page)).toBeGreaterThan(0);
});

test("Pin moves the row into the pinned group at once, and back when it fails", async ({ page }) => {
  await openApp(page);
  const rows = page.locator("[role='row'][data-profile-id]");
  await knob(page, "__shardxMockSlow", { profile_set_pin: 3000 });
  await row(page, SANDBOX).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  // Pinned rows sort first: Sandbox joins the two seeded pins.
  await expect(rows.nth(2)).toHaveAttribute("data-profile-id", SANDBOX, { timeout: 1000 });
  expect(await inFlight(page)).toBeGreaterThan(0);
  await waitForIdle(page);
  await knob(page, "__shardxMockSlow", {});
  await knob(page, "__shardxMockFail", { profile_set_pin: 1 });
  await row(page, SANDBOX).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Unpin", exact: true }).click();
  await expectFailure(page, 'Couldn’t unpin “Sandbox”', "Mock failure: profile_set_pin");
  await expect(rows.nth(2)).toHaveAttribute("data-profile-id", SANDBOX);
});

test("a proxy picked in the row shows at once, and the old one comes back when the bind fails", async ({ page }) => {
  await openApp(page);
  await knob(page, "__shardxMockSlow", { profile_bind_proxy: 3000 });
  // A double-click edits the cell; a plain click opens Peek (E14, EMIL-12).
  await cell(page, SANDBOX, "proxy").dblclick();
  await page.getByRole("combobox", { name: "Proxy", exact: true }).last().click();
  await page.getByRole("option", { name: /DC Tokyo/ }).click();
  await expect(cell(page, SANDBOX, "proxy")).toContainText("DC Tokyo", { timeout: 1000 });
  expect(await inFlight(page)).toBeGreaterThan(0);
  await waitForIdle(page);
  await knob(page, "__shardxMockSlow", {});
  await knob(page, "__shardxMockFail", { profile_bind_proxy: 1 });
  await cell(page, ETSY, "proxy").dblclick();
  await page.getByRole("combobox", { name: "Proxy", exact: true }).last().click();
  await page.getByRole("option", { name: /DC Tokyo/ }).click();
  await expect(toastText(page, 'Couldn’t change the proxy of “Etsy craft shop”')).toBeVisible();
  await expect(cell(page, ETSY, "proxy")).not.toContainText("DC Tokyo");
});

test("a name saved in the profile form shows in the list when its save starts", async ({ page }) => {
  await openApp(page);
  const form = await openEditForm(page, "Sandbox");
  await knob(page, "__shardxMockSlow", { profile_save: 3000 });
  await form.getByRole("textbox", { name: "Name" }).fill("Sandbox from the form");
  // Nothing is written, and the list does not move, until Save.
  await expect(cell(page, SANDBOX, "name")).toHaveText("Sandbox");
  expect(await inFlight(page)).toBe(0);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  // The row shows the name as the save starts, not 3 s later.
  await expect(cell(page, SANDBOX, "name")).toHaveText("Sandbox from the form", { timeout: 1500 });
  expect(await inFlight(page)).toBeGreaterThan(0);
});

const folder = (page: Page, name: string) => page.locator(`aside [data-folder='${name}']`);

test("moving a row out of the Folder you are looking at says where it went, with Undo", async ({ page }) => {
  await openApp(page);
  await folder(page, "Shops").click();
  await knob(page, "__shardxMockSlow", { profile_set_folder: 3000 });
  await row(page, ETSY).focus();
  await page.keyboard.press("m");
  await page.getByRole("dialog", { name: "Move to folder" }).getByRole("option", { name: /^Ads/ }).click();
  await expect(row(page, ETSY)).toHaveCount(0, { timeout: 1000 });
  const toast = toastText(page, 'Moved “Etsy craft shop” to “Ads”');
  await expect(toast).toBeVisible();
  expect(await inFlight(page)).toBeGreaterThan(0);
  await waitForIdle(page);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, ETSY)).toHaveCount(1, { timeout: 1000 });
  await waitForIdle(page);
  const back = await page.evaluate((id) => (window as unknown as { __shardxMock: { state: { profiles: Record<string, { _meta: { folder: string } }> } } }).__shardxMock.state.profiles[id]._meta.folder, ETSY);
  expect(back).toBe("Shops");
});

test("Undo of a move out of the Folder puts the rows back in the list and in the selection", async ({ page }) => {
  await openApp(page);
  await folder(page, "Shops").click();
  const EBAY = "9828bf28";
  for (const id of [ETSY, EBAY]) await row(page, id).locator("[data-cell='checkbox'] input").check({ force: true });
  await row(page, ETSY).focus();
  await page.keyboard.press("m");
  await page.getByRole("dialog", { name: "Move to folder" }).getByRole("option", { name: /^Ads/ }).click();
  await expect(toastText(page, 'Moved 2 profiles to “Ads”')).toBeVisible();
  // A selection holds listed rows: the two left it with the list (ruling F13).
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  // Back in both, so nobody has to select them again.
  for (const id of [ETSY, EBAY]) await expect(row(page, id)).toHaveAttribute("aria-selected", "true");
  await waitForIdle(page);
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(2);
});

test("a move that stays in view says nothing: the row shows its new Folder", async ({ page }) => {
  await openApp(page);
  await knob(page, "__shardxMockSlow", { profile_set_folder: 3000 });
  await row(page, SANDBOX).focus();
  await page.keyboard.press("m");
  await page.getByRole("dialog", { name: "Move to folder" }).getByRole("option", { name: /^Ads/ }).click();
  await expect(cell(page, SANDBOX, "folder")).toContainText("Ads", { timeout: 1000 });
  await page.waitForTimeout(500);
  await expect(toastText(page, /Moved “Sandbox”/)).toHaveCount(0);
});

test("a move the backend refuses comes back, and says what failed", async ({ page }) => {
  await openApp(page);
  await knob(page, "__shardxMockFail", { profile_set_folder: 1 });
  await row(page, SANDBOX).focus();
  await page.keyboard.press("m");
  await page.getByRole("dialog", { name: "Move to folder" }).getByRole("option", { name: /^Ads/ }).click();
  await expectFailure(page, 'Couldn’t move “Sandbox”', "Mock failure: profile_set_folder");
  await expect(cell(page, SANDBOX, "folder")).not.toContainText("Ads");
});

test("Assign shows each profile's new proxy before the binds finish", async ({ page }) => {
  await openApp(page);
  for (const id of [SANDBOX, ETSY]) await row(page, id).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: /Assign proxies/ }).click();
  const dialog = page.getByRole("dialog", { name: /Assign proxies/ });
  await dialog.getByRole("checkbox", { name: "Unused only" }).uncheck();
  await dialog.getByRole("option", { name: /^DC Tokyo/ }).click();
  await dialog.getByRole("checkbox", { name: "Allow sharing" }).check();
  await knob(page, "__shardxMockSlow", { profile_bind_proxy: 3000 });
  await dialog.getByRole("button", { name: "Assign 2" }).click();
  for (const id of [SANDBOX, ETSY]) await expect(cell(page, id, "proxy")).toContainText("DC Tokyo", { timeout: 1000 });
  expect(await inFlight(page)).toBeGreaterThan(0);
});

const peek = (page: Page) => page.locator("aside[data-peek]");
const newRow = (page: Page) => page.locator("[role='row'][data-profile-id^='pending:']");

// A new profile is made by the profile form's Create profile (manual save,
// e2e/profile-form.spec.ts). A row still being created is now a copy: Clone
// shows it at once and its call runs behind it, as below.
/** Clone on Sandbox: its copy's row shows at once, still being created. */
async function cloneSandbox(page: Page) {
  await row(page, SANDBOX).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Clone" }).click();
  await expect(newRow(page)).toHaveCount(1);
}

test("a rename made before the clone finishes lands on the copy", async ({ page }) => {
  await openApp(page);
  await knob(page, "__shardxMockSlow", { profile_clone: 1500 });
  await cloneSandbox(page);
  await newRow(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const box = page.getByRole("textbox", { name: "Name" }).first();
  await box.fill("Early name");
  await box.press("Enter");
  await expect(page.locator("[role='row'][data-profile-id]", { hasText: "Early name" })).toHaveCount(1);
  await waitForIdle(page);
  const names = await page.evaluate(() => { const s = (window as unknown as M).__shardxMock.state; return s.order.map((id) => s.profiles[id].name); });
  expect(names).toContain("Early name");
  await expect(page.locator("[role='row'][data-profile-id]", { hasText: "Early name" })).not.toHaveAttribute("data-profile-id", /^pending:/);
});

test("a new profile that the View hides says so, with Show in list", async ({ page }) => {
  await openApp(page);
  await page.locator("aside [data-view='builtin:running']").click();
  await page.getByRole("button", { name: "New profile" }).first().click();
  await pressCreate(page);
  const toast = toastText(page, /^Created “Profile \d+”\. This view hides it\.$/);
  await expect(toast).toBeVisible();
  await page.getByRole("button", { name: "Show in list" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("All profiles");
  await expect(page.locator("[role='row'][data-active]")).toContainText(/Profile \d+/);
});

test("import from the clipboard selects what it brought in and shows the first", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    (window as unknown as { __shardxMockClipboard: string }).__shardxMockClipboard = JSON.stringify([{ name: "Imported one" }, { name: "Imported two" }]);
  });
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("import");
  await page.keyboard.press("Enter");
  const imported = page.locator("[role='row'][data-profile-id]", { hasText: /Imported (one|two)/ });
  await expect(imported).toHaveCount(2);
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(2);
  await expect(page.locator("[role='row'][data-active]")).toContainText("Imported");
});

test("an import adds what it brought in to the rows already selected", async ({ page }) => {
  await openApp(page);
  await row(page, SANDBOX).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.evaluate(() => {
    (window as unknown as { __shardxMockClipboard: string }).__shardxMockClipboard = JSON.stringify([{ name: "Imported one" }]);
  });
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("import");
  await page.keyboard.press("Enter");
  await expect(page.locator("[role='row'][data-profile-id]", { hasText: "Imported one" })).toHaveAttribute("aria-selected", "true");
  // Ruling F4: the selection grows, it is not replaced.
  await expect(row(page, SANDBOX)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(2);
});

test("a copy moved to the Trash before its clone finishes goes there, and Undo brings it back", async ({ page }) => {
  await openApp(page);
  await knob(page, "__shardxMockSlow", { profile_clone: 1500 });
  await cloneSandbox(page);
  const name = (await newRow(page).locator("[data-cell='name']").textContent())!.trim();
  await newRow(page).focus();
  await page.keyboard.press("Delete");
  await expect(newRow(page)).toHaveCount(0);
  await expect(toastText(page, `Moved “${name}” to Trash`)).toBeVisible({ timeout: 6000 });
  await waitForIdle(page);
  expect(await page.evaluate(() => (window as unknown as M).__shardxMock.state.order.length)).toBe(8);
  await page.getByRole("button", { name: "Undo" }).click();
  await waitForIdle(page);
  await expect(page.locator("[role='row'][data-profile-id]", { hasText: name })).toHaveCount(1);
});

test("Clone shows the copy at once, then offers to open it", async ({ page }) => {
  await openApp(page);
  await knob(page, "__shardxMockSlow", { profile_clone: 3000 });
  await row(page, SANDBOX).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Clone" }).click();
  const copy = page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox (copy)" });
  await expect(copy).toHaveCount(1, { timeout: 1000 });
  expect(await inFlight(page)).toBeGreaterThan(0);
  await expect(toastText(page, 'Cloned “Sandbox”')).toBeVisible({ timeout: 6000 });
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator("aside[data-peek]")).toHaveAttribute("aria-label", "Peek: Sandbox (copy)");
});

test("a clone the backend refuses takes its row away and says why", async ({ page }) => {
  await openApp(page);
  await knob(page, "__shardxMockFail", { profile_clone: 1 });
  await row(page, SANDBOX).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Clone" }).click();
  await expectFailure(page, 'Couldn’t clone “Sandbox”', "Mock failure: profile_clone");
  await expect(page.locator("[role='row'][data-profile-id]", { hasText: "(copy)" })).toHaveCount(0);
});

test("Undo brings rows back at once, where they were", async ({ page }) => {
  await openApp(page);
  const ids = () => page.locator("[role='row'][data-profile-id]").evaluateAll((rs) => rs.map((r) => r.getAttribute("data-profile-id")));
  const order = await ids();
  await row(page, ETSY).focus();
  await page.keyboard.press("Delete");
  await expect(row(page, ETSY)).toHaveCount(0);
  await waitForIdle(page);
  await knob(page, "__shardxMockSlow", { trash_restore: 3000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(ids, { timeout: 1000 }).toEqual(order);
  expect(await inFlight(page)).toBeGreaterThan(0);
  await waitForIdle(page);
  await reloadApp(page);
  await expect.poll(ids).toEqual(order); // the mock puts it back in place too (PC-069)
});

/** A Trash entry's row, hovered so its Restore shows (the list recipe, F25a). */
const trashRow = async (page: Page, name: string) => {
  const row = page.getByRole("treegrid", { name: "Trash" }).locator("[role='row'][data-row-id]").filter({ hasText: name });
  await row.hover();
  return row;
};

test("Restore in the Trash leaves the list at once, then offers Show in list", async ({ page }) => {
  await openApp(page, { section: "trash" });
  await knob(page, "__shardxMockSlow", { trash_restore: 3000 });
  const entry = page.locator("main").getByText("Amazon UK old", { exact: true });
  await (await trashRow(page, "Amazon UK old")).getByRole("button", { name: "Restore" }).click();
  await expect(entry).toHaveCount(0, { timeout: 1000 });
  await page.getByRole("button", { name: "Show in list" }).click({ timeout: 8000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("All profiles");
  await expect(page.locator("[role='row'][data-active]")).toContainText("Amazon UK old");
});

test("a restore that fails puts the entry back and says why", async ({ page }) => {
  await openApp(page, { section: "trash" });
  await knob(page, "__shardxMockFail", { trash_restore: 1 });
  const entry = page.locator("main").getByText("Amazon UK old", { exact: true });
  await (await trashRow(page, "Amazon UK old")).getByRole("button", { name: "Restore" }).click();
  await expectFailure(page, 'Couldn’t restore “Amazon UK old”', "Mock failure: trash_restore");
  await expect(entry).toHaveCount(1);
});

test("a tag and Copy ID on a row still being created land on the new profile", async ({ page }) => {
  await openApp(page);
  await knob(page, "__shardxMockSlow", { profile_clone: 2500 });
  await cloneSandbox(page);
  const name = (await newRow(page).locator("[data-cell='name']").textContent())!.trim();
  await newRow(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit tags" }).click();
  const tags = page.getByRole("dialog", { name: "Tags" });
  await tags.getByRole("combobox", { name: "Find or create a tag" }).fill("Early tag");
  await tags.getByRole("option", { name: /Create/ }).click();
  await page.keyboard.press("Escape");
  await expect(tags).toHaveCount(0);
  await newRow(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy ID" }).click();
  expect(await inFlight(page)).toBeGreaterThan(0);
  await waitForIdle(page);
  const made = page.locator("[role='row'][data-profile-id]", { hasText: name });
  const id = await made.getAttribute("data-profile-id");
  expect(id).not.toMatch(/^pending:/);
  // The tag stayed with the profile when it got its real id.
  await expect(made.locator("[data-cell='tags']")).toContainText("Early tag");
  // Copy ID waited for the real id: never a pending one.
  await expect(toastText(page, "Copied profile ID")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __shardxMockClipboard?: string }).__shardxMockClipboard)).toBe(id);
});

test("a row Undo put back waits for its restore before Start or Peek use it", async ({ page }) => {
  await openApp(page);
  await row(page, SANDBOX).focus();
  await page.keyboard.press("Delete");
  await expect(row(page, SANDBOX)).toHaveCount(0);
  await waitForIdle(page);
  await knob(page, "__shardxMockSlow", { trash_restore: 2000 });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, SANDBOX)).toHaveCount(1, { timeout: 1000 });
  // Peek and Start, while the backend still has the profile in the Trash.
  await cell(page, SANDBOX, "name").click();
  await row(page, SANDBOX).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Start" }).click();
  expect(await inFlight(page)).toBeGreaterThan(0);
  await waitForIdle(page);
  await expect(toastText(page, /not found/)).toHaveCount(0);
  // Peek read the restored profile: its title and its fingerprint rows (a read of the stored form).
  await expect(peek(page).getByRole("heading", { name: "Sandbox", level: 2 })).toBeVisible();
  await expect(peek(page).locator("[data-peek-section='fingerprint'] [data-property='os']")).toBeVisible();
  expect(await page.evaluate((id) => id in (window as unknown as { __shardxMock: { state: { running: Record<string, unknown> } } }).__shardxMock.state.running, SANDBOX)).toBe(true);
});

test("an inline rename open when the clone finishes keeps its text and the keyboard", async ({ page }) => {
  await openApp(page);
  await knob(page, "__shardxMockSlow", { profile_clone: 2000 });
  await cloneSandbox(page);
  await newRow(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const box = page.locator("[role='row'][data-profile-id]").getByRole("textbox", { name: "Name" });
  await box.fill("Half typed");
  await waitForIdle(page);
  await expect(newRow(page)).toHaveCount(0);
  // The row took its real id under the open field, which keeps the keyboard.
  await expect(box).toHaveValue("Half typed");
  await expect(box).toBeFocused();
  await box.press("Enter");
  await expect(page.locator("[role='row'][data-profile-id]", { hasText: "Half typed" })).toHaveCount(1);
});

// The five actions that take a list of rows wait for a row's real id
// (`realIds`) and never send the backend a pending one (Pair 9 re-review,
// Minor C). Each runs on a row still being created (a clone), then must
// reach its command with the id the clone returned. Export and Regenerate
// are checked by what only they produce (D4m review, Important 1): each case
// names its `check`, a backend command it must reach or an effect only it has.
const REAL_ID_ACTIONS = [
  { action: "Export cookies", check: { cmd: "cookies_export_to_file" } },
  { action: "Import cookies", check: { cmd: "cookies_import" } },
  { action: "Launch synced", check: { cmd: "sync_launch" } },
  { action: "Export", check: { effect: "clipboard" } },
  { action: "Regenerate fingerprint", check: { effect: "fingerprint" } },
] as const;
for (const { action, check } of REAL_ID_ACTIONS) {
  test(`${action} on a row still being created sends its real id, never the pending one`, async ({ page }) => {
    await openApp(page);
    await appModule(page, "/src/entities/profile/index.ts", "__profile");
    // Every backend call from here on, with its arguments.
    await page.evaluate(() => {
      type Invoke = (cmd: string, args?: unknown, opts?: unknown) => Promise<unknown>;
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke }; __sent: string[] };
      const invoke = w.__TAURI_INTERNALS__.invoke;
      w.__sent = [];
      w.__TAURI_INTERNALS__.invoke = (cmd, args, opts) => { w.__sent.push(`${cmd} ${JSON.stringify(args ?? {})}`); return invoke(cmd, args, opts); };
    });
    await knob(page, "__shardxMockSlow", { profile_clone: 1500 });
    await cloneSandbox(page);
    const pending = (await newRow(page).getAttribute("data-profile-id"))!;
    const chooser = action === "Import cookies" ? page.waitForEvent("filechooser") : null;
    await page.evaluate(([a, id, other]) => {
      type P = { id: string };
      type S = {
        profiles: P[];
        exportCookies: (p: P) => Promise<void>; importCookies: (p: P) => Promise<void>;
        launchSynced: (ids: string[]) => Promise<boolean>; exportMany: (ids: string[]) => Promise<void>;
        regenerateFingerprints: (ids: string[]) => Promise<number>;
      };
      const s = (window as unknown as { __profile: { useProfile: { getState: () => S } } }).__profile.useProfile.getState();
      const p = s.profiles.find((x) => x.id === id)!;
      if (a === "Export cookies") void s.exportCookies(p);
      else if (a === "Import cookies") void s.importCookies(p);
      else if (a === "Launch synced") void s.launchSynced([id, other]);
      else if (a === "Export") void s.exportMany([id]);
      else void s.regenerateFingerprints([id]);
    }, [action, pending, ETSY] as const);
    if (action === "Regenerate fingerprint") await page.getByRole("dialog").getByRole("button", { name: "Regenerate" }).click();
    if (chooser) await (await chooser).setFiles({ name: "cookies.json", mimeType: "application/json", buffer: Buffer.from("[]") });
    await waitForIdle(page);
    await expect(newRow(page)).toHaveCount(0);
    const real = await page.evaluate(() => (window as unknown as M).__shardxMock.state.order.at(-1)!);
    const sent = await page.evaluate(() => (window as unknown as { __sent: string[] }).__sent);
    expect(sent.filter((c) => c.includes("pending:"))).toEqual([]);
    if ("cmd" in check) {
      // Commands the clone never calls itself, so only the action can send them.
      expect(sent.filter((c) => c.startsWith(`${check.cmd} `) && c.includes(real))).not.toHaveLength(0);
    } else if (check.effect === "clipboard") {
      // The clipboard holds the exported profile, under the id the create returned.
      const copied = await page.evaluate(() => (window as unknown as { __shardxMockClipboard?: string }).__shardxMockClipboard ?? "[]");
      expect((JSON.parse(copied) as { _meta: { id: string } }[]).map((p) => p._meta.id)).toEqual([real]);
    } else {
      // The real profile now has another device than the one it was copied from.
      type Stored = { __shardxMock: { state: { profiles: Record<string, { _meta: { gpu_preset_id: string } }> } } };
      const created = await page.evaluate((id) => (window as unknown as Stored).__shardxMock.state.profiles[id]._meta.gpu_preset_id, SANDBOX);
      await expect
        .poll(() => page.evaluate((id) => (window as unknown as Stored).__shardxMock.state.profiles[id]._meta.gpu_preset_id, real))
        .not.toBe(created);
    }
  });
}
