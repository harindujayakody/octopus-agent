import { expect, test } from "@playwright/test";
import { openApp, SECTIONS } from "./support/app";

// One screenshot per page and theme. A diff here that the current task did not
// intend is a regression; update baselines only for intended changes, with
// `PW_VISUAL=1 npx playwright test e2e/pages.spec.ts --update-snapshots`
// (PW_VISUAL=1 while the visual hold in playwright.config.ts lasts).
for (const theme of ["dark", "light"] as const) {
  for (const section of SECTIONS) {
    test(`${section} page, ${theme}`, { tag: "@visual" }, async ({ page }) => {
      await openApp(page, { section, theme });
      await expect(page.locator(`main[data-section='${section}']`)).toBeVisible();
      await expect(page).toHaveScreenshot(`${section}-${theme}.png`);
    });
  }
}
