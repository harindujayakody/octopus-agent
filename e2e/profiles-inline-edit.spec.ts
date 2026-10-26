import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const active = (page: Page) => page.locator("[role='row'][data-active]");
const toast = (page: Page, text: string) => page.locator("[data-toast]").getByText(text, { exact: true });
/** How many times the mock backend was asked to write a profile. */
const saves = (page: Page) => page.evaluate(() => (window as unknown as { __shardxMock: { calls: Record<string, number> } }).__shardxMock.calls["profile_save"] ?? 0);
/** While renaming, the name is an input value, not row text: find the row by id. */
const nameInput = (page: Page) => page.locator("[data-profile-id='f62a9d43']").getByRole("textbox", { name: "Name" });

/** E on the active row: its name becomes a field, the keyboard in it. */
async function startRename(page: Page) {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  await page.keyboard.press("e");
  const input = nameInput(page);
  await expect(input).toBeFocused();
  return input;
}
/** A press on another row: out of the field, as a person leaves it (a press on plain text keeps the field's focus in the page). */
const clickAway = (page: Page) => row(page, "Scraper pricing").locator("[data-cell='status']").click();
const question = (page: Page) => page.getByRole("dialog", { name: "Save this change?" });
/** The unsaved-changes guard, asking about the cell being edited. */
const guard = (page: Page) => page.getByRole("alertdialog", { name: "Save changes to Sandbox?" });
const section = (page: Page) => page.locator("main");
/** A button's hit area, the pseudo-element around it, in page px. */
const hitOf = (button: Locator) => button.evaluate((el) => {
  const s = getComputedStyle(el, "::before");
  const left = el.getBoundingClientRect().left + parseFloat(s.left);
  return { left, right: left + parseFloat(s.width), height: parseFloat(s.height) };
});

test("E renames the active row; Enter saves and toasts", async ({ page }) => {
  const input = await startRename(page);
  await input.fill("Sandbox 2");
  // Typing writes nothing: the press does.
  expect(await saves(page)).toBe(0);
  await page.keyboard.press("Enter");
  await expect(row(page, "Sandbox 2")).toBeVisible();
  await expect(toast(page, "Sandbox 2 saved")).toBeVisible();
  expect(await saves(page)).toBe(1);
});

// Manual save (Task 7): a cell edit has its own Save and Cancel, beside the
// field, and leaving the field with a change asks instead of writing.
test("the field has Save and Cancel buttons: Save commits and toasts, Cancel drops", async ({ page }) => {
  const input = await startRename(page);
  const r = page.locator("[data-profile-id='f62a9d43']");
  const save = r.getByRole("button", { name: "Save", exact: true });
  const cancel = r.getByRole("button", { name: "Cancel", exact: true });
  // 14 px icons in a 24 px button, a 40 px tall hit area through a pseudo-element (34 and 36 px wide: they reach outward, never toward each other), and a row that stays 36 px.
  for (const b of [save, cancel]) {
    expect(await b.locator("svg").evaluate((el) => [el.getBoundingClientRect().width, el.getBoundingClientRect().height])).toEqual([14, 14]);
    expect((await hitOf(b)).height).toBe(40);
  }
  const [tick, cross] = [await hitOf(save), await hitOf(cancel)];
  expect([tick.right - tick.left, cross.right - cross.left]).toEqual([34, 36]);
  expect((await r.boundingBox())!.height).toBe(36);
  await input.fill("Via button");
  await save.click();
  await expect(toast(page, "Via button saved")).toBeVisible();
  await expect(row(page, "Via button")).toBeVisible();
  expect(await saves(page)).toBe(1);
});

test("the Cancel button drops the change and writes nothing", async ({ page }) => {
  const input = await startRename(page);
  await input.fill("Not this");
  await page.locator("[data-profile-id='f62a9d43']").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(input).toHaveCount(0);
  await expect(row(page, "Sandbox").locator("[data-cell='name']")).toHaveText("Sandbox");
  expect(await saves(page)).toBe(0);
  await expect(page.locator("[data-toast]")).toHaveCount(0);
});

test("click away with a change asks; Don't save restores the old name", async ({ page }) => {
  const input = await startRename(page);
  await input.fill("Sandbox renamed");
  await clickAway(page);
  const ask = question(page);
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("button", { name: "Save", exact: true })).toBeFocused();
  // Nothing is written while the question shows.
  expect(await saves(page)).toBe(0);
  await ask.getByRole("button", { name: "Don’t save" }).click();
  await expect(ask).toHaveCount(0);
  await expect(input).toHaveCount(0);
  await expect(row(page, "Sandbox").locator("[data-cell='name']")).toHaveText("Sandbox");
  expect(await saves(page)).toBe(0);
  await expect(page.locator("[data-toast]")).toHaveCount(0);
});

test("click away with a change asks; Save writes it and toasts", async ({ page }) => {
  const input = await startRename(page);
  await input.fill("Sandbox renamed");
  await clickAway(page);
  await question(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(question(page)).toHaveCount(0);
  await expect(row(page, "Sandbox renamed")).toBeVisible();
  await expect(toast(page, "Sandbox renamed saved")).toBeVisible();
  expect(await saves(page)).toBe(1);
});

test("Esc on the question goes back to the field with what was typed", async ({ page }) => {
  const input = await startRename(page);
  await input.fill("Sandbox renamed");
  await clickAway(page);
  await expect(question(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(question(page)).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Sandbox renamed");
  expect(await saves(page)).toBe(0);
});

// Final review M1: the cross's hit area used to paint over the tick's right edge, so a press there cancelled.
test("a press on the tick's right edge saves: the two hit areas do not overlap", async ({ page }) => {
  const input = await startRename(page);
  const r = page.locator("[data-profile-id='f62a9d43']");
  const save = r.getByRole("button", { name: "Save", exact: true });
  const [tick, cross] = [await hitOf(save), await hitOf(r.getByRole("button", { name: "Cancel", exact: true }))];
  expect(tick.right).toBeLessThanOrEqual(cross.left);
  await input.fill("Edge");
  const box = (await save.boundingBox())!;
  const at = { x: box.x + box.width - 1, y: box.y + box.height / 2 };
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"), at)).toBe("Save");
  await page.mouse.click(at.x, at.y);
  await expect(toast(page, "Edge saved")).toBeVisible();
  expect(await saves(page)).toBe(1);
});

// Final review M2: a key on the tick or the cross is not a list key.
test("Delete and the arrows leave the row alone while the tick has the keyboard", async ({ page }) => {
  await startRename(page);
  const save = page.locator("[data-profile-id='f62a9d43']").getByRole("button", { name: "Save", exact: true });
  await page.keyboard.press("Tab");
  await expect(save).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Delete");
  await expect(save).toBeFocused();
  await expect(active(page)).toHaveAttribute("data-profile-id", "f62a9d43");
  // The name is a field's value while it is edited, not row text: find the row by id.
  await expect(page.locator("[data-profile-id='f62a9d43']")).toBeVisible();
  // Nothing was trashed: no "Moved to Trash" toast, no Undo.
  await expect(page.locator("[data-toast]")).toHaveCount(0);
});

// Final review I1: a typed cell edit is an unsaved editor like any other.
test("a page change with a typed name asks first; Cancel stays on the page with the text", async ({ page }) => {
  const input = await startRename(page);
  await input.fill("Sandbox renamed");
  await page.locator("aside [data-nav='proxies']").click();
  await expect(guard(page)).toBeVisible();
  // The page has not changed and nothing is written; the guard is the only question on screen.
  await expect(section(page)).toHaveAttribute("data-section", "profiles");
  expect(await saves(page)).toBe(0);
  await expect(question(page)).toHaveCount(0);
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect(guard(page)).toHaveCount(0);
  await expect(section(page)).toHaveAttribute("data-section", "profiles");
  await expect(nameInput(page)).toHaveValue("Sandbox renamed");
  expect(await saves(page)).toBe(0);
});

test("a page change with a typed name: Don't save keeps the old name", async ({ page }) => {
  const input = await startRename(page);
  await input.fill("Sandbox renamed");
  await page.locator("aside [data-nav='proxies']").click();
  await guard(page).getByRole("button", { name: "Don’t save" }).click();
  await expect(section(page)).toHaveAttribute("data-section", "proxies");
  expect(await saves(page)).toBe(0);
  await page.locator("aside [data-nav='profiles']").click();
  await expect(section(page)).toHaveAttribute("data-section", "profiles");
  // The editor is gone too: it does not come back open on the next visit.
  await expect(nameInput(page)).toHaveCount(0);
  await expect(row(page, "Sandbox").locator("[data-cell='name']")).toHaveText("Sandbox");
});

test("a page change with a typed name: Save writes it, toasts and goes on", async ({ page }) => {
  const input = await startRename(page);
  await input.fill("Sandbox renamed");
  await page.locator("aside [data-nav='proxies']").click();
  await guard(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(section(page)).toHaveAttribute("data-section", "proxies");
  await expect(toast(page, "Sandbox renamed saved")).toBeVisible();
  expect(await saves(page)).toBe(1);
  await page.locator("aside [data-nav='profiles']").click();
  await expect(row(page, "Sandbox renamed").locator("[data-cell='name']")).toHaveText("Sandbox renamed");
});

test("a typed note asks on a page change too, and Don't save writes nothing", async ({ page }) => {
  await openApp(page);
  const cell = row(page, "Sandbox").locator("[data-cell='notes']");
  const box = (await cell.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 8);
  await row(page, "Sandbox").getByRole("button", { name: /^Edit notes/ }).click();
  await row(page, "Sandbox").getByRole("textbox", { name: "Notes" }).fill("Something new");
  await page.locator("aside [data-nav='proxies']").click();
  await expect(guard(page)).toBeVisible();
  await guard(page).getByRole("button", { name: "Don’t save" }).click();
  await expect(section(page)).toHaveAttribute("data-section", "proxies");
  expect(await saves(page)).toBe(0);
});

// Quit saved a focused cell with no question (it committed the field first). It asks like every other editor now.
const requestQuit = (page: Page) => page.evaluate(() => (window as unknown as { __shardxMock: { emit: (e: string) => void } }).__shardxMock.emit("app://quit-requested"));
const quitCalls = (page: Page) => page.evaluate(() => {
  const c = (window as unknown as { __shardxMock: { calls: Record<string, number> } }).__shardxMock.calls;
  return { confirmed: c.app_quit_confirmed ?? 0, cancelled: c.app_quit_cancelled ?? 0 };
});

test("a quit request with a typed name asks; Cancel keeps it, Don't save leaves", async ({ page }) => {
  const input = await startRename(page);
  await input.fill("Sandbox renamed");
  await requestQuit(page);
  await expect(guard(page)).toBeVisible();
  expect(await quitCalls(page)).toEqual({ confirmed: 0, cancelled: 0 });
  expect(await saves(page)).toBe(0);
  await guard(page).getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => quitCalls(page)).toEqual({ confirmed: 0, cancelled: 1 });
  await expect(nameInput(page)).toHaveValue("Sandbox renamed");
  expect(await saves(page)).toBe(0);
  await requestQuit(page);
  await guard(page).getByRole("button", { name: "Don’t save" }).click();
  await expect.poll(() => quitCalls(page)).toEqual({ confirmed: 1, cancelled: 1 });
  expect(await saves(page)).toBe(0);
});

test("a quit request with a typed name: Save writes it, then confirms", async ({ page }) => {
  const input = await startRename(page);
  await input.fill("Sandbox renamed");
  await requestQuit(page);
  await guard(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => quitCalls(page)).toEqual({ confirmed: 1, cancelled: 0 });
  expect(await saves(page)).toBe(1);
});

test("click away with no change just closes", async ({ page }) => {
  const input = await startRename(page);
  await clickAway(page);
  await expect(input).toHaveCount(0);
  await expect(question(page)).toHaveCount(0);
  expect(await saves(page)).toBe(0);
  await expect(page.locator("[data-toast]")).toHaveCount(0);
});

test("a pinned profile's name stays put when its rename opens", async ({ page }) => {
  await openApp(page);
  const pinnedRow = page.locator("[data-profile-id='c31d92f0']"); // FB Ads acc-01, pinned
  const name = pinnedRow.locator("[data-cell='name']");
  const textLeft = await name.getByText("FB Ads acc-01", { exact: true }).evaluate((el) => el.getBoundingClientRect().left);
  await pinnedRow.locator("[data-cell='status']").click();
  await page.keyboard.press("e");
  const input = pinnedRow.getByRole("textbox", { name: "Name" });
  await expect(input).toBeFocused();
  // The field's text starts where the name's did: the pin sits after the
  // name (F7, Task 17), so nothing before it moves when the field opens.
  const inputTextLeft = await input.evaluate((el) => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft));
  expect(Math.abs(inputTextLeft - textLeft)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
});

test("Esc cancels a rename, then a second Esc clears the selection", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='checkbox'] input").check({ force: true });
  await row(page, "Sandbox").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.keyboard.type(" changed");
  await page.keyboard.press("Escape");
  await expect(row(page, "Sandbox")).not.toContainText("changed");
  // Esc cancels: nothing asked, nothing written.
  await expect(question(page)).toHaveCount(0);
  expect(await saves(page)).toBe(0);
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(0);
});

test("the notes edit button edits them in place", async ({ page }) => {
  await openApp(page);
  // Near its left edge, on the visible text: at this row's actual column
  // widths, the Notes cell (~123 px) is narrower than the four-icon overlay
  // it floats under on hover (~110 px, right-anchored against the actions
  // column), so a click at the cell's literal center — where Playwright's
  // own hover-then-click would otherwise land, since it hovers the row on
  // the way there — lands on a button, not the cell (task-5e-fix1 item 4
  // asked to revert this to a plain, unhovered center click; measured
  // instead of assumed, and it still does not reach the cell at this
  // viewport, so the position stays, with the stronger hit-test below).
  // Task 8: Notes is the last column here, so its own edit button lives in
  // the row actions (a DOM sibling of the cell, not a descendant); once
  // that lead expands it legitimately covers this same left-edge point, and
  // a locator-based click (which requires the receiving element to be the
  // target or its descendant) can never settle there. A raw mouse click
  // triggers the same real click without that requirement — it starts the
  // same edit either way (the lead's own click handler calls the identical
  // `startEdit`).
  // E14 (EMIL-12): a plain click opens Peek; the edit starts from the
  // cell's edit button (here the row actions' lead), shown once the pointer
  // is on the cell.
  const cell = row(page, "Sandbox").locator("[data-cell='notes']");
  const cellBox = (await cell.boundingBox())!;
  await page.mouse.move(cellBox.x + 4, cellBox.y + 8);
  await row(page, "Sandbox").getByRole("button", { name: /^Edit notes/ }).click();
  const input = row(page, "Sandbox").getByRole("textbox", { name: "Notes" });
  const box = (await input.boundingBox())!;
  const hitTag = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(hitTag).toBe("INPUT");
  await input.fill("Burner");
  await input.press("Enter");
  await expect(row(page, "Sandbox").locator("[data-cell='notes']")).toHaveText("Burner");
  await expect(toast(page, "Sandbox saved")).toBeVisible();
});

test("a note: click away with a change asks; Don't save keeps the old note", async ({ page }) => {
  await openApp(page);
  const cell = row(page, "Sandbox").locator("[data-cell='notes']");
  const was = (await cell.innerText()).trim();
  const box = (await cell.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 8);
  await row(page, "Sandbox").getByRole("button", { name: /^Edit notes/ }).click();
  const input = row(page, "Sandbox").getByRole("textbox", { name: "Notes" });
  await input.fill("Something new");
  await clickAway(page);
  await question(page).getByRole("button", { name: "Don’t save" }).click();
  await expect(input).toHaveCount(0);
  await expect(cell).toHaveText(was);
  expect(await saves(page)).toBe(0);
});

test("P opens the proxy picker for the active row", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  await page.keyboard.press("p");
  const picker = page.getByRole("dialog", { name: /Proxy/ });
  await expect(picker).toBeVisible();
  await picker.getByRole("combobox", { name: "Proxy", exact: true }).click();
  await page.getByRole("option", { name: /DC Tokyo/ }).click();
  await expect(row(page, "Sandbox").locator("[data-cell='proxy']")).toContainText("DC Tokyo");
});

// Amended focus-return ruling (merge-columns-fix1.md): a row key opens the
// editor, so its close goes back to the row, not to a button the key never
// touched (Tags has the same test, e2e/tags.spec.ts:56).
test("P opens the proxy picker for the active row; Esc puts the keyboard back on the row", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  await page.keyboard.press("p");
  await expect(page.getByRole("dialog", { name: /Proxy/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row(page, "Sandbox")).toBeFocused();
});

