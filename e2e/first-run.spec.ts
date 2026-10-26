import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";

test("after the first-run download, the Template row lists the fingerprint library", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __shardxMockEngine: string }).__shardxMockEngine = "missing";
  });
  await openApp(page);
  // New profile opens the form (nothing exists until Create profile); its
  // Fingerprint tab picks the template from the library.
  await page.getByRole("button", { name: "New profile" }).click();
  const form = page.getByRole("dialog", { name: "New profile", exact: true });
  await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue(/./);
  await form.getByRole("tab", { name: "Fingerprint" }).click();
  await form.getByRole("combobox", { name: "Fingerprint", exact: true }).click();
  await expect(page.getByRole("option", { name: /^macOS 14, Apple M1/ })).toBeVisible();
});
