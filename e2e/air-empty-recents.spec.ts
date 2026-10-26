import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";

// Air and hierarchy, sections 4 and 5: the zero state's one action tile and the
// palette's Recent rows with where they live (light, the owner's shots).

test("Bookmarks zero state, light", { tag: "@visual" }, async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __shardxMockEmpty: true }));
  await openApp(page, { section: "bookmarks", theme: "light" });
  await expect(page.locator("main [data-empty-state]").getByRole("button", { name: "Add a bookmark" })).toBeVisible();
  await expect(page).toHaveScreenshot("empty-bookmarks-light.png");
});

test("palette with recents, light", { tag: "@visual" }, async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem("shardx.palette.recent", JSON.stringify({
      "proxy:px-de-1": { n: 4, last: now },
      "project:proj-pricing": { n: 3, last: now - 1000 },
      "profile:f62a9d43": { n: 2, last: now - 2000 },
      "cmd:nav.settings": { n: 1, last: now - 3000 },
    }));
  });
  await openApp(page, { theme: "light" });
  await page.keyboard.press("ControlOrMeta+k");
  const recent = page.getByRole("dialog", { name: "Command palette" }).getByRole("group", { name: "Recent" });
  await expect(recent.getByRole("option")).toHaveCount(4);
  await expect(page).toHaveScreenshot("palette-recents-light.png");
});
