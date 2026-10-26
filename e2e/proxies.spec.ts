import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";
import { openSearch } from "./support/search";

const row = (page: Page, name: string) => page.locator("[role='row'][data-proxy-id]", { hasText: name });
const active = (page: Page) => page.locator("[role='row'][data-proxy-id][data-active]");

test("proxy rows are single lines, 36 px tall", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const box = (await row(page, "DC New York").boundingBox())!;
  expect(box.height).toBe(36);
  await expect(page.getByRole("treegrid", { name: "Proxies" })).toBeVisible();
});

test("a thousand proxies: only the rows on screen are rendered, the last is reachable", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockProxies: number }).__shardxMockProxies = 1000; });
  await openApp(page, { section: "proxies" });
  await expect(row(page, "DC New York")).toBeVisible();
  expect(await page.locator("[role='row'][data-proxy-id]").count()).toBeLessThan(60);
  await page.getByRole("treegrid", { name: "Proxies" }).evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(row(page, "Proxy 1000")).toBeVisible();
});

test("arrows move the active row; X selects it; Cmd/Ctrl+A selects all", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await row(page, "ProxyShard resi US").locator("[data-cell='type']").click();
  await page.keyboard.press("ArrowDown");
  await expect(active(page)).toContainText("DC New York");
  await expect(active(page)).toBeFocused();
  await page.keyboard.press("x");
  await expect(row(page, "DC New York")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ControlOrMeta+a");
  // 7 since Task 5i added a never-tested seed proxy ("New DC Warsaw").
  await expect(page.locator("[role='row'][data-proxy-id][aria-selected='true']")).toHaveCount(7);
});

test("the hover-action strip matches the active proxy row's fill (fix round 1, finding 1)", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.keyboard.press("ArrowDown");
  await expect(active(page)).toBeFocused();
  const rowBg = await active(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  const stripBg = await active(page).locator("[data-hover-strip]").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(stripBg).toBe(rowBg);
});

test("the hover-action strip still matches the active proxy row's fill on hover (fix round 2, finding 1)", async ({ page }) => {
  // The active row's own background has no hover variant; the strip must
  // not gain one either, or hovering an active proxy row shows a two-tone
  // band.
  await openApp(page, { section: "proxies" });
  await page.keyboard.press("ArrowDown");
  await expect(active(page)).toBeFocused();
  await active(page).hover();
  const rowBg = await active(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  const stripBg = await active(page).locator("[data-hover-strip]").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(stripBg).toBe(rowBg);
});

test("list keys pressed on a sidebar button do nothing to the proxy list (A11Y-02)", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await row(page, "DC Tokyo").locator("[data-cell='type']").click();
  await page.locator("aside [data-nav='profiles']").focus();
  for (const key of ["t", "Backspace", "Delete"]) await page.keyboard.press(key);
  await page.waitForTimeout(300);
  await expect(row(page, "DC Tokyo")).toHaveCount(1);
  // T would start a test (a spinner, then a fresh result); Backspace/Delete
  // would hide the row behind an Undo toast — none of that happened, and no dialog opened.
  await expect(page.getByRole("dialog").or(page.getByRole("alertdialog"))).toHaveCount(0);
  await expect(active(page)).toContainText("DC Tokyo");
});

test("a Shift-click selects the run from the last clicked checkbox", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await row(page, "DC New York").locator("[data-cell='checkbox'] input").check({ force: true });
  await row(page, "Mobile UK EE").locator("[data-cell='checkbox']").click({ modifiers: ["Shift"] });
  await expect(page.locator("[role='row'][data-proxy-id][aria-selected='true']")).toHaveCount(4);
});

test("the row's More button opens the same menu as a right-click", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await row(page, "DC Tokyo").hover();
  await row(page, "DC Tokyo").getByRole("button", { name: "More actions" }).click();
  // Test and Delete show their keys as caps after the label (UI-29).
  // From the registry since E3 (Pair 38): Open in Peek, with its Enter.
  // Delete asks nothing since F38 (ruling 18), so it has no "…".
  const items = [/^Test/, /^Open in Peek/, "Copy address", /^Delete(?!…)/];
  await expect(page.getByRole("menuitem")).toHaveText(items);
  await page.keyboard.press("Escape");
  await row(page, "DC Tokyo").click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText(items);
});

// Task 5f: the separate status-dot column is gone (it only duplicated this
// text); the Test result cell alone carries the state, in words, with its
// dot folded in as decoration (`data-status` moved onto this cell).
test("the Test result column says whether the last test reached the proxy", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await expect(row(page, "DC Tokyo").locator("[data-cell='test']")).toHaveAttribute("data-status", /ok|failed|untested/);
  await expect(row(page, "Old datacenter").locator("[data-cell='test']")).toHaveAttribute("data-status", "failed");
  // The visible word, `[data-status-label]`: the cell's full text (fix
  // round 1, item 2) also carries an sr-only "when last tested" detail.
  await expect(row(page, "Old datacenter").locator("[data-cell='test'] [data-status-label]")).toHaveText("Failed");
});

// Fix round 1, item 2: the removed dot's tooltip carried when the proxy was
// last tested; that information comes back as a hover tooltip and an
// sr-only span on the Test result cell itself (a tested proxy only).
test("the Test result cell's accessible name includes when the proxy was last tested", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await expect(row(page, "DC Tokyo").locator("[data-cell='test']")).toHaveAccessibleName(/Reached in \d+ ms/);
});

const bar = (page: Page) => page.getByRole("toolbar", { name: /selected/ });
// A delete waits behind its Undo toast (ruling 18); closing the toast runs it.
const commitDelete = (page: Page) =>
  page.locator("[data-toast]").filter({ has: page.getByRole("button", { name: "Undo" }) }).getByRole("button", { name: "Dismiss" }).click();
const tests = (page: Page, id: string) => page.evaluate((id) =>
  (window as unknown as { __shardxMock: { state: { snapshots: Record<string, unknown[]> } } }).__shardxMock.state.snapshots[id]?.length ?? 0, id);
const exists = (page: Page, id: string) => page.evaluate((id) =>
  (window as unknown as { __shardxMock: { state: { proxies: { id: string }[] } } }).__shardxMock.state.proxies.some((p) => p.id === id), id);

test("selecting shows a floating bar; its Test tests each selected proxy", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const before = [await tests(page, "px-us-2"), await tests(page, "px-jp-1")];
  for (const n of ["DC New York", "DC Tokyo"]) await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
  await expect(bar(page)).toContainText("2 selected");
  await expect(page.locator("main header").getByRole("toolbar")).toHaveCount(0);
  await bar(page).getByRole("button", { name: "Test" }).click();
  await expect.poll(async () => [await tests(page, "px-us-2"), await tests(page, "px-jp-1")], { timeout: 8000 })
    .toEqual([before[0] + 1, before[1] + 1]);
});

test("Delete in the bar hides the selection behind Undo, then deletes it", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  for (const n of ["DC New York", "DC Tokyo"]) await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
  await bar(page).getByRole("button", { name: /Delete/ }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(row(page, "DC New York")).toHaveCount(0);
  await expect(row(page, "DC Tokyo")).toHaveCount(0);
  // The deleted rows leave the selection.
  await expect(bar(page)).toHaveCount(0);
  await commitDelete(page);
  await expect.poll(() => exists(page, "px-jp-1")).toBe(false);
  expect(await exists(page, "px-us-2")).toBe(false);
});

test("a filter that hides selected proxies keeps them out of bulk actions", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  for (const n of ["DC New York", "DC Tokyo"]) await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
  await (await openSearch(page)).fill("Tokyo");
  await expect(bar(page)).toContainText("1 selected");
  await bar(page).getByRole("button", { name: /Delete/ }).click();
  await commitDelete(page);
  await expect.poll(() => exists(page, "px-jp-1")).toBe(false);
  expect(await exists(page, "px-us-2")).toBe(true);
});

test("T tests the active proxy; Delete deletes it behind Undo", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const before = await tests(page, "px-jp-1");
  await row(page, "DC Tokyo").locator("[data-cell='type']").click();
  await page.keyboard.press("t");
  await expect.poll(() => tests(page, "px-jp-1"), { timeout: 6000 }).toBe(before + 1);
  await page.keyboard.press("Delete");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(row(page, "DC Tokyo")).toHaveCount(0);
});

test("Import proxies from clipboard lives in the header's More actions menu", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.evaluate(() => { (window as unknown as { __shardxMockClipboard: string }).__shardxMockClipboard = "socks5://1.2.3.4:1080"; });
  await expect(page.locator("main header").getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
  await page.locator("main header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Import proxies from clipboard" }).click();
  await expect(row(page, "1.2.3.4")).toHaveCount(1);
});

// Providers that route by the password (a sticky session or a country in it)
// serve different exits from one host, port and user: each is a proxy of its
// own. Only an identical one (same type, host, port, user and password) is
// skipped. Before, every proxy after the first with that host, port and user
// was dropped.
type ProxyApi = { useProxy: { getState: () => { peekId: string | null; proxies: { id: string; host: string; username: string; password: string }[] } } };
const gateway = (page: Page) => page.evaluate(() =>
  (window as unknown as { __px: ProxyApi }).__px.useProxy.getState().proxies.filter((p) => p.host === "gate.example.net").map((p) => p.password));

test("proxies that differ only by password are all added; an identical one is skipped", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await appModule(page, "/src/entities/proxy/index.ts", "__px");
  await page.locator("main header").getByRole("button", { name: "Add proxies" }).click();
  const dialog = page.getByRole("dialog", { name: "Add proxies" });
  await dialog.getByRole("textbox", { name: "Paste one proxy per line" }).fill([
    "gate.example.net:7000:alice:pw_session-a1",
    "gate.example.net:7000:alice:pw_session-b2",
    "gate.example.net:7000:alice:pw_session-b2",
  ].join("\n"));
  await dialog.getByRole("button", { name: "Preview" }).click();
  await dialog.getByRole("button", { name: "Add 3 proxies" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Imported 2 proxies" })).toBeVisible();
  await expect.poll(() => gateway(page)).toEqual(["pw_session-a1", "pw_session-b2"]);
  await expect(row(page, "gate.example.net:7000")).toHaveCount(2);

  // From the clipboard too: one more password is one more proxy, a known one is not.
  await page.evaluate(() => {
    (window as unknown as { __shardxMockClipboard: string }).__shardxMockClipboard = "gate.example.net:7000:alice:pw_session-a1\ngate.example.net:7000:alice:pw_session-c3";
  });
  await page.locator("main header").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Import proxies from clipboard" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Imported 1 proxy" })).toBeVisible();
  await expect.poll(() => gateway(page)).toEqual(["pw_session-a1", "pw_session-b2", "pw_session-c3"]);
});

test("Add proxy opens the proxy it added, not another with the same host, port and user", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await appModule(page, "/src/entities/proxy/index.ts", "__px");
  for (const password of ["pw_session-a1", "pw_session-b2"]) {
    await page.locator("main header").getByRole("button", { name: "Add proxies" }).click();
    const dialog = page.getByRole("dialog", { name: "Add proxies" });
    await dialog.getByRole("textbox").fill(`gate.example.net:7000:alice:${password}`);
    await dialog.getByRole("button", { name: "Preview" }).click();
    await dialog.getByRole("button", { name: "Add 1 proxy" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const s = (window as unknown as { __px: ProxyApi }).__px.useProxy.getState();
      return s.proxies.find((p) => p.id === s.peekId)?.password;
    })).toBe(password);
  }
  await expect.poll(() => gateway(page)).toEqual(["pw_session-a1", "pw_session-b2"]);
});

test("a proxy's flag is its own image file, loaded when shown", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const flag = page.locator("[role='row'][data-proxy-id] [data-flag]").first();
  await expect(flag).toBeVisible();
  const bg = await flag.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toMatch(/(flags\/4x3\/|assets\/)[a-z]{2}(-[\w-]+)?\.svg/);
});

// Live layer, Task 6 (spec 4.2): the Test result is a tinted pill with its
// word (the IP stays beside it, in mono), and the type is a protocol chip in
// its own hue: SOCKS5 violet, HTTP blue, HTTPS magenta.
test("Test results are tinted pills, OK {n} ms, Failed or Not tested, and the type is a protocol chip", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const result = (name: string) => row(page, name).locator("[data-cell='test'] [data-pill='proxy-test']");
  await expect(result("DC Tokyo")).toHaveAttribute("data-state", "ok");
  await expect(result("DC Tokyo").locator("[data-status-label]")).toHaveText(/^OK \d+ ms$/);
  await expect(row(page, "DC Tokyo").locator("[data-cell='test'] .mono")).toHaveText(/^\d+\.\d+\.\d+\.\d+$/);
  await expect(result("Old datacenter")).toHaveAttribute("data-state", "failed");
  await expect(result("Old datacenter").locator("[data-status-label]")).toHaveText("Failed");
  await expect(result("New DC Warsaw")).toHaveAttribute("data-state", "untested");
  await expect(result("New DC Warsaw").locator("[data-status-label]")).toHaveText("Not tested");
  // The word is whole, never cut, even at the column's narrowest.
  for (const name of ["DC Tokyo", "Old datacenter", "New DC Warsaw"]) {
    const [scroll, client] = await result(name).locator("[data-status-label]").evaluate((el) => [el.scrollWidth, el.clientWidth]);
    expect(scroll, name).toBeLessThanOrEqual(client);
  }
  for (const [name, kind, text] of [["DC Tokyo", "socks5", "SOCKS5"], ["ISP Frankfurt", "http", "HTTP"], ["Old datacenter", "https", "HTTPS"]]) {
    const chip = row(page, name).locator("[data-cell='type'] [data-pill='protocol']");
    await expect(chip, name).toHaveText(text);
    await expect(chip, name).toHaveAttribute("data-protocol", kind);
  }
});

// Tasks 5-6 review, M7: a proxy that arrives slides in once, as a new
// profile's row does (spec 6.2).
test("an added proxy's row slides in once", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.locator("main header").getByRole("button", { name: "Add proxies" }).click();
  const dialog = page.getByRole("dialog", { name: "Add proxies" });
  await dialog.getByRole("textbox").fill("socks5://198.51.100.97:1080");
  await dialog.getByRole("button", { name: "Preview" }).click();
  await dialog.getByRole("button", { name: "Add 1 proxy" }).click();
  await expect(row(page, "198.51.100.97")).toHaveClass(/slide-in/);
  await expect(row(page, "198.51.100.97")).not.toHaveClass(/slide-in/, { timeout: 1500 });
  await expect(row(page, "DC Tokyo")).not.toHaveClass(/slide-in/);
});
