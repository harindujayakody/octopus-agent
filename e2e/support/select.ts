import type { Locator, Page } from "@playwright/test";

/// Opens the Select named `field` inside `scope` and picks `option`. The kit
/// Select is a combobox; its options are `option`s (audit Phase C, Task 18).
export async function pickOption(scope: Page | Locator, field: string | RegExp, option: string | RegExp) {
  const page = "context" in scope ? scope : scope.page();
  await scope.getByRole("combobox", { name: field, exact: typeof field === "string" }).click();
  await page.getByRole("option", { name: option, exact: typeof option === "string" }).click();
}
