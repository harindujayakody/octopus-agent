import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

const row = (page: Page, name: string) => page.locator("[role='row'][data-proxy-id]", { hasText: name });
const peek = (page: Page) => page.locator("aside[data-peek='proxy']");
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name, exact: true });
type P = { id: string; name: string; host: string; port: number; notes: string };
type M = { calls: Record<string, number>; state: { proxies: P[]; snapshots: Record<string, unknown[]> } };
const calls = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as unknown as { __shardxMock: M }).__shardxMock.calls[c] ?? 0, cmd);
/** Peek's header Edit: the Edit proxy dialog. */
async function openEdit(page: Page, name = "DC Tokyo") {
  await row(page, name).locator("[data-cell='name']").click();
  await peek(page).locator("[data-peek-header]").getByRole("button", { name: "Edit", exact: true }).click();
  const d = dialog(page, `Edit ${name}`);
  await expect(d).toBeVisible();
  return d;
}
const saveButton = (d: ReturnType<typeof dialog>) => d.getByRole("button", { name: "Save", exact: true });
const stored = (page: Page, id: string) =>
  page.evaluate((id) => (window as unknown as { __shardxMock: M }).__shardxMock.state.proxies.find((p) => p.id === id), id);
const tests = (page: Page, id: string) =>
  page.evaluate((id) => (window as unknown as { __shardxMock: M }).__shardxMock.state.snapshots[id]?.length ?? 0, id);

test("clicking a proxy's name opens Peek beside the list", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await row(page, "DC Tokyo").locator("[data-cell='name']").click();
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: DC Tokyo");
  for (const s of ["details", "test", "profiles"]) await expect(peek(page).locator(`[data-peek-section='${s}']`)).toBeVisible();
  // Beside Peek every chosen column stays: its card ends before Peek, and the
  // row Peek shows keeps its Name and its row actions inside the card (a list
  // wider than its card scrolls inside it, owner decision 2026-09-26; Task 7).
  const card = (await page.getByRole("treegrid", { name: "Proxies" }).boundingBox())!;
  const peekBox = (await peek(page).boundingBox())!;
  expect(card.x + card.width).toBeLessThanOrEqual(peekBox.x + 1);
  for (const id of ["name", "actions"]) {
    const b = (await row(page, "DC Tokyo").locator(`[data-cell='${id}']`).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(card.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(card.x + card.width + 1);
  }
});

test("proxy panel shows values, no inputs", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await row(page, "DC Tokyo").locator("[data-cell='name']").click();
  const details = peek(page).locator("[data-peek-section='details']");
  await expect(details.locator("[data-property='type']")).toContainText("SOCKS5");
  await expect(details.locator("[data-property='host']")).toContainText("203.0.113.90");
  await expect(details.locator("[data-property='port']")).toContainText("1080");
  await expect(details.locator("[data-property='username']")).toContainText("shard");
  await expect(details.locator("[data-property='country']")).toContainText("JP");
  for (const role of ["textbox", "combobox", "searchbox", "spinbutton"] as const) {
    await expect(peek(page).getByRole(role), role).toHaveCount(0);
  }
  await expect(peek(page).locator("input, textarea, select")).toHaveCount(0);
  // The password is dots until the eye shows it, and is not in the page before.
  const password = details.locator("[data-property='password']");
  await expect(password).not.toContainText("mock-pass-4");
  const eye = password.getByRole("button", { name: "Show password" });
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await eye.click();
  await expect(password).toContainText("mock-pass-4");
  await expect(eye).toHaveAttribute("aria-pressed", "true");
  await eye.click();
  await expect(password).not.toContainText("mock-pass-4");
  // Looking writes nothing.
  expect(await calls(page, "proxy_save")).toBe(0);
});

test("a revealed password does not follow Peek to the next proxy", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  // The pointer makes it the target; a click would open Peek already (O5).
  await row(page, "DC New York").locator("[data-cell='type']").hover();
  await row(page, "DC New York").focus();
  await page.keyboard.press("Enter");
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: DC New York");
  const password = peek(page).locator("[data-property='password']");
  await password.getByRole("button", { name: "Show password" }).click();
  await expect(password).toContainText("mock-pass-2");
  await row(page, "DC New York").focus();
  await page.keyboard.press("ArrowDown");
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: ISP Frankfurt");
  // Peek stayed mounted, and the next proxy's password is dots again.
  await expect(password).not.toContainText("mock-pass-3");
  await expect(password.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "false");
});

test("Edit proxy saves on Save only", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const d = await openEdit(page);
  await expect(d.getByRole("textbox", { name: "Host" })).toHaveValue("203.0.113.90");
  // Nothing changed: Save waits, and says why in words.
  await expect(saveButton(d)).toBeDisabled();
  await expect(d.getByText("No changes to save")).toBeVisible();
  await d.getByRole("textbox", { name: "Host" }).fill("203.0.113.91");
  await expect(saveButton(d)).toBeEnabled();
  // No debounce, no write on change: well past the old 600 ms pause, still nothing.
  await page.waitForTimeout(900);
  expect(await calls(page, "proxy_save")).toBe(0);
  expect((await stored(page, "px-jp-1"))?.host).toBe("203.0.113.90");
  await saveButton(d).click();
  await expect(d).toHaveCount(0);
  await expect(page.locator("[data-toast]").getByText("DC Tokyo saved", { exact: true })).toBeVisible();
  expect(await calls(page, "proxy_save")).toBe(1);
  expect((await stored(page, "px-jp-1"))?.host).toBe("203.0.113.91");
  await expect(row(page, "DC Tokyo").locator("[data-cell='address']")).toHaveText("203.0.113.91:1080");
  await expect(peek(page).locator("[data-property='host']")).toContainText("203.0.113.91");
  await page.locator("aside").getByText("All profiles", { exact: true }).click();
  // The Profiles cell names the proxy; its address is in the cell's tooltip (F7, Task 17).
  const name = page.locator("[role='row'][data-profile-id]", { hasText: "FB Ads acc-02" }).locator("[data-cell='proxy'] [data-proxy-name]");
  // The action cards open above the list on this first visit (Live Task 8)
  // and move the rows down: hover once the rows stand still.
  await expect.poll(async () => {
    const y = (await name.boundingBox())?.y;
    await page.waitForTimeout(150);
    return y !== undefined && y === (await name.boundingBox())?.y;
  }).toBe(true);
  await name.hover();
  await expect(page.getByRole("tooltip")).toContainText("203.0.113.91");
});

test("empty host disables Save with \"Enter a host\"", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const d = await openEdit(page);
  const host = d.getByRole("textbox", { name: "Host" });
  await host.fill("");
  await expect(saveButton(d)).toBeDisabled();
  await expect(d.getByText("Enter a host").first()).toBeVisible();
  // Under the field once it was left.
  await host.blur();
  await expect(d.getByText("Enter a host")).toHaveCount(2);
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(300);
  await expect(d).toBeVisible();
  expect(await calls(page, "proxy_save")).toBe(0);
  expect((await stored(page, "px-jp-1"))?.host).toBe("203.0.113.90");
});

// What the port field shows is what Save writes: text that is not a port
// (the digits deleted one by one, a letter over them) holds Save, with the
// field's own words, instead of writing the last good port.
for (const [what, type] of [
  ["an emptied", async (port: ReturnType<Page["locator"]>) => { await port.click(); await port.press("End"); for (let i = 0; i < 4; i++) await port.press("Backspace"); }],
  ["a non-numeric", async (port: ReturnType<Page["locator"]>) => { await port.fill("abc"); }],
] as const) {
  test(`${what} port disables Save with the error`, async ({ page }) => {
    await openApp(page, { section: "proxies" });
    const d = await openEdit(page);
    const port = d.getByRole("textbox", { name: "Port" });
    // A real change first, so only the port holds Save back.
    await d.getByRole("textbox", { name: "Notes" }).fill("a note");
    await expect(saveButton(d)).toBeEnabled();
    await type(port);
    await expect(saveButton(d)).toBeDisabled();
    await expect(d.getByText("Enter a number from 1 to 65535.").first()).toBeVisible();
    // Under the field once it was left.
    await port.blur();
    await expect(d.getByText("Enter a number from 1 to 65535.")).toHaveCount(2);
    await page.keyboard.press("ControlOrMeta+s");
    await page.waitForTimeout(300);
    await expect(d).toBeVisible();
    expect(await calls(page, "proxy_save")).toBe(0);
    expect((await stored(page, "px-jp-1"))?.port).toBe(1080);
    // A port again: Save is back, and writes it.
    await port.fill("1081");
    await expect(saveButton(d)).toBeEnabled();
    await expect(d.getByText("Enter a number from 1 to 65535.")).toHaveCount(0);
    await saveButton(d).click();
    await expect(d).toHaveCount(0);
    expect(await calls(page, "proxy_save")).toBe(1);
    expect((await stored(page, "px-jp-1"))?.port).toBe(1081);
  });
}

test("Cancel with changes asks Discard; Mod+S saves; a host pasted with spaces is saved without them", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const d = await openEdit(page);
  await d.getByRole("textbox", { name: "Notes" }).fill("typed here");
  await d.getByRole("button", { name: "Cancel" }).click();
  const ask = page.getByRole("alertdialog", { name: "Discard your changes?" });
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(d.getByRole("textbox", { name: "Notes" })).toHaveValue("typed here");
  await d.getByRole("button", { name: "Cancel" }).click();
  await ask.getByRole("button", { name: "Discard" }).click();
  await expect(d).toHaveCount(0);
  expect(await calls(page, "proxy_save")).toBe(0);
  expect((await stored(page, "px-jp-1"))?.notes).toBe("");
  // Again, saved by the key.
  await peek(page).locator("[data-peek-header]").getByRole("button", { name: "Edit", exact: true }).click();
  await expect(d.getByRole("textbox", { name: "Notes" })).toHaveValue("");
  await d.getByRole("textbox", { name: "Host" }).fill(" 203.0.113.95 ");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(d).toHaveCount(0);
  expect(await calls(page, "proxy_save")).toBe(1);
  expect((await stored(page, "px-jp-1"))?.host).toBe("203.0.113.95");
});

test("a failed save keeps the dialog open with what was typed, and says so next to Save", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const d = await openEdit(page);
  await page.evaluate(() => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = { proxy_save: 1 }; });
  await d.getByRole("textbox", { name: "Notes" }).fill("keep me");
  await saveButton(d).click();
  await expect(d.getByText("Couldn’t save. Your changes are still here.")).toBeVisible();
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn’t save" })).toBeVisible();
  await expect(d.getByRole("textbox", { name: "Notes" })).toHaveValue("keep me");
  expect((await stored(page, "px-jp-1"))?.notes).toBe("");
  // Try again.
  await saveButton(d).click();
  await expect(d).toHaveCount(0);
  expect((await stored(page, "px-jp-1"))?.notes).toBe("keep me");
});

test("Test now shows the result and adds to the history", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await row(page, "DC Tokyo").locator("[data-cell='name']").click();
  const section = peek(page).locator("[data-peek-section='test']");
  await expect(section.locator("[data-history-item]").first()).toBeVisible();
  const before = await section.locator("[data-history-item]").count();
  // F1: Test now is the header's main action.
  await peek(page).locator("[data-peek-header]").getByRole("button", { name: "Test now" }).click();
  await expect(section.locator("[data-history-item]")).toHaveCount(before + 1, { timeout: 6000 });
  await expect(section).toContainText("TCP");
});

test("a test started before Peek moves stays with its proxy", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const before = await tests(page, "px-jp-1");
  const other = await tests(page, "px-us-2");
  await row(page, "DC Tokyo").locator("[data-cell='name']").click();
  await peek(page).getByRole("button", { name: "Test now" }).click();
  await row(page, "DC New York").locator("[data-cell='name']").click();
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: DC New York");
  await expect(peek(page).getByRole("button", { name: "Test now" })).toBeEnabled();
  await expect.poll(() => tests(page, "px-jp-1"), { timeout: 6000 }).toBe(before + 1);
  expect(await tests(page, "px-us-2")).toBe(other);
  // Task 5f removed the row's status dot; the poll above already confirms
  // DC Tokyo's test completed.
});

test("the profiles using a proxy are listed, and one opens in the Profiles list", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await row(page, "DC Tokyo").locator("[data-cell='name']").click();
  const section = peek(page).locator("[data-peek-section='profiles']");
  await section.getByRole("button", { name: "FB Ads acc-02" }).click();
  await expect(page.locator("main header")).toContainText("All profiles");
  await expect(page.locator("[role='row'][data-profile-id][data-active]")).toContainText("FB Ads acc-02");
});

test("Enter opens Peek on the active row, arrows move it, Esc closes it", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  // The pointer makes it the target; a click would open Peek already (O5).
  await row(page, "DC New York").locator("[data-cell='type']").hover();
  await row(page, "DC New York").focus();
  await page.keyboard.press("Enter");
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: DC New York");
  await page.keyboard.press("ArrowDown");
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: ISP Frankfurt");
  await page.keyboard.press("Escape");
  await expect(peek(page)).toHaveCount(0);
});

test("a proxy deleted from its row menu closes Peek and stays deleted", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await row(page, "DC Tokyo").locator("[data-cell='name']").click();
  await row(page, "DC Tokyo").click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
  await expect(peek(page)).toHaveCount(0);
  // The delete waits behind its Undo toast (ruling 18); closing it runs it.
  await page.locator("[data-toast]").filter({ has: page.getByRole("button", { name: "Undo" }) }).getByRole("button", { name: "Dismiss" }).click();
  await expect.poll(() => stored(page, "px-jp-1")).toBeUndefined();
  await page.waitForTimeout(1000);
  expect(await stored(page, "px-jp-1")).toBeUndefined();
  expect(await calls(page, "proxy_save")).toBe(0);
});

test("a country the test fills in survives the next Edit proxy save", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.evaluate(() => {
    const m = (window as unknown as { __shardxMock: { state: { proxies: P[] & { country: string }[] }; save: () => void } }).__shardxMock;
    (m.state.proxies.find((p) => p.id === "px-jp-1") as unknown as { country: string }).country = "";
    m.save();
  });
  await page.reload();
  const before = await tests(page, "px-jp-1");
  await row(page, "DC Tokyo").locator("[data-cell='name']").click();
  await peek(page).getByRole("button", { name: "Test now" }).click();
  await expect.poll(() => tests(page, "px-jp-1"), { timeout: 6000 }).toBe(before + 1);
  const country = () => stored(page, "px-jp-1").then((p) => (p as unknown as { country: string }).country);
  await expect.poll(country).not.toBe("");
  const filled = await country();
  await expect(peek(page).locator("[data-property='country']")).toContainText(filled);
  await peek(page).locator("[data-peek-header]").getByRole("button", { name: "Edit", exact: true }).click();
  const d = dialog(page, "Edit DC Tokyo");
  await expect(d.getByRole("textbox", { name: "Country" })).toHaveValue(filled);
  await d.getByRole("textbox", { name: "Name", exact: true }).fill("Tokyo renamed");
  await saveButton(d).click();
  await expect(d).toHaveCount(0);
  const p = (await stored(page, "px-jp-1")) as unknown as { name: string; country: string };
  expect([p.name, p.country]).toEqual(["Tokyo renamed", filled]);
});

test("a proxy deleted by the API while its dialog is open is not brought back, and the dialog says so", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const d = await openEdit(page);
  await d.getByRole("textbox", { name: "Notes" }).fill("pending");
  await page.evaluate(() => {
    const m = (window as unknown as { __shardxMock: { state: { proxies: P[] }; save: () => void; emit: (e: string, p: unknown) => void } }).__shardxMock;
    m.state.proxies = m.state.proxies.filter((p) => p.id !== "px-jp-1");
    m.save();
    m.emit("store-changed", "proxies");
  });
  await expect(d).toHaveCount(0);
  await expect(peek(page)).toHaveCount(0);
  await expect(page.locator("[data-toast]").getByText("DC Tokyo was deleted, so it could not be saved.")).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await stored(page, "px-jp-1")).toBeUndefined();
  expect(await calls(page, "proxy_save")).toBe(0);
});

test("a proxy deleted while its dialog is clean says it was deleted, not that a save failed", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const d = await openEdit(page);
  await page.evaluate(() => {
    const m = (window as unknown as { __shardxMock: { state: { proxies: P[] }; save: () => void; emit: (e: string, p: unknown) => void } }).__shardxMock;
    m.state.proxies = m.state.proxies.filter((p) => p.id !== "px-jp-1");
    m.save();
    m.emit("store-changed", "proxies");
  });
  await expect(d).toHaveCount(0);
  await expect(page.locator("[data-toast]").getByText("DC Tokyo was deleted.", { exact: true })).toBeVisible();
});

test("Peek stays put while arrows move it: it does not slide in again", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  // The pointer makes it the target; a click would open Peek already (O5).
  await row(page, "DC New York").locator("[data-cell='type']").hover();
  await row(page, "DC New York").focus();
  await page.keyboard.press("Enter");
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: DC New York");
  await peek(page).evaluate((el) => { (el as HTMLElement & { mark?: number }).mark = 1; });
  await page.keyboard.press("ArrowDown");
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: ISP Frankfurt");
  expect(await peek(page).evaluate((el) => (el as HTMLElement & { mark?: number }).mark)).toBe(1);
});

test("Test checks the saved proxy", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await row(page, "DC Tokyo").locator("[data-cell='name']").click();
  await peek(page).getByRole("button", { name: "Test now" }).click();
  await expect.poll(() => page.evaluate(() =>
    ((window as unknown as { __shardxMockTests?: { id: string; host: string }[] }).__shardxMockTests ?? []).map((x) => x.host),
  ), { timeout: 6000 }).toEqual(["203.0.113.90"]);
  // The test is not a save: nothing was written before it.
  expect(await calls(page, "proxy_save")).toBe(0);
});
