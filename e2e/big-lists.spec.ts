import { expect, test, type Locator, type Page } from "@playwright/test";
import { appModule, openApp, waitForIdle } from "./support/app";
import { commits, countCommits } from "./support/perf";
import { pickOption } from "./support/select";

// PERF-19: lists over profiles and proxies mount only the rows in view.
const scale = (page: Page, knobs: Record<string, number>) =>
  page.addInitScript((k) => { Object.assign(window, k); }, knobs);
/** Scrolls the windowed list (or the page that scrolls it) to its end. */
const toEnd = (page: Page) => page.locator("[data-windowed]").first().evaluate((el) => {
  let box: HTMLElement | null = el as HTMLElement;
  while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
  box!.scrollTop = box!.scrollHeight;
});

test("Assign's Spread list mounts only the proxies in view", async ({ page }) => {
  await scale(page, { __shardxMockProxies: 1000 });
  await openApp(page);
  await page.locator("[role='row'][data-profile-id='f62a9d43'] [data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: /Change proxy/ }).click();
  const dialog = page.getByRole("dialog", { name: /Assign/ });
  // The kit Combobox windows its options above 100 (Task 18).
  await expect(dialog.getByRole("option").first()).toBeVisible();
  expect(await dialog.getByRole("option").count()).toBeLessThan(60);
  await dialog.getByRole("listbox").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(dialog.getByText(/Proxy 1000/)).toBeVisible();
});

// Pair 26 review: End on a focused checkbox scrolls the box; the row that
// holds the focus stays mounted, so the focus stays on it. The proxies list is
// a Combobox now (Task 18); the profiles list from Proxies keeps the rows.
const openProfilesList = async (page: Page) => {
  await scale(page, { __shardxMockProfiles: 1000 });
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id]").first().locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("button", { name: "Assign to profiles" }).click();
  return page.getByRole("dialog");
};

test("a focused row in a windowed list keeps the focus when End scrolls it away", async ({ page }) => {
  const dialog = await openProfilesList(page);
  const first = dialog.getByRole("checkbox", { name: /Profile 0001/ });
  await first.focus();
  await page.keyboard.press("End");
  await expect(dialog.getByText("Profile 1000")).toBeVisible();
  await expect(first).toBeFocused();
});

// Pair 24 review, Minor 1: the kept row is held by its id, not its index. A
// profile added above it from outside (a store update while the dialog is
// open) moves it down one; the row that holds the focus stays, not its old index.
test("a focused row scrolled away keeps the focus when a row is added above it", async ({ page }) => {
  const dialog = await openProfilesList(page);
  const first = dialog.getByRole("checkbox", { name: /Profile 0001/ });
  await first.focus();
  await page.keyboard.press("End");
  await expect(dialog.getByText("Profile 1000")).toBeVisible();
  await appModule(page, "/src/entities/profile/index.ts", "__profile");
  await page.evaluate(() => {
    const { useProfile } = (window as unknown as { __profile: typeof import("../src/entities/profile") }).__profile;
    useProfile.setState((s) => {
      const base = s.profiles.find((p) => p.id === "bulk-1")!;
      return { profiles: [{ ...base, id: "added-on-top", name: "Added on top" }, ...s.profiles] };
    });
  });
  await expect(dialog.getByText("Profile 1000")).toBeVisible();
  await expect(first).toBeFocused();
});

test("Assign to profiles lists only the profiles in view", async ({ page }) => {
  await scale(page, { __shardxMockProfiles: 1000 });
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id]").first().locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("button", { name: "Assign to profiles" }).click();
  const dialog = page.getByRole("dialog", { name: /Assign 1 proxy/ });
  await expect(dialog.getByRole("checkbox").first()).toBeVisible();
  expect(await dialog.getByRole("checkbox").count()).toBeLessThan(60);
  await dialog.locator("[data-windowed]").last().evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(dialog.getByText("Profile 1000")).toBeVisible();
});

// Owner rule: a scroll box never cuts a focus ring. A checkbox's ring
// reaches 4 px past its box (2 px offset, 2 px line).
const ringCut = (box: Locator) => box.evaluate((el) => {
  const b = el.getBoundingClientRect();
  const left = b.left + el.clientLeft, top = b.top + el.clientTop;
  const c = el.querySelector("input[type='checkbox']")!.getBoundingClientRect();
  const cut = (n: number) => Math.max(0, Math.round(n * 2) / 2);
  return { left: cut(left - (c.left - 4)), top: cut(top - (c.top - 4)), right: cut(c.right + 4 - (left + el.clientWidth)) };
});
const whole = { left: 0, top: 0, right: 0 };

test("the checkbox rings in Assign to profiles' list show whole", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id]").first().locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("button", { name: "Assign to profiles" }).click();
  const distribute = page.getByRole("dialog", { name: /Assign 1 proxy/ });
  await distribute.getByRole("radio", { name: "All profiles" }).click();
  await expect(distribute.getByRole("checkbox").first()).toBeVisible();
  expect(await ringCut(distribute.locator("[data-windowed]").last())).toEqual(whole);
});

test("the importer mounts only the parsed lines in view, and Test all draws about once a frame", async ({ page }) => {
  await countCommits(page);
  await scale(page, { __shardxMockTestMs: 2, __shardxMockLatency: 0 });
  await openApp(page, { section: "proxies" });
  await page.locator("main header").getByRole("button", { name: "Add proxies" }).click();
  const lines = Array.from({ length: 200 }, (_, i) => `socks5://10.9.${Math.floor(i / 250)}.${i % 250}:1080`).join("\n");
  await page.getByRole("textbox", { name: "Paste one proxy per line" }).fill(lines);
  await page.getByRole("button", { name: "Preview" }).click();
  const box = page.getByRole("dialog").locator("[data-windowed]");
  await expect(box).toBeVisible();
  expect(await box.getByRole("checkbox").count()).toBeLessThan(60);
  const before = await commits(page);
  await page.getByRole("button", { name: "Test all", exact: true }).click();
  await expect(page.getByRole("button", { name: "Test all", exact: true })).toBeEnabled({ timeout: 20_000 });
  // 200 results: before, about 400 renders of every row (one per status change).
  expect((await commits(page)) - before).toBeLessThan(80);
});

test("the Trash mounts only the entries in view", async ({ page }) => {
  await scale(page, { __shardxMockTrash: 1000 });
  await openApp(page, { section: "trash" });
  // The Trash is a DataList (F25a): it windows its rows as the other lists do.
  const trash = page.getByRole("treegrid", { name: "Trash" });
  await expect(trash.locator("[role='row'][data-row-id]").first()).toBeVisible();
  expect(await trash.locator("[role='row'][data-row-id]").count()).toBeLessThan(60);
  await trash.locator("xpath=..").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByText("Trashed 1000")).toBeVisible();
});

// PERF-21: the Proxies page reads the Profiles store's list, and asks for the
// results on screen first.
type Log = { __shardxMock: { calls: Record<string, number>; log: { cmd: string; args: { id?: string } }[] } };
const callCount = (page: Page, cmd: string) => page.evaluate((c) => (window as unknown as Log).__shardxMock.calls[c] ?? 0, cmd);

test("the Proxies page asks for no second profile list, and for the results on screen first", async ({ page }) => {
  await scale(page, { __shardxMockProxies: 1000 });
  await openApp(page);
  // Profiles reads the used proxies' last tests for its action cards, once
  // the page is idle (Live Task 10, A1): count only what Proxies asks.
  await waitForIdle(page);
  const lists = await callCount(page, "profile_list");
  const before = await page.evaluate(() => (window as unknown as Log).__shardxMock.log.length);
  await page.locator("aside [data-nav='proxies']").click();
  await expect(page.locator("[role='row'][data-proxy-id]").first()).toBeVisible();
  await waitForIdle(page);
  expect(await callCount(page, "profile_list")).toBe(lists);
  const onScreen = await page.locator("[role='row'][data-proxy-id]").evaluateAll((rows) => rows.slice(0, 10).map((r) => r.getAttribute("data-proxy-id")));
  const asked = await page.evaluate((before) =>
    (window as unknown as Log).__shardxMock.log.slice(before).filter((l) => l.cmd === "proxy_last_test").slice(0, 10).map((l) => l.args.id), before);
  expect(asked).toEqual(onScreen);
});

test("the Proxies page counts a profile bound on the Profiles page without reading the list again", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const tokyo = page.locator("[role='row'][data-proxy-id]", { hasText: "DC Tokyo" }).locator("[data-cell='profiles']");
  const before = Number((await tokyo.textContent())?.trim() || "0");
  // Counted before the bind: the Proxies store used to read the list again on it.
  const lists = await callCount(page, "profile_list");
  await page.locator("aside [data-nav='profiles']").click();
  await page.locator("[role='row'][data-profile-id='f62a9d43'] [data-cell='proxy']").dblclick();
  // The row's proxy popover, then its Select (R3: the option role, C19's pickOption).
  await pickOption(page.getByRole("dialog", { name: "Proxy", exact: true }), "Proxy", /DC Tokyo/);
  await waitForIdle(page);
  await page.locator("aside [data-nav='proxies']").click();
  await expect(tokyo).toHaveText(String(before + 1));
  expect(await callCount(page, "profile_list")).toBe(lists);
});
