import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// Bulk and single proxy actions say what really happened (LQ-01, LQ-02).
const row = (page: Page, name: string) => page.locator("[role='row'][data-proxy-id]", { hasText: name });
const bar = (page: Page) => page.getByRole("toolbar", { name: /selected/ });
const failNext = (page: Page, cmds: Record<string, number>) =>
  page.evaluate((c) => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = c; }, cmds);

test("a failed test shows the failure, not the last good result", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const r = row(page, "DC Tokyo");
  await expect(r.locator("[data-cell='test']")).toHaveAttribute("data-status", "ok");
  await failNext(page, { proxy_full_test: 1 });
  await r.hover();
  await r.getByRole("button", { name: "Test" }).click();
  await expect(r.locator("[data-cell='test']")).toHaveAttribute("data-status", "failed");
  // The visible word, `[data-status-label]`: the cell's full text also
  // carries the sr-only detail (P20/P21: same pattern as e2e/proxies.spec.ts).
  await expect(r.locator("[data-cell='test'] [data-status-label]")).toHaveText("Failed");
  // The reason is in the row itself too, not only Peek (fix round 1, finding
  // 5): a visually-hidden sibling of the visible word, read on the row
  // without opening anything (same sr-only-detail pattern as the ok state).
  await expect(r.locator("[data-cell='test']")).toContainText("Mock failure: proxy_full_test");
  await r.locator("[data-cell='name']").click();
  const peek = page.locator("aside[data-peek='proxy']");
  await expect(peek).toContainText("TCP failed");
  await expect(peek).toContainText("Mock failure: proxy_full_test");
});

// The seed has 7 proxies (not the 6 the brief was written against — an
// eighth, "New DC Warsaw", was later added for e2e/status-dots.spec.ts): the
// first 4 in table order fail, the remaining 3 succeed, so 4 stay selected
// either way.
test("a bulk delete with failures says how many failed, and keeps them selected", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await row(page, "DC Tokyo").locator("[data-cell='type']").click();
  await page.keyboard.press("ControlOrMeta+a");
  await failNext(page, { proxy_delete: 4 });
  await bar(page).getByRole("button", { name: /^Delete/ }).click();
  // The delete waits behind its Undo toast (ruling 18); closing it runs it.
  const undo = page.locator("[data-toast]").filter({ has: page.getByRole("button", { name: "Undo" }) });
  await expect(undo).toContainText("Deleted 7 proxies");
  await undo.getByRole("button", { name: "Dismiss" }).click();
  // The 4 that failed come back, named, with the backend's reason.
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn’t delete 4 proxies" })).toContainText("Mock failure: proxy_delete");
  await expect(page.locator("[role='row'][data-proxy-id]")).toHaveCount(4);
  await expect(page.locator("[role='row'][data-proxy-id][aria-selected='true']")).toHaveCount(4);
  await expect(bar(page)).toContainText("4 selected");
});

test("a bulk test says how many worked and how many failed", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  for (const name of ["DC Tokyo", "Old datacenter"]) await row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
  await bar(page).getByRole("button", { name: "Test" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "Tested 2: 1 working, 1 failed" })).toBeVisible({ timeout: 8000 });
});

test("an Assign to profiles with a failure says so", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  for (const name of ["DC Tokyo", "DC New York"]) await row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
  await bar(page).getByRole("button", { name: "Assign to profiles" }).click();
  const dialog = page.getByRole("dialog", { name: "Assign 2 proxies" });
  await dialog.getByRole("radio", { name: "All profiles" }).click();
  await failNext(page, { profile_bind_proxy: 1 });
  await dialog.getByRole("button", { name: "Assign 2" }).click();
  // G8: the title names the action; the backend's words are the detail.
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn’t assign proxies to 1 of 2 profiles" })).toContainText("Mock failure: profile_bind_proxy");
  // The selection stays as it was (owner rule: bulk actions keep it).
  await expect(bar(page)).toContainText("2 selected");
});
