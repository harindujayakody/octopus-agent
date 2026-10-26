import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";

test("Esc with a tooltip open hides the tooltip first, then closes Peek", async ({ page }) => {
  await openApp(page);
  await page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='status']").click();
  const peek = page.locator("aside[data-peek]");
  if ((await peek.count()) === 0) await page.keyboard.press("Enter");
  await expect(peek).toBeVisible();
  const close = peek.getByRole("button", { name: "Close Peek" });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(peek).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(peek).toHaveCount(0);
});
