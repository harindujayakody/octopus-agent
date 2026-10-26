import type { Page } from "@playwright/test";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/// The Profiles Filters menu (F19): opens it, picks a field, then a value
/// (its name starts with the value's words; the count follows). Picking the
/// value already applied takes it off. The menu closes on the pick.
export async function filterBy(page: Page, field: string, value: string | RegExp) {
  await page.locator("main header").getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("option", { name: new RegExp(`^${escape(field)}`) }).click();
  await page.getByRole("option", { name: typeof value === "string" ? new RegExp(`^${escape(value)}`) : value }).click();
}

/// Takes one applied filter off by its chip (`status`, `proxy`, `tag`, `lastRun`, `country`).
export async function unfilter(page: Page, field: string) {
  await page.locator(`[data-filter-chips] [data-chip='${field}']`).getByRole("button").click();
}
