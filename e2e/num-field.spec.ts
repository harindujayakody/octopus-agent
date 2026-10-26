import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp, openEditForm, waitForIdle } from "./support/app";
import { boxOf } from "./support/geometry";

// WIG-02: number fields keep what you type and validate when you leave.
async function apiPort(page: Page) {
  await openApp(page, { section: "settings" });
  await page.getByRole("tab", { name: "API & MCP" }).click();
  return page.getByRole("textbox", { name: "Port" });
}
/** The field's own message. The Save bar says it too once the page has a change to save. */
const portNote = (page: Page) => page.getByRole("tabpanel", { name: "API & MCP" }).getByText("Enter a number from 1024 to 65535.");

test("the API port can be cleared and retyped", async ({ page }) => {
  const port = await apiPort(page);
  await port.fill("");
  await expect(port).toHaveValue("");
  await port.pressSequentially("8080");
  await expect(port).toHaveValue("8080");
});

test("an out-of-range port is brought into range when you leave the field", async ({ page }) => {
  const port = await apiPort(page);
  await port.fill("99999");
  await port.press("Tab");
  await expect(port).toHaveValue("65535");
});

test("letters stay as typed, with a message, until fixed", async ({ page }) => {
  const port = await apiPort(page);
  await port.fill("80a");
  await port.press("Tab");
  await expect(port).toHaveValue("80a");
  await expect(portNote(page)).toBeVisible();
});

/** Sandbox's latitude, in the profile form's Fingerprint tab with manual coordinates. */
async function latitude(page: Page) {
  await openApp(page);
  const form = await openEditForm(page, "Sandbox", "Fingerprint");
  // A single choice: a radio group since Phase C Task 26.
  await form.getByRole("radio", { name: "Set manually" }).click();
  return form.getByRole("textbox", { name: "Latitude" });
}

/** The Edit proxy dialog on `name`, from Peek's header Edit. */
async function proxyEdit(page: Page, name: string) {
  await page.locator("[role='row'][data-proxy-id]", { hasText: name }).locator("[data-cell='name']").click();
  await page.locator("aside[data-peek='proxy'] [data-peek-header]").getByRole("button", { name: "Edit", exact: true }).click();
  const form = page.getByRole("dialog", { name: `Edit ${name}`, exact: true });
  await expect(form).toBeVisible();
  return form;
}

test("a negative coordinate types naturally", async ({ page }) => {
  const lat = await latitude(page);
  await lat.fill("");
  await lat.pressSequentially("-33.8688");
  await expect(lat).toHaveValue("-33.8688");
});

test("the Edit proxy dialog's port can be cleared and retyped", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const form = await proxyEdit(page, "DC Tokyo");
  const port = form.getByRole("textbox", { name: "Port" });
  await port.fill("");
  await port.pressSequentially("1081");
  await expect(port).toHaveValue("1081");
});

// F11 review, Important 1: a draft kept with its message must not carry over
// to the next proxy on the same port. Peek only shows now; each opening of
// the Edit proxy dialog starts from the proxy as it is.
test("the Edit proxy dialog shows the next proxy's port, not a draft left on the last one", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const first = await proxyEdit(page, "DC Tokyo");
  // The port first: its message shows once the field is left, and the
  // dialog settles before Cancel is pressed.
  await first.getByRole("textbox", { name: "Port" }).fill("abc");
  await first.getByRole("textbox", { name: "Name", exact: true }).fill("Draft name");
  await expect(first.getByText("Enter a number from 1 to 65535.").first()).toBeVisible();
  await first.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("alertdialog", { name: "Discard your changes?" }).getByRole("button", { name: "Discard" }).click();
  await expect(first).toHaveCount(0);
  // DC New York uses the same port, 1080.
  const next = await proxyEdit(page, "DC New York");
  await expect(next.getByRole("textbox", { name: "Port" })).toHaveValue("1080");
  await expect(next.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("DC New York");
  await expect(next.getByText("Enter a number from 1 to 65535.")).toHaveCount(0);
});

// F11 review, Important 2: "," groups thousands in whole numbers.
test("grouped digits read as one number; a stray comma is not a number", async ({ page }) => {
  const port = await apiPort(page);
  await port.fill("10,000");
  await port.press("Tab");
  await expect(port).toHaveValue("10000");
  await port.fill("12\u2009345");
  await port.press("Tab");
  await expect(port).toHaveValue("12345");
  await port.fill("80,80");
  await port.press("Tab");
  await expect(port).toHaveValue("80,80");
  await expect(portNote(page)).toBeVisible();
});

test("a coordinate reads a lone comma as its decimal point", async ({ page }) => {
  const lat = await latitude(page);
  await lat.fill("-33,8688");
  await lat.press("Tab");
  await expect(lat).toHaveValue("-33.8688");
});

// F11 review, Minor 2: what a Chinese input method types by default.
test("full-width digits read as numbers; the Enter that ends a composition checks nothing", async ({ page }) => {
  const port = await apiPort(page);
  await port.fill("８０８０");
  await port.press("Tab");
  await expect(port).toHaveValue("8080");
  await port.fill("80a");
  await port.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await expect(portNote(page)).toHaveCount(0);
  await port.press("Enter");
  await expect(portNote(page)).toBeVisible();
});

test("a coordinate typed with 。 reads it as the point", async ({ page }) => {
  const lat = await latitude(page);
  await lat.fill("-33。8688");
  await lat.press("Tab");
  await expect(lat).toHaveValue("-33.8688");
});

// F11 review: the other number fields behave the same.
test("the Automation run fields keep what you type and bring it into range when you leave", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await page.locator("[role='listitem'][data-row-id]").first().click();
  await page.getByRole("button", { name: /^Threads/ }).click();
  const threads = page.getByRole("textbox", { name: "Threads" });
  await threads.fill("");
  await expect(threads).toHaveValue("");
  await threads.pressSequentially("12");
  await expect(threads).toHaveValue("12");
  await threads.fill("99");
  await threads.press("Tab");
  await expect(threads).toHaveValue("64");
});

// F11 review ruling: a traffic rule's HTTP status is 100 to 599, its delay 0 ms and up.
test("a traffic rule's status and delay are brought into range when you leave them", async ({ page }) => {
  await trafficRules(page, 1);
  await page.getByRole("radio", { name: "Answer" }).click();
  const status = page.getByRole("textbox", { name: "Status", exact: true });
  await status.fill("999");
  await status.press("Tab");
  await expect(status).toHaveValue("599");
  await status.fill("42");
  await status.press("Tab");
  await expect(status).toHaveValue("100");
  await status.fill("abc");
  await status.press("Tab");
  await expect(page.getByText("Enter a number from 100 to 599.")).toBeVisible();

  await page.getByRole("radio", { name: "Change" }).click();
  await addChange(page, "Delay (ms)");
  const delay = page.getByRole("textbox", { name: "Delay (ms)" });
  await delay.fill("-5");
  await delay.press("Tab");
  await expect(delay).toHaveValue("0");
  await addChange(page, "Set status");
  const setStatus = page.getByRole("textbox", { name: "Set status" });
  await setStatus.fill("700");
  await setStatus.press("Tab");
  await expect(setStatus).toHaveValue("599");
});

/** Each step's stored "When it fails" branch in Pricing scrape 6h. */
const onFailOf = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __shardxMock: { state: { automation: { name: string; blocks: { id: string; on_fail: unknown }[] }[] } } };
  const proj = w.__shardxMock.state.automation.find((p) => p.name === "Pricing scrape 6h")!;
  return Object.fromEntries(proj.blocks.map((b) => [b.id, b.on_fail]));
});

/** Saves the open Automation project (manual save, Task 9): nothing is stored before. */
const saveProject = (page: Page) => page.keyboard.press("ControlOrMeta+s");

/** The canvas fit stops at 80 % (Lane D, 733a2598): at 1280 the fifth card,
 *  Post to sheet, lies past the canvas under the side panel. A wider window
 *  fits all five, so a press can reach it as a person's would. */
const wideForEveryCard = (page: Page) => page.setViewportSize({ width: 1800, height: 800 });

// F11 fix round 2, Critical 1: a card selects on mousedown, before the
// field it leaves blurs; the blur must never save into the step just picked.
test("a retry count typed in one step stays there when another step's card is pressed", async ({ page }) => {
  await wideForEveryCard(page);
  await openApp(page, { section: "automation" });
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  // Open page (b2) retries 2 times, Post to sheet (b5) 3 times.
  await page.getByText("Open page", { exact: true }).click();
  const retry = page.getByRole("textbox", { name: "Try again" });
  await expect(retry).toHaveValue("2");
  await retry.fill("7");
  await page.getByText("Post to sheet", { exact: true }).click();
  await expect(retry).toHaveValue("3");
  await saveProject(page);
  await waitForIdle(page);
  expect(await onFailOf(page)).toMatchObject({ b2: { retry: 7 }, b5: { retry: 3 } });
});

// F11 fix round 2, Important 1: how a draft reads, in a field with decimals
// (a coordinate) and in a whole-number one (a port). A lone comma is the
// point where there are decimals and groups thousands where there are none;
// with both marks, the last one is the point.
test("the number a draft reads as, in decimal and whole-number fields", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/shared/lib/parseNumber.ts", "__parse");
  const read = (text: string, decimals: number) => page.evaluate(([t, d]) =>
    (window as unknown as { __parse: { parseNumber: (s: string, d: number) => number | null } }).__parse.parseNumber(t as string, d as number), [text, decimals] as const);
  const table: [string, number | null, number | null][] = [
    // text, with decimals, whole number
    ["48,857", 48.857, 48857],
    ["1,234.5", 1234.5, 1234.5],
    ["1.234,5", 1234.5, 1234.5],
    ["1,234", 1.234, 1234],
    ["-33,8688", -33.8688, null],
    ["10,000,000", null, 10000000],
    ["80,80", 80.8, null],
    ["12 345", 12345, 12345],
    ["1,2.5", null, null],
    ["−33.8688", -33.8688, -33.8688],
  ];
  for (const [text, decimal, whole] of table) {
    expect.soft(await read(text, 4), `${text} with decimals`).toBe(decimal);
    expect.soft(await read(text, 0), `${text} whole`).toBe(whole);
  }
});

/** Pricing scrape 6h with a Scroll, a Tap and a Drag step added, opened on the canvas. */
async function withTouchSteps(page: Page) {
  await openApp(page, { section: "automation" });
  await page.evaluate(() => {
    type B = Record<string, unknown>;
    const w = window as unknown as { __shardxMock: { state: { automation: { name: string; blocks: B[] }[] }; save: () => void } };
    const proj = w.__shardxMock.state.automation.find((p) => p.name === "Pricing scrape 6h")!;
    const step = (id: string, kind: string, label: string, x: number): B =>
      ({ id, kind, label, params: {}, enabled: true, secrets: [], x, y: 300, on_done: "next", on_fail: "stop" });
    proj.blocks.push(step("s1", "scroll", "Scroll feed", 80), step("s2", "touch.tap", "Tap button", 340), step("s3", "touch.drag", "Drag card", 600));
    w.__shardxMock.save();
  });
  await page.reload();
  await waitForIdle(page);
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
}
// Controller ruling, Pair 21: the Automation store saves one version of a
// project at a time. Manual save (Task 9): typing sends nothing; Save sends
// the whole project once, the last thing typed in it.
test("fast typing in an Automation project stores the last thing typed on Save", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  const name = page.getByRole("textbox", { name: "Project name" });
  await name.fill("");
  await name.pressSequentially("Pricing scrape every night");
  await expect(name).toHaveValue("Pricing scrape every night");
  await saveProject(page);
  await waitForIdle(page);
  const stored = await page.evaluate(() =>
    (window as unknown as { __shardxMock: { state: { automation: { id: string; name: string }[] } } }).__shardxMock.state.automation.find((p) => p.id === "proj-pricing")!.name);
  expect(stored).toBe("Pricing scrape every night");
});

const paramsOf = (page: Page, id: string) => page.evaluate((id) => {
  const w = window as unknown as { __shardxMock: { state: { automation: { name: string; blocks: { id: string; params: Record<string, unknown> }[] }[] } } };
  return w.__shardxMock.state.automation.find((p) => p.name === "Pricing scrape 6h")!.blocks.find((b) => b.id === id)!.params;
}, id);

// F11 fix round 2, Important 2: a step's number settings keep what you type.
test("a step's number setting can be cleared, and takes a negative number", async ({ page }) => {
  await withTouchSteps(page);
  await page.getByText("Scroll feed", { exact: true }).click();
  const down = page.getByRole("textbox", { name: "Down by (px)" });
  await expect(down).toHaveValue("600");
  await down.fill("");
  await expect(down).toHaveValue("");
  await down.pressSequentially("-300");
  await expect(down).toHaveValue("-300");
  await down.press("Tab");
  await saveProject(page);
  await expect.poll(async () => (await paramsOf(page, "s1")).deltaY).toBe(-300);
});

test("a step's optional number setting cleared leaves the setting out", async ({ page }) => {
  await withTouchSteps(page);
  await page.getByText("Tap button", { exact: true }).click();
  const x = page.getByRole("textbox", { name: "X", exact: true });
  await expect(x).toHaveValue("");
  await x.fill("120");
  await x.press("Tab");
  await saveProject(page);
  await expect.poll(async () => (await paramsOf(page, "s2")).x).toBe(120);
  await x.fill("");
  await x.press("Tab");
  await expect(x).toHaveValue("");
  await expect(page.getByText("Enter a number.")).toHaveCount(0);
  await saveProject(page);
  await expect.poll(async () => "x" in (await paramsOf(page, "s2"))).toBe(false);
});

// F11 fix round 3, Important 1: an empty optional setting says what empty means.
test("an empty step setting shows its hint", async ({ page }) => {
  await withTouchSteps(page);
  await page.getByText("Drag card", { exact: true }).click();
  const hold = page.getByRole("textbox", { name: "Hold first (ms)" });
  await expect(hold).toHaveValue("");
  await expect(hold).toHaveAttribute("placeholder", "leave empty for the profile’s own");
});

// F11 fix round 3, Important 2: px, ms and counts are whole numbers, so a
// grouped "1,000" is a thousand, not 1.
test("a step's px setting reads a grouped thousand as 1000", async ({ page }) => {
  await withTouchSteps(page);
  await page.getByText("Scroll feed", { exact: true }).click();
  const down = page.getByRole("textbox", { name: "Down by (px)" });
  await down.fill("1,000");
  await down.press("Tab");
  await expect(down).toHaveValue("1000");
  await saveProject(page);
  await expect.poll(async () => (await paramsOf(page, "s1")).deltaY).toBe(1000);
});

// F11 fix round 3, Minor 1: a field taken away while you type commits its
// draft, brought into range, as leaving it would.
test("a retry count typed out of range is saved in range when another step's card is pressed", async ({ page }) => {
  await wideForEveryCard(page);
  await openApp(page, { section: "automation" });
  await page.getByText("Pricing scrape 6h", { exact: true }).click();
  await page.getByText("Open page", { exact: true }).click();
  const retry = page.getByRole("textbox", { name: "Try again" });
  await retry.fill("99");
  await page.getByText("Post to sheet", { exact: true }).click();
  await expect(retry).toHaveValue("3");
  await saveProject(page);
  await expect.poll(async () => (await onFailOf(page)).b2).toMatchObject({ retry: 50 });
});

/** Pricing scrape 6h's Traffic tab with `n` new rules; the last one's form is open. */
async function trafficRules(page: Page, n: number) {
  await openApp(page, { section: "automation" });
  await page.locator("[role='listitem'][data-row-id]").first().click();
  await page.getByRole("radio", { name: /Traffic/ }).click();
  for (let i = 0; i < n; i++) await page.getByRole("button", { name: "Add rule", exact: true }).click();
}
/** The rule rows, one per rule: each a button that opens its form. */
const ruleRows = (page: Page) => page.locator("[data-rule-row]");
/** A Change's extra field, added through "+ More changes". */
async function addChange(page: Page, name: string) {
  await page.getByRole("button", { name: "More changes" }).click();
  await page.getByRole("menuitem", { name }).click();
}

// F11 fix round 2, Minor 1: a removed rule's draft never shows on the next.
test("removing a traffic rule leaves the next rule its own status", async ({ page }) => {
  await trafficRules(page, 2);
  await page.getByRole("radio", { name: "Answer" }).click();
  await ruleRows(page).nth(0).click();
  await page.getByRole("radio", { name: "Answer" }).click();
  const status = page.getByRole("textbox", { name: "Status", exact: true });
  await status.fill("abc");
  await status.press("Tab");
  await expect(page.getByText("Enter a number from 100 to 599.")).toBeVisible();
  await page.getByRole("button", { name: "Remove rule" }).click();
  await expect(ruleRows(page)).toHaveCount(1);
  await ruleRows(page).first().click();
  await expect(status).toHaveValue("200");
  await expect(page.getByText("Enter a number from 100 to 599.")).toHaveCount(0);
});

// F11 fix round 3, Minor 2: Undo after Remove brings the rule back with its
// own value, never the value of the rule that took its place.
test("Undo after removing a traffic rule brings it back with its own status", async ({ page }) => {
  await trafficRules(page, 2);
  const status = page.getByRole("textbox", { name: "Status", exact: true });
  await page.getByRole("radio", { name: "Answer" }).click();
  await status.fill("500");
  await status.press("Tab");
  await ruleRows(page).nth(0).click();
  await page.getByRole("radio", { name: "Answer" }).click();
  await status.fill("404");
  await status.press("Tab");
  await page.getByRole("button", { name: "Remove rule" }).click();
  await expect(ruleRows(page)).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(ruleRows(page)).toHaveCount(2);
  await ruleRows(page).nth(0).click();
  await expect(status).toHaveValue("404");
  await ruleRows(page).nth(1).click();
  await expect(status).toHaveValue("500");
});

// F11 fix round 2, Minor 2: an empty delay is no delay.
test("a traffic rule's delay can be left empty for no delay", async ({ page }) => {
  await trafficRules(page, 1);
  await page.getByRole("radio", { name: "Change" }).click();
  await addChange(page, "Delay (ms)");
  const delay = page.getByRole("textbox", { name: "Delay (ms)" });
  await expect(delay).toHaveValue("");
  await delay.fill("250");
  await delay.press("Tab");
  await expect(delay).toHaveValue("250");
  await delay.fill("");
  await delay.press("Tab");
  await expect(delay).toHaveValue("");
  await expect(page.getByText("Enter a number.")).toHaveCount(0);
});

// F11 fix round 2, Minor 3: a message under Threads grows the run settings
// below the fields; it never lifts Threads above Loops.
test("the run settings' fields stay in line when one shows a message", async ({ page }) => {
  await openApp(page, { section: "automation" });
  await page.locator("[role='listitem'][data-row-id]").first().click();
  await page.getByRole("button", { name: /^Threads/ }).click();
  const threads = page.getByRole("textbox", { name: "Threads" });
  const loops = page.getByRole("textbox", { name: "Loops" });
  const before = await boxOf(threads);
  expect(Math.abs(before.y - (await boxOf(loops)).y)).toBeLessThanOrEqual(1);
  await threads.fill("abc");
  await threads.press("Tab");
  await expect(page.getByText("Enter a number from 1 to 64.")).toBeVisible();
  const t = await boxOf(threads);
  expect(Math.abs(t.y - (await boxOf(loops)).y)).toBeLessThanOrEqual(1);
  expect(Math.abs(t.y - before.y)).toBeLessThanOrEqual(1);
});
