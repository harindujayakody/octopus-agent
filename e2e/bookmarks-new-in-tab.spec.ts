import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// New bookmark, by the header's button and by C, starts in the tab's Folder:
// Ads on the Ads tab, every profile on All and Every profile. The tab's own
// id ("any", "folder:Ads") is never saved as the bookmark's folder.
type Bm = { url: string; folder: string };
type Mock = { __shardxMock: { state: { bookmarks: Bm[] } } };

const folderOf = (page: Page, url: string) =>
  page.evaluate((u) => (window as unknown as Mock).__shardxMock.state.bookmarks.find((b) => b.url === u)?.folder, url);

const TABS = [["Ads", "Ads", "Ads"], ["Every profile", "", "Every profile"], ["All", "", "Every profile"]] as const;

for (const [tab, folder, shown] of TABS) {
  for (const how of ["button", "C"] as const) {
    test(`New bookmark on the ${tab} tab (${how}) goes to ${shown}`, async ({ page }) => {
      await openApp(page, { section: "bookmarks" });
      await page.locator("main").getByRole("radio", { name: tab, exact: true }).click();
      if (how === "button") await page.locator("main header").getByRole("button", { name: "New bookmark" }).click();
      else await page.keyboard.press("c");
      const dialog = page.getByRole("dialog", { name: "New bookmark" });
      await expect(dialog.getByRole("combobox", { name: "Folder", exact: true })).toHaveText(shown);
      const url = `https://${how.toLowerCase()}-${tab.replace(/\W/g, "").toLowerCase()}.example/`;
      await dialog.getByRole("textbox", { name: "URL" }).fill(url);
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(await folderOf(page, url)).toBe(folder);
    });
  }
}
