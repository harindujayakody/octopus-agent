import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle, type Theme } from "./support/app";

// The Automation editor redesign (owner-approved mock, 2026-10-01): one
// header row, the canvas and a 320 px side panel, the browser as a third
// column only while open, rules as one line that opens into a short form.

type Mock = { __shardxMock: { state: { automation: { id: string; rules?: { action: { type: string } }[] }[] }; save: () => void } };

async function openEditor(page: Page, theme: Theme = "dark") {
  await openApp(page, { section: "automation", theme });
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Add step" })).toBeVisible();
}

/** Two rules on Pricing scrape 6h, saved behind the app's back, then the editor. */
async function withRules(page: Page, theme: Theme = "dark") {
  await openApp(page, { section: "automation", theme });
  await page.evaluate(() => {
    const w = window as unknown as { __shardxMock: { state: { automation: { id: string; rules: unknown[] }[] }; save: () => void } };
    w.__shardxMock.state.automation.find((p) => p.id === "proj-pricing")!.rules = [
      { match: { url: "*.doubleclick.net/*" }, action: { type: "block" } },
      { match: { url: "*://*.example.com/*", resource: "stylesheet" }, action: { type: "modify", setHeaders: [{ name: "Accept-Language", value: "de-DE" }] } },
    ];
    w.__shardxMock.save();
  });
  await page.reload();
  await waitForIdle(page);
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  await page.getByRole("radio", { name: /Traffic/ }).click();
}

const storedTypes = (page: Page) =>
  page.evaluate(() => ((window as unknown as Mock).__shardxMock.state.automation.find((p) => p.id === "proj-pricing")!.rules ?? []).map((r) => r.action.type));

// Manual save (Task 9): the editor holds a draft; nothing is written until Save.
type SaveMock = {
  __shardxMock: {
    calls: Record<string, number>;
    log: { cmd: string }[];
    state: { automation: { id: string; name: string; blocks: { id: string; params: Record<string, unknown>; on_fail?: unknown }[] }[] };
  };
};
const saves = (page: Page) => page.evaluate(() => (window as unknown as SaveMock).__shardxMock.calls.automation_save ?? 0);
const runs = (page: Page) => page.evaluate(() => (window as unknown as SaveMock).__shardxMock.calls.automation_run ?? 0);
const storedSelector = (page: Page) =>
  page.evaluate(() => (window as unknown as SaveMock).__shardxMock.state.automation.find((p) => p.id === "proj-pricing")!.blocks.find((b) => b.id === "b3")!.params.selector);
const saveArea = (page: Page) => page.locator("[data-editor-save]");
const saveButton = (page: Page) => saveArea(page).getByRole("button", { name: "Save", exact: true });
const notice = (page: Page, text: string) => page.locator("[data-toast]").getByText(text, { exact: true });
const targetField = (page: Page) => page.getByRole("textbox", { name: "Target" });
const backToList = (page: Page) => page.locator("main header").getByRole("button", { name: "Projects", exact: true });
/** Wait for table (b3) aims at another table: a change to the draft only. */
async function editTarget(page: Page, value = "table.costs") {
  await page.locator('[data-step-card="b3"]').click();
  await targetField(page).fill(value);
}

test("the project's name is the page's one title, shown once", async ({ page }) => {
  await openEditor(page);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1").getByRole("textbox", { name: "Project name" })).toHaveValue("Pricing scrape 6h");
  // The old page title above the editor and its Back button are gone.
  await expect(page.getByText("Pricing scrape 6h", { exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
  await backToList(page).click();
  await expect(page.locator("[role='listitem'][data-row-id]").first()).toBeVisible();
});

test("the start step lies inside the canvas on open, at 80 % or more", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await openEditor(page);
  const canvas = page.locator("[data-block-canvas]");
  await expect(canvas).toBeVisible();
  const first = page.locator("[data-step-card]").first();
  // The fit never goes below 80 %: when every step cannot fit, the start step
  // sits 24 px from the canvas's top left and is wholly inside it.
  await expect
    .poll(async () => {
      const c = (await canvas.boundingBox())!;
      const b = (await first.boundingBox())!;
      return b.x >= c.x && b.y >= c.y && b.x + b.width <= c.x + c.width && b.y + b.height <= c.y + c.height;
    })
    .toBe(true);
  await expect(page.getByText("80%", { exact: true })).toBeVisible();
});

for (const width of [1280, 1024]) {
  test(`the side panel never scrolls sideways at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openEditor(page);
    const panel = page.locator("[data-editor-panel]");
    const fits = (where: string) =>
      expect.poll(() => panel.evaluate((el) => el.scrollWidth - el.clientWidth), { message: where }).toBeLessThanOrEqual(0);

    // The first card: at 1024 px the canvas shows only it whole.
    await page.getByText("Use profile", { exact: true }).click();
    await fits("Step tab");

    await page.getByRole("radio", { name: /Traffic/ }).click();
    await page.getByRole("button", { name: "Add rule", exact: true }).click();
    const doGroup = page.getByRole("radiogroup", { name: "Do" });
    await expect.poll(() => doGroup.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await page.getByRole("radio", { name: "Change" }).click();
    await page.getByRole("button", { name: "Add header" }).first().click();
    for (const name of ["Rewrite address", "Set method", "Delay (ms)", "Set status", "Replace body"]) {
      await page.getByRole("button", { name: "More changes" }).click();
      await page.getByRole("menuitem", { name }).click();
    }
    await fits("Traffic tab, a Change with every field");

    await page.getByRole("button", { name: "Open browser" }).click();
    await expect(page.locator("[data-browser-column]")).toBeVisible();
    await fits("with the browser column open");
    const box = await page.locator("[data-editor-panel]").locator("xpath=..").boundingBox();
    expect(box!.width).toBe(320);
  });
}

test("the browser column is absent until it is opened", async ({ page }) => {
  await openEditor(page);
  await expect(page.locator("[data-browser-column]")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Choose a profile…" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open browser" }).click();
  const column = page.locator("[data-browser-column]");
  await expect(column).toBeVisible();
  await expect(column.getByRole("tab", { name: "Page" })).toHaveAttribute("aria-selected", "true");
  await expect(column.getByRole("tab", { name: "Requests" })).toBeVisible();
  await expect(column.getByRole("tab", { name: "Run log" })).toBeVisible();
  await page.getByRole("button", { name: "Hide browser" }).click();
  await expect(column).toHaveCount(0);
});

// Clarity fixes, item 18: after Run the right column opens, and it had no way
// to close. Closing only hides it; the run goes on and the header says so.
test("the run column has a close button and the run keeps going", async ({ page }) => {
  await openEditor(page);
  const stops = () => page.evaluate(() => (window as unknown as SaveMock).__shardxMock.calls.automation_run_stop ?? 0);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const column = page.locator("[data-browser-column]");
  // A run opens the column on its log.
  await expect(column).toBeVisible();
  await expect(column.getByRole("tab", { name: "Run log" })).toHaveAttribute("aria-selected", "true");
  const close = column.getByRole("button", { name: "Close browser panel" });
  await expect(close.locator("svg")).toHaveCSS("width", "14px");
  await close.click();
  await expect(column).toHaveCount(0);
  // The run goes on: Stop stays, the header says how it is doing, and the
  // column does not come back by itself (it opens on a run's start only).
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  const state = page.locator("main header").getByRole("button", { name: /running/i });
  await expect(state).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(column).toHaveCount(0);
  expect(await stops()).toBe(0);
  // One press on the run's state brings the log back.
  await state.click();
  await expect(column).toBeVisible();
  await expect(column.getByRole("tab", { name: "Run log" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("main header").getByRole("button", { name: /running/i })).toHaveCount(0);
  // Hide browser closes it the same way, with the run still going.
  await page.getByRole("button", { name: "Hide browser" }).click();
  await expect(column).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  expect(await stops()).toBe(0);
});

// A control that unmounts takes the keyboard with it: the next key would land
// on the page, and Esc there leaves the editor.
test("closing and reopening the run column keeps the keyboard on a control", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const column = page.locator("[data-browser-column]");
  await expect(column).toBeVisible();
  const close = column.getByRole("button", { name: "Close browser panel" });
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(column).toHaveCount(0);
  // The header's switch has it, not the page.
  await expect(page.getByRole("button", { name: "Open browser" })).toBeFocused();

  const state = page.locator("main header").getByRole("button", { name: /running/i });
  await state.focus();
  await page.keyboard.press("Enter");
  await expect(column).toBeVisible();
  await expect(column.getByRole("tab", { name: "Run log" })).toBeFocused();
});

test("each Do choice shows only its own fields, and keeps the stored type", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("radio", { name: /Traffic/ }).click();
  await page.getByRole("button", { name: "Add rule", exact: true }).click();
  const form = page.locator("[data-rule-form]");
  const reason = form.getByRole("combobox", { name: "Reason" });
  const status = form.getByRole("textbox", { name: "Status", exact: true });
  const body = form.getByRole("textbox", { name: "Body", exact: true });
  const request = form.getByRole("button", { name: "Request", exact: true });
  const redirect = form.getByRole("switch", { name: "Send to another address (real 302)" });

  // A new rule blocks.
  await expect(form.getByRole("radio", { name: "Block" })).toHaveAttribute("aria-checked", "true");
  await expect(reason).toBeVisible();
  for (const other of [status, body, request, redirect]) await expect(other).toHaveCount(0);

  await form.getByRole("radio", { name: "Answer" }).click();
  await expect(status).toBeVisible();
  await expect(body).toBeVisible();
  for (const other of [reason, request, redirect]) await expect(other).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => storedTypes(page)).toEqual(["fulfill"]);

  await form.getByRole("radio", { name: "Change" }).click();
  await expect(request).toHaveAttribute("aria-expanded", "true");
  await expect(form.getByRole("button", { name: "Response", exact: true })).toBeVisible();
  await expect(redirect).toBeVisible();
  for (const other of [reason, status, body]) await expect(other).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => storedTypes(page)).toEqual(["modify"]);
  await redirect.click();
  await expect(form.getByRole("textbox", { name: "Send to" })).toBeVisible();
  await expect(request).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => storedTypes(page)).toEqual(["redirect"]);

  await form.getByRole("radio", { name: "Let through" }).click();
  for (const other of [reason, status, body, request, redirect]) await expect(other).toHaveCount(0);
  await expect(form.getByRole("switch", { name: "Pause and ask me each time" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => storedTypes(page)).toEqual(["continue"]);

  // Esc closes the open form and gives the row back the focus.
  await form.getByRole("textbox", { name: "Address" }).focus();
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(page.locator("[data-rule-row]")).toBeFocused();
  await expect(page.locator("[data-rule-row]")).toHaveAttribute("aria-expanded", "false");
});

test("Apply now says why it is off while no browser runs", async ({ page }) => {
  await withRules(page);
  const apply = page.getByRole("button", { name: "Apply now" });
  await expect(apply).toHaveAttribute("aria-disabled", "true");
  await apply.hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "Start a profile in the browser to apply the rules now. A run applies them on its own before the first page opens.",
  );
  // No orange box in its place.
  await expect(page.getByText(/Start the live session/)).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`editor, Step tab, ${theme}`, { tag: "@visual" }, async ({ page }) => {
    await openEditor(page, theme);
    await page.getByText("Open page", { exact: true }).click();
    await page.mouse.move(1, 1);
    await waitForIdle(page);
    // The canvas wires are SVG curves whose anti-aliasing varies by a few
    // pixels from run to run (3 px seen on the wire beside the selected step);
    // the controller's ruling at merge point 9 allows 8 rather than masking the canvas.
    await expect(page).toHaveScreenshot(`automation-editor-step-${theme}.png`, { maxDiffPixels: 8 });
  });

  test(`editor, Traffic with one rule open, ${theme}`, { tag: "@visual" }, async ({ page }) => {
    await withRules(page, theme);
    await page.locator("[data-rule-row]").nth(1).click();
    await page.mouse.move(1, 1);
    await waitForIdle(page);
    await expect(page).toHaveScreenshot(`automation-editor-traffic-${theme}.png`);
  });
}

test("the browser column has a drag handle: drag, limits, keys, reset and a kept width", async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 900 });
  await openEditor(page);
  await page.getByRole("button", { name: "Open browser" }).click();
  const column = page.locator("[data-browser-column]");
  const handle = page.getByRole("separator", { name: "Browser width" });
  const width = async () => Math.round((await column.boundingBox())!.width);
  await expect(handle).toHaveAttribute("aria-orientation", "vertical");
  await expect(handle).toHaveAttribute("aria-valuemin", "320");
  // The maximum is the 440 default until the editor's grid is measured: wait for it.
  await expect.poll(async () => Number(await handle.getAttribute("aria-valuemax"))).toBeGreaterThan(440);
  const max = Number(await handle.getAttribute("aria-valuemax"));
  expect(await width()).toBe(440);

  // Dragging left widens 1:1; a shield covers the page while it runs.
  const hb = (await handle.boundingBox())!;
  const x = hb.x + hb.width / 2;
  const y = hb.y + hb.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 60, y, { steps: 4 });
  await expect(page.locator("[data-browser-resize-shield]")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator("[data-browser-resize-shield]")).toHaveCount(0);
  expect(await width()).toBe(500);

  // The minimum and the maximum hold.
  const hb2 = (await handle.boundingBox())!;
  await page.mouse.move(hb2.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(hb2.x + 1200, y, { steps: 4 });
  await page.mouse.up();
  expect(await width()).toBe(320);
  const hb3 = (await handle.boundingBox())!;
  await page.mouse.move(hb3.x + 4, y);
  await page.mouse.down();
  await page.mouse.move(hb3.x - 1200, y, { steps: 4 });
  await page.mouse.up();
  expect(await width()).toBe(max);
  const canvas = await page.getByRole("button", { name: "Add step" }).locator("xpath=ancestor::div[contains(@class,'overflow-hidden')][1]").boundingBox();
  expect(canvas!.width).toBeGreaterThanOrEqual(360);

  // Keys: Left widens, Right narrows, Shift takes 64, Home and End the limits.
  await handle.focus();
  await page.keyboard.press("Home");
  expect(await width()).toBe(320);
  await page.keyboard.press("ArrowLeft");
  expect(await width()).toBe(336);
  await page.keyboard.press("Shift+ArrowLeft");
  expect(await width()).toBe(400);
  await page.keyboard.press("ArrowRight");
  expect(await width()).toBe(384);
  await page.keyboard.press("End");
  expect(await width()).toBe(max);

  // Kept across a reload, and a double click resets it.
  await page.keyboard.press("Home");
  await page.reload();
  await waitForIdle(page);
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  await page.getByRole("button", { name: "Open browser" }).click();
  expect(await width()).toBe(320);
  await handle.dblclick();
  expect(await width()).toBe(440);
});

// The canvas never re-snaps or re-fits on its own (owner, 2026-10-01): a card
// stays where it was dropped, and the view moves only when the user moves it.
const cardBoxes = (page: Page) =>
  page.locator("[data-step-card]").evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return [el.getAttribute("data-step-card"), Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10] as const;
    }),
  );
const zoomText = (page: Page) => page.locator("[data-block-canvas]").getByRole("button", { name: /^\d+%$/ }).textContent();
const stored = (page: Page) =>
  page.evaluate(() => (window as unknown as { __shardxMock: { state: { automation: { id: string; blocks: { id: string; x: number; y: number }[] }[] } } })
    .__shardxMock.state.automation.find((p) => p.id === "proj-pricing")!.blocks.map((b) => `${b.id}:${b.x},${b.y}`));

test("a dropped card stays exactly where it landed, and is still there after a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 900 });
  await openEditor(page);
  const card = page.locator('[data-step-card="b3"]');
  const b = (await card.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 47, b.y + b.height / 2 + 113, { steps: 6 });
  await page.mouse.up();
  const dropped = await cardBoxes(page);
  // A move is a change like any other: stored on Save.
  await expect(saveArea(page)).toContainText("Unsaved changes");
  expect((await stored(page)).find((s) => s.startsWith("b3:"))).toBe("b3:600,120");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(async () => (await stored(page)).find((s) => s.startsWith("b3:"))).not.toBe("b3:600,120");
  const moved = (await stored(page)).find((s) => s.startsWith("b3:"))!;
  await page.waitForTimeout(1000);
  expect(await cardBoxes(page)).toEqual(dropped);
  expect((await stored(page)).find((s) => s.startsWith("b3:"))).toBe(moved);

  await page.reload();
  await waitForIdle(page);
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  await expect(page.locator('[data-step-card="b3"]')).toBeVisible();
  expect((await stored(page)).find((s) => s.startsWith("b3:"))).toBe(moved);
  // A new session fits once, so the screen spot may differ; the stored place does not.
});

test("a new step is placed in free space and no other card moves", async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 900 });
  await openEditor(page);
  const before = await cardBoxes(page);
  const zoom = await zoomText(page);
  await page.getByRole("button", { name: "Add step" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a step" });
  await dialog.getByRole("option").first().click();
  await expect(page.locator("[data-step-card]")).toHaveCount(before.length + 1);
  const after = await cardBoxes(page);
  for (const row of before) expect(after).toContainEqual(row);
  expect(await zoomText(page)).toBe(zoom);
});

test("opening, closing and resizing the browser column leaves the view where it was", async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 900 });
  await openEditor(page);
  const before = await cardBoxes(page);
  const zoom = await zoomText(page);
  await page.getByRole("button", { name: "Open browser" }).click();
  await expect(page.locator("[data-browser-column]")).toBeVisible();
  await page.waitForTimeout(300);
  expect(await cardBoxes(page)).toEqual(before);
  const handle = page.getByRole("separator", { name: "Browser width" });
  await handle.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  expect(await cardBoxes(page)).toEqual(before);
  expect(await zoomText(page)).toBe(zoom);
  await page.getByRole("button", { name: "Hide browser" }).click();
  await expect(page.locator("[data-browser-column]")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await cardBoxes(page)).toEqual(before);
  expect(await zoomText(page)).toBe(zoom);
});

test("Tidy up moves the cards in one step, and Undo puts every one back", async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 900 });
  await openEditor(page);
  const before = await cardBoxes(page);
  const storedBefore = await stored(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Tidy up" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Tidied up", { exact: true })).toBeVisible();
  // The new layout is a change to the draft: nothing is stored until Save.
  await expect(saveArea(page)).toContainText("Unsaved changes");
  await expect.poll(() => cardBoxes(page)).not.toEqual(before);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => cardBoxes(page)).toEqual(before);
  await expect(saveArea(page)).not.toContainText("Unsaved changes");
  expect(await stored(page)).toEqual(storedBefore);
});

test("Tidy up is in the command palette", async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("tidy");
  await page.getByRole("option", { name: /Tidy up the canvas/ }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Tidied up", { exact: true })).toBeVisible();
});

test("editing a step sends no automation_save", async ({ page }) => {
  await openEditor(page);
  const sent = await saves(page);
  await editTarget(page);
  await expect(targetField(page)).toHaveValue("table.costs");
  // The old autosave went on every keystroke: well past that, nothing is written.
  await page.waitForTimeout(700);
  expect(await saves(page)).toBe(sent);
  expect(await storedSelector(page)).toBe("table.prices");
});

test('header says "Unsaved changes" and Save is enabled', async ({ page }) => {
  await openEditor(page);
  await expect(saveButton(page)).toBeDisabled();
  await expect(saveArea(page)).not.toContainText("Unsaved changes");
  await editTarget(page);
  await expect(saveArea(page)).toContainText("Unsaved changes");
  await expect(saveButton(page)).toBeEnabled();
  // Typed back to what is saved: nothing left to save.
  await targetField(page).fill("table.prices");
  await expect(saveArea(page)).not.toContainText("Unsaved changes");
  await expect(saveButton(page)).toBeDisabled();
});

test("a failed save's words go when the changes are typed back to what is saved", async ({ page }) => {
  await openEditor(page);
  await editTarget(page);
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__shardxMockFail = { automation_save: 1 }; });
  await saveButton(page).click();
  await expect(saveArea(page).getByRole("alert")).toHaveText("Couldn’t save. Your changes are still here.");
  await targetField(page).fill("table.prices");
  await expect(saveArea(page).getByRole("alert")).toHaveCount(0);
  await expect(saveArea(page)).not.toContainText("Unsaved changes");
});

test('Mod+S saves once and toasts "Project saved"', async ({ page }) => {
  await openEditor(page);
  const sent = await saves(page);
  // Nothing unsaved: the key does nothing.
  await page.keyboard.press("ControlOrMeta+s");
  await page.waitForTimeout(300);
  expect(await saves(page)).toBe(sent);
  await editTarget(page);
  // From inside the field, as in every editor.
  await page.keyboard.press("ControlOrMeta+s");
  await expect(notice(page, "Project saved")).toBeVisible();
  expect(await saves(page)).toBe(sent + 1);
  expect(await storedSelector(page)).toBe("table.costs");
  await expect(saveArea(page)).not.toContainText("Unsaved changes");
  await expect(saveButton(page)).toBeDisabled();
});

test("undo after save marks it unsaved again", async ({ page }) => {
  await openEditor(page);
  await editTarget(page);
  await saveButton(page).click();
  await expect(notice(page, "Project saved")).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
  // Focus is on Save, out of any field: the editor's Undo key.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(targetField(page)).toHaveValue("table.prices");
  await expect(saveArea(page)).toContainText("Unsaved changes");
  await expect(saveButton(page)).toBeEnabled();
  expect(await storedSelector(page)).toBe("table.costs");
  // Redo comes back to what is saved.
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(targetField(page)).toHaveValue("table.costs");
  await expect(saveArea(page)).not.toContainText("Unsaved changes");
});

test("Run with changes asks; Save and run saves then runs", async ({ page }) => {
  await openEditor(page);
  await editTarget(page);
  const sent = await saves(page);
  const run = page.getByRole("button", { name: "Run", exact: true });
  const ask = page.getByRole("dialog", { name: "Save before running?" });
  await run.click();
  await expect(ask).toContainText("The run uses the saved project.");
  // Cancel runs nothing and keeps the changes.
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toHaveCount(0);
  expect(await saves(page)).toBe(sent);
  expect(await runs(page)).toBe(0);
  await expect(saveArea(page)).toContainText("Unsaved changes");

  await run.click();
  await ask.getByRole("button", { name: "Save and run" }).click();
  await expect(notice(page, "Project saved")).toBeVisible();
  await expect.poll(() => runs(page)).toBe(1);
  expect(await storedSelector(page)).toBe("table.costs");
  const order = await page.evaluate(() => (window as unknown as SaveMock).__shardxMock.log
    .map((l) => l.cmd).filter((c) => c === "automation_save" || c === "automation_run"));
  expect(order.slice(-2)).toEqual(["automation_save", "automation_run"]);
});

test("Back with changes shows the guard", async ({ page }) => {
  await openEditor(page);
  await editTarget(page);
  const guard = page.getByRole("alertdialog", { name: "Save changes to Pricing scrape 6h?" });
  await backToList(page).click();
  await expect(guard).toContainText("Your changes will be lost if you don’t save them.");
  await expect(guard.getByRole("button", { name: "Save", exact: true })).toBeFocused();
  // Cancel stays in the editor, the change kept.
  await guard.getByRole("button", { name: "Cancel" }).click();
  await expect(guard).toHaveCount(0);
  await expect(targetField(page)).toHaveValue("table.costs");

  // Don't save goes back and drops it.
  const sent = await saves(page);
  await backToList(page).click();
  await guard.getByRole("button", { name: "Don’t save" }).click();
  await expect(page.locator("[role='listitem'][data-row-id]").first()).toBeVisible();
  expect(await saves(page)).toBe(sent);
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  await page.locator('[data-step-card="b3"]').click();
  await expect(targetField(page)).toHaveValue("table.prices");
  await targetField(page).fill("table.totals");

  // Save stores it, then goes back.
  await backToList(page).click();
  await guard.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[role='listitem'][data-row-id]").first()).toBeVisible();
  expect(await storedSelector(page)).toBe("table.totals");
  expect(await saves(page)).toBe(sent + 1);
});

test("Mod+S commits the number being typed: a retry count past its range is saved brought into range", async ({ page }) => {
  await openEditor(page);
  const failOf = () => page.evaluate(() => (window as unknown as SaveMock).__shardxMock.state.automation.find((p) => p.id === "proj-pricing")!.blocks.find((b) => b.id === "b2")!.on_fail);
  await page.locator('[data-step-card="b2"]').click();
  const retry = page.getByRole("textbox", { name: "Try again" });
  await expect(retry).toHaveValue("2");
  // In range: saved as typed, from inside the field.
  await retry.fill("7");
  await page.keyboard.press("ControlOrMeta+s");
  await expect(notice(page, "Project saved")).toBeVisible();
  expect(await failOf()).toEqual({ retry: 7 });
  // Past the range, the keyboard still in the field: the editor takes it as 50.
  await retry.fill("99");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(failOf).toEqual({ retry: 50 });
  await expect(retry).toHaveValue("50");
});

// #66: the runner expands {{variables}} in every step number (runner.rs,
// param_f64), so the editor has to let one be typed into a number box. The
// reporter's own steps: add a wait step, type {{delay}} into Seconds.
/** The last step of Pricing scrape 6h — the one just added — as it was saved. */
const storedSeconds = (page: Page) =>
  page.evaluate(() => {
    const blocks = (window as unknown as SaveMock).__shardxMock.state.automation.find((p) => p.id === "proj-pricing")!.blocks;
    return blocks[blocks.length - 1].params.seconds;
  });

test("{{delay}} typed into a wait step's Seconds is taken and saved", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Add step" }).click();
  const picker = page.getByRole("dialog", { name: "Add a step" });
  await picker.getByRole("combobox").fill("Wait");
  await picker.getByRole("option", { name: /Pauses before the next step/ }).click();
  const seconds = page.getByRole("textbox", { name: "Seconds" });
  await expect(seconds).toHaveValue("2");

  // A plain number is unchanged: taken as typed, nothing to complain about.
  await seconds.fill("3");
  await page.keyboard.press("Tab");
  await expect(seconds).toHaveValue("3");
  await expect(page.getByText("Enter a number.")).toHaveCount(0);

  // Neither a number nor a reference: the message it always had.
  await seconds.fill("later");
  await page.keyboard.press("Tab");
  await expect(page.getByText("Enter a number.")).toBeVisible();

  // Half a reference is a name being typed, not a mistake.
  await seconds.fill("{{d");
  await expect(page.getByText("Enter a number.")).toHaveCount(0);

  // Finished, it goes into the step and shows as itself.
  await seconds.fill("{{delay}}");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Seconds" })).toHaveValue("{{delay}}");
  await expect(page.getByText("Enter a number.")).toHaveCount(0);
  await saveButton(page).click();
  await expect(notice(page, "Project saved")).toBeVisible();
  expect(await storedSeconds(page)).toBe("{{delay}}");
});

test("a number the run never expands still refuses a variable", async ({ page }) => {
  await openEditor(page);
  // A retry count is read as a number, never expanded, so {{times}} would only
  // break the run: that box takes none.
  const failOf = () => page.evaluate(() => (window as unknown as SaveMock).__shardxMock.state.automation.find((p) => p.id === "proj-pricing")!.blocks.find((b) => b.id === "b2")!.on_fail);
  await page.locator('[data-step-card="b2"]').click();
  const retry = page.getByRole("textbox", { name: "Try again" });
  await retry.fill("{{times}}");
  await page.keyboard.press("Tab");
  await expect(page.getByText("Enter a number from 1 to 50.")).toBeVisible();
  await expect(retry).toHaveValue("{{times}}");
  expect(await failOf()).toEqual({ retry: 2 });
});

// Controller Ruling 9: Export writes the stored project, so unsaved changes
// ask first, as Run does; the file's name and content are the saved ones.
const exports = (page: Page) => page.evaluate(() => (window as unknown as SaveMock).__shardxMock.calls.automation_export ?? 0);
const exportAsk = (page: Page) => page.getByRole("dialog", { name: "Save before exporting?" });
async function exportFromMenu(page: Page) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export" }).click();
}

test("an edited project's Export asks", async ({ page }) => {
  await openEditor(page);
  // Nothing unsaved: Export goes at once, as before.
  await exportFromMenu(page);
  await expect.poll(() => exports(page)).toBe(1);
  await expect(exportAsk(page)).toHaveCount(0);
  await editTarget(page);
  await exportFromMenu(page);
  await expect(exportAsk(page)).toContainText("The file uses the saved project.");
  await expect(exportAsk(page).getByRole("button", { name: "Save and export" })).toBeVisible();
  await expect(exportAsk(page).getByRole("button", { name: "Cancel" })).toBeVisible();
  expect(await exports(page)).toBe(1);
});

test("Save and export saves once, then exports", async ({ page }) => {
  await openEditor(page);
  await editTarget(page);
  const sent = await saves(page);
  await exportFromMenu(page);
  await exportAsk(page).getByRole("button", { name: "Save and export" }).click();
  await expect(notice(page, "Project saved")).toBeVisible();
  await expect.poll(() => exports(page)).toBe(1);
  expect(await saves(page)).toBe(sent + 1);
  expect(await storedSelector(page)).toBe("table.costs");
  const order = await page.evaluate(() => (window as unknown as SaveMock).__shardxMock.log
    .map((l) => l.cmd).filter((c) => c === "automation_save" || c === "automation_export"));
  expect(order.slice(-2)).toEqual(["automation_save", "automation_export"]);
  await expect(saveArea(page)).not.toContainText("Unsaved changes");
});

test("Cancel exports nothing", async ({ page }) => {
  await openEditor(page);
  await editTarget(page);
  const sent = await saves(page);
  await exportFromMenu(page);
  await exportAsk(page).getByRole("button", { name: "Cancel" }).click();
  await expect(exportAsk(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await exports(page)).toBe(0);
  expect(await saves(page)).toBe(sent);
  await expect(saveArea(page)).toContainText("Unsaved changes");
  await expect(targetField(page)).toHaveValue("table.costs");
});
