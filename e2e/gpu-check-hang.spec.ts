import { expect, test, type Page } from "@playwright/test";
import { openApp, row } from "./support/app";

/// The engine's GPU check that never answers (a VPS without a display, a
/// wedged engine): New profile must not wait on it (user report, launcher 2.1.0).

const hang = (page: Page) => page.addInitScript(() => {
  (window as unknown as { __shardxMockGpuCapsHang: boolean }).__shardxMockGpuCapsHang = true;
});
const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as unknown as { __shardxMock: { calls: Record<string, number> } }).__shardxMock.calls[c] ?? 0, cmd);
const count = (page: Page) => page.evaluate(() => (window as unknown as { __shardxMock: { state: { order: string[] } } }).__shardxMock.state.order.length);

test("New profile opens within 2 s while the GPU check hangs, and Create works", async ({ page }) => {
  await hang(page);
  await openApp(page);
  const before = await count(page);
  await page.getByRole("button", { name: "New profile" }).first().click();
  const d = page.getByRole("dialog", { name: "New profile", exact: true });
  const name = d.getByRole("textbox", { name: "Name" });
  await expect(name).toHaveValue(/^Profile \d+$/, { timeout: 2000 });
  // The check was asked and is still out: the form did not wait for it.
  expect(await calls(page, "gpu_caps_compat")).toBeGreaterThan(0);
  await name.fill("No GPU check");
  await d.getByRole("button", { name: "Create profile" }).click();
  await expect(d).toHaveCount(0);
  await expect(row(page, "No GPU check")).toHaveCount(1);
  expect(await count(page)).toBe(before + 1);
});

test("New profile with this fingerprint opens within 2 s while the GPU check hangs", async ({ page }) => {
  await hang(page);
  await openApp(page, { section: "fingerprints" });
  await page.locator("[data-fingerprint-id]", { hasText: "Windows 11, NVIDIA RTX 3060" }).click();
  await page.locator("aside[data-peek='fingerprint']").getByRole("button", { name: "New profile with this fingerprint" }).click();
  const d = page.getByRole("dialog", { name: "New profile", exact: true });
  await expect(d.getByRole("textbox", { name: "Name" })).toHaveValue(/^Profile \d+$/, { timeout: 2000 });
});
