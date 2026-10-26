import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";

// IFACE-03, O9b: one rule for assigning, in one dialog; sharing only on purpose.
type Plan = { pairs: { profileId: string; proxyId: string | null }[]; left: string[]; skippedShared: string[]; perProxy: Record<string, number> };
const plan = (page: Page, profiles: string[], proxies: (string | null)[], allowSharing: boolean, usedBy: Record<string, string[]> = {}) =>
  page.evaluate(({ a, b, s, u }) => (window as unknown as { __assign: { planAssignment: (...x: unknown[]) => Plan } }).__assign.planAssignment(a, b, { allowSharing: s, usedBy: u }), { a: profiles, b: proxies, s: allowSharing, u: usedBy });
const P8 = ["a", "b", "c", "d", "e", "f", "g", "h"];

test.describe("planAssignment", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await appModule(page, "/src/entities/profile/lib/assignment.ts", "__assign");
  });

  test("never shares by default: 8 profiles and 2 proxies give 2 pairs, 6 keep theirs", async ({ page }) => {
    const p = await plan(page, P8, ["x", "y"], false);
    expect(p.pairs).toEqual([{ profileId: "a", proxyId: "x" }, { profileId: "b", proxyId: "y" }]);
    expect(p.left).toEqual(["c", "d", "e", "f", "g", "h"]);
  });

  test("Allow sharing hands them out in turn: 4 each", async ({ page }) => {
    const p = await plan(page, P8, ["x", "y"], true);
    expect(p.perProxy).toEqual({ x: 4, y: 4 });
    expect(p.left).toEqual([]);
  });

  test("a proxy another profile uses is skipped unless sharing is allowed (plan ruling 11)", async ({ page }) => {
    const off = await plan(page, ["a", "b"], ["x", "y"], false, { x: ["zz"] });
    expect(off.skippedShared).toEqual(["x"]);
    expect(off.pairs).toEqual([{ profileId: "a", proxyId: "y" }]);
    const inside = await plan(page, ["a", "b"], ["x", "y"], false, { x: ["a"] });
    expect(inside.skippedShared).toEqual([]);
    const on = await plan(page, ["a", "b"], ["x", "y"], true, { x: ["zz"] });
    expect(on.pairs.map((q) => q.proxyId)).toEqual(["x", "y"]);
  });

  test("No proxy goes to every profile", async ({ page }) => {
    const p = await plan(page, ["a", "b", "c"], [null], false);
    expect(p.pairs.map((q) => q.proxyId)).toEqual([null, null, null]);
  });
});

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const boundTo = (page: Page, id: string) => page.evaluate((i) => (window as unknown as { __shardxMock: { state: { profiles: Record<string, { _meta: { proxy_id: string | null } }> } } }).__shardxMock.state.profiles[i]._meta.proxy_id, id);
const bar = (page: Page) => page.getByRole("toolbar", { name: /selected/ });

test("from Profiles: the preview says who gets what, in list order (PC-032)", async ({ page }) => {
  await openApp(page);
  // Picked bottom-up; the plan still follows the list.
  for (const n of ["Sandbox", "Scraper pricing", "Etsy craft shop"]) await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
  await bar(page).getByRole("button", { name: /Assign proxies/ }).click();
  const dialog = page.getByRole("dialog", { name: /Assign proxies/ });
  await expect(dialog.locator("[data-assign-dialog]")).toHaveAttribute("data-from", "profiles");
  await expect(dialog.locator("[data-assign-preview]")).toHaveText("Choose proxies to assign.");
  await dialog.getByRole("option", { name: /^Old datacenter/ }).click();
  await expect(dialog.locator("[data-assign-preview]")).toHaveText("1 profile gets a proxy. This replaces the current proxy on 1. 2 stay as they are.");
  await dialog.getByRole("checkbox", { name: "Allow sharing" }).check();
  await expect(dialog.locator("[data-assign-preview]")).toHaveText("3 profiles share 1 proxy. This replaces the current proxy on 2.");
  await dialog.getByRole("checkbox", { name: "Allow sharing" }).uncheck();
  await dialog.getByRole("button", { name: "Assign 1" }).click();
  // Etsy craft shop comes first in the list.
  await expect.poll(() => boundTo(page, "aed41005")).toBe("px-dead");
  // The selection stays as it was (owner rule: bulk actions keep it).
  await expect(bar(page)).toContainText("3 selected");
});

test("a proxy in use elsewhere is hidden by Unused only, and named when shown", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='checkbox'] input").check({ force: true });
  await bar(page).getByRole("button", { name: /Change proxy/ }).click();
  const dialog = page.getByRole("dialog", { name: /Assign/ });
  await expect(dialog.getByRole("option", { name: /^New DC Warsaw/ })).toBeVisible();
  await expect(dialog.getByRole("option", { name: /^DC Tokyo/ })).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "Unused only" }).uncheck();
  await expect(dialog.getByRole("option", { name: /^DC Tokyo/ })).toContainText("Used by 1");
  await dialog.getByRole("option", { name: /^DC Tokyo/ }).click();
  await expect(dialog.locator("[data-assign-preview]")).toHaveText("No profile gets a proxy. 1 proxy is skipped: another profile uses it.");
  await expect(dialog.getByRole("button", { name: /^Assign \d+$/ })).toBeDisabled();
});

test("No proxy is a choice of its own, and clears the proxies", async ({ page }) => {
  await openApp(page);
  for (const n of ["Etsy craft shop", "Scraper pricing"]) await row(page, n).locator("[data-cell='checkbox'] input").check({ force: true });
  await bar(page).getByRole("button", { name: /Assign proxies/ }).click();
  const dialog = page.getByRole("dialog", { name: /Assign proxies/ });
  await dialog.getByRole("option", { name: /^Old datacenter/ }).click();
  await dialog.getByRole("option", { name: "No proxy" }).click();
  await expect(dialog.getByRole("option", { name: /^Old datacenter/ })).toHaveAttribute("aria-selected", "false");
  await expect(dialog.locator("[data-assign-preview]")).toHaveText("2 profiles will have no proxy. This removes the current proxy from 2.");
  await dialog.getByRole("button", { name: "Assign 2" }).click();
  await expect.poll(() => boundTo(page, "aed41005")).toBeNull();
  await expect.poll(() => boundTo(page, "e51f8c32")).toBeNull();
});

test("from Proxies: the same dialog, choosing profiles", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id='px-dead'] [data-cell='checkbox'] input").check({ force: true });
  await bar(page).getByRole("button", { name: /Assign to profiles/ }).click();
  const dialog = page.getByRole("dialog", { name: /Assign 1 proxy/ });
  await expect(dialog.locator("[data-assign-dialog]")).toHaveAttribute("data-from", "proxies");
  await expect(dialog.getByRole("checkbox", { name: "Allow sharing" })).not.toBeChecked();
  // Sandbox is the seed's one profile with No proxy, so the default scope lists it alone.
  await expect(dialog.getByRole("checkbox", { name: "Sandbox" })).toBeChecked();
  await dialog.getByRole("button", { name: "Assign 1" }).click();
  await expect.poll(() => boundTo(page, "f62a9d43")).toBe("px-dead");
  // The Proxies selection stays too.
  await expect(bar(page)).toContainText("1 selected");
});

// Pair 49 step 1: "All profiles" hands proxies to profiles that have one, so
// the preview counts the proxies it replaces (the old Distribute warning).
test("from Proxies with All profiles, the preview counts the proxies it replaces", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id='px-dead'] [data-cell='checkbox'] input").check({ force: true });
  await bar(page).getByRole("button", { name: /Assign to profiles/ }).click();
  const dialog = page.getByRole("dialog", { name: /Assign 1 proxy/ });
  const preview = dialog.locator("[data-assign-preview]");
  // Sandbox has no proxy: nothing is replaced, so that part stays out.
  await expect(preview).toHaveText("1 profile gets a proxy.");
  await dialog.getByRole("radio", { name: "All profiles" }).click();
  await dialog.getByRole("checkbox", { name: "Allow sharing" }).check();
  // All 8 share it; the 7 with a proxy of their own lose it.
  await expect(preview).toHaveText("8 profiles share 1 proxy. This replaces the current proxy on 7.");
});
