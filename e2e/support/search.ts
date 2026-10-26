import { expect, type Locator, type Page } from "@playwright/test";

/** The page header's search field (visible only while the search is open). */
export const searchField = (page: Page): Locator => page.locator("main header").getByRole("searchbox");

/** The search button the header shows while the field is folded (by its place, so any page's placeholder and language name it). */
export const searchButton = (page: Page): Locator => page.locator("main header [data-filter] button");

/**
 * Opens the page's search (a click on its button, unless the field is already
 * open, as it is while a query is set) and returns the focused field.
 */
export async function openSearch(page: Page): Promise<Locator> {
  const field = searchField(page);
  if (!(await field.isVisible())) await searchButton(page).click();
  await expect(field).toBeFocused();
  return field;
}
