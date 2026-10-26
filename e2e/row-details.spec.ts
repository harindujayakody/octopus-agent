import { expect, test, type Page } from "@playwright/test";
import { openApp, openEditForm } from "./support/app";
import { boxOf, isTruncated } from "./support/geometry";

// F7: the Profiles row says what it shows in full or hands it over (CRAFT-13, TYPE-07). Task 18 appends.
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });

test("the proxy cell names the proxy the way Proxies and Peek do (CRAFT-13)", async ({ page }) => {
  await openApp(page);
  const cell = row(page, "Amazon US seller").locator("[data-cell='proxy']");
  await expect(cell.locator("[data-proxy-name]")).toHaveText("ProxyShard resi US");
  await cell.locator("[data-proxy-name]").hover();
  await expect(page.getByRole("tooltip")).toContainText(/:\d+/);
  await expect(page.getByRole("tooltip")).toContainText("SOCKS5");
});

// Merge point 4 (visual review I8): at 1024 every name read "DC Ne…". Notes
// gives way first, and Proxy no further than its flag and about ten
// characters of the name, so a short name shows whole.
test("at 1024 a proxy name keeps about ten characters: a short one shows whole", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page);
  const name = page.locator("[data-cell='proxy'] [data-proxy-name]", { hasText: "DC New York" }).first();
  await expect(name).toBeVisible();
  expect(await isTruncated(name)).toBe(false);
});

test("an unnamed proxy keeps its port in view at 1024 (TYPE-07)", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page, { section: "proxies" });
  await page.locator("main header").getByRole("button", { name: "Add proxies" }).click();
  const dialog = page.getByRole("dialog", { name: "Add proxies" });
  await dialog.getByRole("textbox", { name: "Paste one proxy per line" }).fill("socks5://relay-very-long-hostname.example:61234");
  await dialog.getByRole("button", { name: "Preview" }).click();
  await dialog.getByRole("button", { name: "Add 1 proxy" }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator("aside [data-nav='profiles']").click();
  // The profile form's Proxy tab picks it; Save gives it to the profile.
  const form = await openEditForm(page, "Sandbox", "Proxy");
  await form.locator("[data-property='proxy'] button").click();
  await page.getByRole("option", { name: /relay-very-long-hostname/ }).click();
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  const address = row(page, "Sandbox").locator("[data-cell='proxy'] [data-proxy-address]");
  await expect(address).toContainText(":61234");
  await expect(address.locator("[data-port]")).toBeVisible();
  expect(await isTruncated(address.locator("[data-port]"))).toBe(false);
});

test("pinned names line up with the others; the pin sits after the name (CRAFT-15)", async ({ page }) => {
  await openApp(page);
  const pinned = await boxOf(row(page, "Amazon US seller").locator("[data-cell='name'] [data-name]"));
  const plain = await boxOf(row(page, "eBay DE buyer").locator("[data-cell='name'] [data-name]"));
  expect(Math.abs(pinned.x - plain.x)).toBeLessThanOrEqual(0.5);
  const pin = await boxOf(row(page, "Amazon US seller").locator("[data-cell='name'] [data-pin]"));
  expect(pin.x).toBeGreaterThan(pinned.x);
});

// Task 18: tags fit or fold, the status trigger, a failed proxy's mark.
const threeTags = (page: Page) => page.addInitScript(() => {
  localStorage.setItem("shardx.tags", JSON.stringify({
    version: 1,
    tags: [
      { id: "t1", name: "warm-up", color: "green" },
      { id: "t2", name: "needs 2FA", color: "orange" },
      { id: "t3", name: "shopify payouts", color: "sky" },
    ],
    byProfile: { a78a0eea: ["t1", "t2", "t3"] },
  }));
});

test("tag chips show whole or give way to +N, never a letter (EMIL-15)", async ({ page }) => {
  await threeTags(page);
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page);
  const cell = row(page, "Amazon US seller").locator("[data-cell='tags']");
  const chips = cell.locator("[data-tag]");
  await expect(chips.first()).toBeVisible();
  const n = await chips.count();
  expect(n).toBeLessThan(3);
  for (let i = 0; i < n; i++) expect(await isTruncated(chips.nth(i).locator("span.truncate"))).toBe(false);
  await expect(cell.locator("[data-more-tags]")).toContainText(`+${3 - n}`);
});

test("the hidden tags are read out, not only shown on hover (PC-089)", async ({ page }) => {
  await threeTags(page);
  await page.setViewportSize({ width: 1024, height: 680 });
  await openApp(page);
  const more = row(page, "Amazon US seller").locator("[data-cell='tags'] [data-more-tags]");
  await expect(more.locator(".sr-only")).toContainText("shopify payouts");
});

test("the status dot carries the tooltip with its word (FEEL-27)", async ({ page }) => {
  await openApp(page);
  const cell = row(page, "Amazon US seller").locator("[data-cell='status']");
  const box = await boxOf(cell);
  // Over the dot (or the pill's lead once the Live pill takes the cell).
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await expect(page.getByRole("tooltip")).toContainText("Running for");
});

test("a failed proxy test has its own shape, and says Failed when the Test column is hidden (A11Y-18)", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const dead = page.locator("[role='row'][data-proxy-id='px-dead']");
  await expect(dead.locator("[data-cell='test'] [data-failed-mark]")).toBeVisible();
  await expect(dead.locator("[data-cell='name'] [data-failed-word]")).toHaveCount(0);
  // Test hidden through its title's menu (ORDER.md, Pair 23).
  const header = page.getByRole("treegrid", { name: "Proxies" }).locator("[role='row'][aria-rowindex='1']");
  const b = await boxOf(header.locator("[data-col='test']"));
  await page.mouse.click(b.x + 8, b.y + b.height / 2, { button: "right" });
  await page.getByRole("menu", { name: "Test result column" }).getByRole("menuitemcheckbox", { name: "Test result" }).click();
  await page.keyboard.press("Escape");
  await expect(dead.locator("[data-cell='test']")).toHaveCount(0);
  await expect(dead.locator("[data-cell='name'] [data-failed-word]")).toHaveText("Failed");
});
