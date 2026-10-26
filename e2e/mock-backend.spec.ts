import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// The dev mock must show the states the real backend produces, or the tests
// cannot see them (overview A3, "mock divergence").
type Internals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>; transformCallback: (cb: (e: { payload: unknown }) => void) => number };
type Mock = { state: Record<string, any> };
const invoke = (page: Page, cmd: string, args: Record<string, unknown> = {}) =>
  page.evaluate(([cmd, args]) => (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__.invoke(cmd as string, args as Record<string, unknown>), [cmd, args] as const);
const state = (page: Page) => page.evaluate(() => (window as unknown as { __shardxMock: Mock }).__shardxMock.state);

test("deleting a proxy leaves its profiles bound to the missing id, as the backend does", async ({ page }) => {
  await openApp(page);
  await invoke(page, "proxy_delete", { id: "px-jp-1" });
  const s = await state(page);
  expect(s.proxies.some((p: { id: string }) => p.id === "px-jp-1")).toBe(false);
  expect(s.profiles["c31d92f1"]._meta.proxy_id).toBe("px-jp-1");
});

test("the Trash keeps a profile seven days, as the backend does", async ({ page }) => {
  await openApp(page);
  await invoke(page, "profile_delete", { id: "f62a9d43" });
  const s = await state(page);
  const entry = s.trash.find((t: { id: string }) => t.id === "f62a9d43");
  expect(entry.expires_at - entry.deleted_at).toBe(7 * 86400);
  for (const t of s.trash) expect(t.expires_at - t.deleted_at).toBeLessThanOrEqual(7 * 86400);
});

test("store-changed carries the topic as a plain string, as the backend does", async ({ page }) => {
  await openApp(page);
  const seen = await page.evaluate(async () => {
    const w = window as unknown as { __TAURI_INTERNALS__: Internals; __seen: unknown[] };
    w.__seen = [];
    const id = w.__TAURI_INTERNALS__.transformCallback((e) => { w.__seen.push(e.payload); });
    await w.__TAURI_INTERNALS__.invoke("plugin:event|listen", { event: "store-changed", handler: id });
    await w.__TAURI_INTERNALS__.invoke("extension_delete", { id: "ublock" });
    return w.__seen;
  });
  expect(seen).toContain("extensions");
});

test("the fixtures hold no live-looking secrets or addresses", async ({ page }) => {
  await openApp(page);
  const s = await state(page);
  expect(s.api.token).toMatch(/^shx_mock_/);
  for (const p of s.proxies) {
    expect(p.host).toMatch(/\.example$|^(203\.0\.113|198\.51\.100|192\.0\.2)\./);
    if (p.password) expect(p.password).toMatch(/^mock-pass-/);
  }
});

test("profile commands from the app announce no store change, and a clone is named as the backend names it", async ({ page }) => {
  await openApp(page);
  const heard = await page.evaluate(async () => {
    const w = window as unknown as { __TAURI_INTERNALS__: Internals };
    let n = 0;
    const handler = w.__TAURI_INTERNALS__.transformCallback(() => { n++; });
    await w.__TAURI_INTERNALS__.invoke("plugin:event|listen", { event: "store-changed", handler });
    const copy = (await w.__TAURI_INTERNALS__.invoke("profile_clone", { id: "f62a9d43" })) as { id: string; name: string };
    await w.__TAURI_INTERNALS__.invoke("profile_delete", { id: copy.id });
    await w.__TAURI_INTERNALS__.invoke("trash_restore", { id: copy.id });
    await w.__TAURI_INTERNALS__.invoke("profile_import", { payloads: [{ name: "Imported" }] });
    await new Promise((r) => setTimeout(r, 300));
    return { n, name: copy.name };
  });
  // The backend announces only writes through its HTTP API (src-tauri/src/api.rs).
  expect(heard).toEqual({ n: 0, name: "Sandbox (copy)" });
});
