import { expect, test, type Page } from "@playwright/test";
import { openApp, pressCreate, waitForIdle } from "./support/app";

// No path starts a profile on the user's own IP without the user seeing it
// (overview section 2, Safety; IFACE-01, IFACE-02, O9a).
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const proxyRow = (page: Page, name: string) => page.locator("[role='row'][data-proxy-id]", { hasText: name });
const peek = (page: Page) => page.locator("aside[data-peek]");
const noProxyCount = (page: Page) => page.locator("aside [data-view='builtin:no-proxy'] [data-count]");
type Launch = { id: string; proxy_id: string | null };
const launched = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __shardxMockLaunches?: Launch[] }).__shardxMockLaunches ?? []).map((l) => l.id));
const boundTo = (page: Page, profileId: string) =>
  page.evaluate((id) => (window as unknown as { __shardxMock: { state: { profiles: Record<string, { _meta: { proxy_id: string | null } }> } } }).__shardxMock.state.profiles[id]._meta.proxy_id, profileId);
// sync_launch starts processes directly in the mock, without the
// __shardxMockLaunches entries a plain launch gets, so a synced start is
// checked against the mock's own running table instead.
const isRunning = (page: Page, profileId: string) =>
  page.evaluate((id) => !!(window as unknown as { __shardxMock: { state: { running: Record<string, unknown> } } }).__shardxMock.state.running[id], profileId);
const failNext = (page: Page, cmds: Record<string, number>) =>
  page.evaluate((c) => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = c; }, cmds);

/** Deletes a proxy behind the app's back (the API, another window), then reloads the app on the same data. */
async function dropProxy(page: Page, id: string) {
  await page.evaluate(
    (id) => (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("proxy_delete", { id }),
    id,
  );
  await page.reload();
  await waitForIdle(page);
}

test("a profile whose proxy was deleted says so and counts as having no proxy", async ({ page }) => {
  await openApp(page);
  await expect(noProxyCount(page)).toHaveText("1");
  await dropProxy(page, "px-jp-1"); // FB Ads acc-02's proxy
  await expect(row(page, "FB Ads acc-02").locator("[data-cell='proxy']")).toHaveText("Proxy missing");
  await expect(noProxyCount(page)).toHaveText("2");
  await row(page, "FB Ads acc-02").locator("[data-cell='name']").click();
  // Task 14: Peek's Proxy row says it, and the header's status pill carries
  // the warning with what to do in its tooltip (one look for the state).
  await expect(peek(page).locator("[data-property='proxy'] button")).toContainText("Proxy missing");
  await expect(peek(page).locator("[data-peek-header] [data-pill='status']")).toHaveAttribute("data-state", "warning");
});

// Fix round 1, item 4: the detail under "Proxy missing" used to be a bare
// date, which reads as "when the proxy went missing" — it is actually the
// profile's last run, same as any idle row, so it needs the same wording.
test("the Status cell's detail says the last run, not a bare date", async ({ page }) => {
  await openApp(page);
  await dropProxy(page, "px-jp-1"); // FB Ads acc-02 has run before (launchedDaysAgo: 3)
  await expect(row(page, "FB Ads acc-02").locator("[data-cell='status'] .sr-only")).toContainText("Last run");
});

test("Start refuses a profile whose proxy was deleted and offers to assign one", async ({ page }) => {
  await openApp(page);
  await dropProxy(page, "px-jp-1");
  await row(page, "FB Ads acc-02").hover();
  await row(page, "FB Ads acc-02").getByRole("button", { name: "Start" }).click();
  const alert = page.locator("[data-toast]").filter({ hasText: "won’t start: its proxy was deleted" });
  await expect(alert).toBeVisible();
  await row(page, "FB Ads acc-02").hover();
  await expect(row(page, "FB Ads acc-02").getByRole("button", { name: "Start" })).toBeVisible();
  expect(await launched(page)).not.toContain("c31d92f1");
  await alert.getByRole("button", { name: "Assign a proxy" }).click();
  await expect(page.getByRole("dialog", { name: "Assign a proxy" })).toBeVisible();
});

// The list still holds the proxy (deleted behind its back, no reload), so the
// app's own check lets the start through; the backend refuses it, and the
// failure says why in words rather than the backend's.
test("a start the backend refuses because the proxy is gone says why", async ({ page }) => {
  await openApp(page);
  await page.evaluate(
    (id) => (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("proxy_delete", { id }),
    "px-jp-1",
  );
  await row(page, "FB Ads acc-02").hover();
  await row(page, "FB Ads acc-02").getByRole("button", { name: "Start" }).click();
  const failure = page.locator("[data-toast]").filter({ hasText: "Couldn’t start “FB Ads acc-02”" });
  await expect(failure).toContainText("Its proxy was deleted. Assign another proxy first.");
  await expect(failure).not.toContainText("no longer exists");
  expect(await launched(page)).not.toContain("c31d92f1");
  expect(await isRunning(page, "c31d92f1")).toBe(false);
});

test("bulk Start leaves out a profile whose proxy was deleted and starts the rest", async ({ page }) => {
  await openApp(page);
  await dropProxy(page, "px-jp-1");
  for (const name of ["FB Ads acc-02", "Etsy craft shop"]) {
    await row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
  }
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "Start" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "won’t start" })).toBeVisible();
  await expect.poll(() => launched(page)).toContain("aed41005");
  expect(await launched(page)).not.toContain("c31d92f1");
});

// Fix round 1, item 1 (critical): Launch synced skipped the guard entirely
// and sent a proxy-missing profile through sync_launch, onto this computer's
// own IP, alongside the rest of the fleet.
test("Launch synced drops a profile whose proxy was deleted and still starts the rest together", async ({ page }) => {
  await openApp(page);
  await dropProxy(page, "px-jp-1");
  for (const name of ["FB Ads acc-02", "Etsy craft shop", "FB Ads acc-01"]) {
    await row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
  }
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "More bulk actions" }).click();
  await page.getByRole("menuitem", { name: "Start in sync" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: "won’t start" })).toBeVisible();
  await expect(row(page, "Etsy craft shop").locator("[data-cell='status'] [data-status-label]")).toHaveText("Running", { timeout: 5000 });
  await expect(row(page, "FB Ads acc-01").locator("[data-cell='status'] [data-status-label]")).toHaveText("Running");
  await expect(row(page, "FB Ads acc-02").locator("[data-cell='status'] [data-status-label]")).toHaveText("Proxy missing");
});

// Task 11 fix round 1, item 1 (critical): Launch synced never asked O9a's
// question, so a no-proxy profile joined the fleet on this computer's real
// IP unasked, whatever the Settings switch said.
test("Launch synced asks before a no-proxy profile joins the fleet, and Cancel starts none of the group", async ({ page }) => {
  await openApp(page, { askDirect: true });
  for (const name of ["Sandbox", "Etsy craft shop"]) {
    await row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
  }
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "More bulk actions" }).click();
  await page.getByRole("menuitem", { name: "Start in sync" }).click();
  const dialog = page.getByRole("dialog", { name: "1 of these profiles has no proxy" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(await isRunning(page, "f62a9d43")).toBe(false); // Sandbox: no proxy
  expect(await isRunning(page, "aed41005")).toBe(false); // Etsy craft shop: proxied, but the group didn't split
});

test("with the direct-start preference off, Launch synced asks nothing", async ({ page }) => {
  await openApp(page); // askDirect defaults false: the preference is off
  for (const name of ["Sandbox", "Etsy craft shop"]) {
    await row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
  }
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "More bulk actions" }).click();
  await page.getByRole("menuitem", { name: "Start in sync" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => isRunning(page, "f62a9d43")).toBe(true);
  await expect.poll(() => isRunning(page, "aed41005")).toBe(true);
});

// Fix round 1, item 5: the Proxies side's own "no proxy" scope used
// `!p.proxy_id` and left out a profile bound to a proxy that was deleted —
// the same rule everywhere else in the app now says has no proxy.
test("Assign to profiles' \"No proxy\" includes a profile whose proxy was deleted", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await dropProxy(page, "px-jp-1"); // FB Ads acc-02's proxy
  await proxyRow(page, "Old datacenter").locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("button", { name: "Assign to profiles", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Assign 1 proxy" });
  await expect(dialog).toBeVisible();
  // "No proxy" (the default scope): includes the now-dangling one, and Sandbox.
  await expect(dialog.getByRole("checkbox", { name: "FB Ads acc-02" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Sandbox" })).toBeChecked();
  await expect(dialog.locator("[data-assign-preview]")).toHaveText("1 profile gets a proxy. 1 stays as it is.");
});

// Task 9 (A4), on Undo since F37 (ruling 18, plan ruling 9): a proxy delete's
// toast says who loses it and offers replacements.
const undoToast = (page: Page) => page.locator("[data-toast]").filter({ has: page.getByRole("button", { name: "Undo" }) });

test("deleting a proxy in use names it and the profiles that lose it, and can assign replacements", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await proxyRow(page, "DC Tokyo").click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
  const toast = undoToast(page);
  await expect(toast).toContainText("Deleted “DC Tokyo”");
  await expect(toast).toContainText("1 profile loses it.");
  await toast.getByRole("button", { name: "Assign replacements" }).click();
  const assign = page.getByRole("dialog", { name: "Assign a proxy" });
  await expect(assign).toBeVisible();
  await expect(proxyRow(page, "DC Tokyo")).toHaveCount(0);
  // An unused proxy: one in use elsewhere would need Allow sharing (F12).
  await assign.getByRole("option", { name: /^New DC Warsaw/ }).click();
  await assign.getByRole("button", { name: "Assign 1" }).click();
  await expect.poll(() => boundTo(page, "c31d92f1")).toBe("px-new");
});

test("deleting a proxy nobody uses offers no replacements", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await proxyRow(page, "Old datacenter").click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
  const toast = undoToast(page);
  await expect(toast).toHaveText(/Deleted “Old datacenter \(expired\)”/);
  await expect(toast).not.toContainText("loses it");
  await expect(toast.getByRole("button", { name: "Assign replacements" })).toHaveCount(0);
  await expect(proxyRow(page, "Old datacenter")).toHaveCount(0);
});

test("deleting several proxies counts them and the profiles that use them", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  for (const name of ["DC Tokyo", "DC New York"]) {
    await proxyRow(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
  }
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: /^Delete/ }).click();
  const toast = undoToast(page);
  await expect(toast).toContainText("Deleted 2 proxies");
  await expect(toast).toContainText("3 profiles lose it.");
});

// Task 14 (A5), carried from the Task 9 review: a bulk delete-and-assign
// with one of the two deletes failing must hand replacements only to the
// profile whose proxy really went (DC Tokyo's one user, FB Ads acc-02) —
// not to every profile the two proxies served (3, which would show "Assign
// proxies to 3 profiles").
test("bulk delete-and-assign hands over only the profiles whose proxy was really deleted", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  for (const name of ["DC Tokyo", "DC New York"]) {
    await proxyRow(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
  }
  await failNext(page, { proxy_delete: 1 });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: /^Delete/ }).click();
  await undoToast(page).getByRole("button", { name: "Assign replacements" }).click();
  // The one that failed is named and comes back.
  await expect(page.locator("[data-toast]").filter({ hasText: "Couldn’t delete “DC New York”" })).toContainText("Mock failure: proxy_delete");
  await expect(proxyRow(page, "DC New York")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Assign a proxy" })).toBeVisible();
});

// Task 11 (A4/O9a): starting a profile with no proxy bound asks first while
// proxies exist elsewhere, with a Settings switch to turn the question off.
test("starting a profile without a proxy while proxies exist asks first", async ({ page }) => {
  await openApp(page, { askDirect: true });
  await row(page, "Sandbox").hover();
  await row(page, "Sandbox").getByRole("button", { name: "Start" }).click();
  const dialog = page.getByRole("dialog", { name: 'Start “Sandbox” without a proxy?' });
  await expect(dialog).toContainText("It connects with this computer’s IP");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(await launched(page)).not.toContain("f62a9d43");
  await row(page, "Sandbox").hover();
  await row(page, "Sandbox").getByRole("button", { name: "Start" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start anyway" }).click();
  await expect.poll(() => launched(page)).toContain("f62a9d43");
});

test("Assign a proxy in the question opens Assign proxies for that profile", async ({ page }) => {
  await openApp(page, { askDirect: true });
  await row(page, "Sandbox").hover();
  await row(page, "Sandbox").getByRole("button", { name: "Start" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Assign a proxy" }).click();
  await expect(page.getByRole("dialog", { name: "Assign a proxy" })).toBeVisible();
  expect(await launched(page)).not.toContain("f62a9d43");
});

test("the Settings switch stops the question", async ({ page }) => {
  await openApp(page, { askDirect: true, section: "settings" });
  await page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name: "Profile defaults" }).click();
  await page.getByRole("switch", { name: "Ask before starting a profile without a proxy" }).uncheck();
  await page.locator("[data-save-bar]").getByRole("button", { name: "Save", exact: true }).click();
  await page.locator("aside [data-nav='profiles']").click();
  await row(page, "Sandbox").hover();
  await row(page, "Sandbox").getByRole("button", { name: "Start" }).click();
  await expect.poll(() => launched(page)).toContain("f62a9d43");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("no question when there are no proxies at all", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockEmpty: boolean }).__shardxMockEmpty = true; });
  await openApp(page, { askDirect: true });
  await page.locator("main [data-empty-state]").getByRole("button", { name: "New profile" }).click();
  await pressCreate(page);
  const first = page.locator("[role='row'][data-profile-id]").first();
  await first.hover();
  await first.getByRole("button", { name: "Start" }).click();
  await expect.poll(async () => (await launched(page)).length).toBe(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("bulk Start asks once and can skip the profiles without a proxy", async ({ page }) => {
  await openApp(page, { askDirect: true });
  for (const name of ["Sandbox", "Etsy craft shop"]) {
    await row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
  }
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "Start" }).click();
  const dialog = page.getByRole("dialog", { name: "1 of these profiles has no proxy" });
  await dialog.getByRole("button", { name: "Skip those" }).click();
  await expect.poll(() => launched(page)).toContain("aed41005");
  expect(await launched(page)).not.toContain("f62a9d43");
});

// Task 11 fix round 1, item 2 (important): with exactly one no-proxy profile
// left to start, bulk Start's dialog offers "Assign a proxy" like the
// single-row question does, but choosing it did nothing.
test("bulk Start's Assign a proxy opens Assign proxies when only one profile is left to start", async ({ page }) => {
  await openApp(page, { askDirect: true });
  await row(page, "Sandbox").locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "Start" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Assign a proxy" }).click();
  await expect(page.getByRole("dialog", { name: "Assign a proxy" })).toBeVisible();
  expect(await launched(page)).not.toContain("f62a9d43");
});
