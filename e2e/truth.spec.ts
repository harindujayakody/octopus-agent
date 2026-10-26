import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle } from "./support/app";

// What is shown is true (overview A8): no made-up counts, no "Select…" for a
// value that is set, no bare "26d".
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });

test("while the list failed to load, the sidebar shows no counts", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = { profile_list: 1 }; });
  await openApp(page);
  await expect(page.getByText("Couldn’t load profiles")).toBeVisible();
  await expect(page.locator("aside [data-nav='profiles'] [data-total]")).toHaveCount(0);
  // The running count lives in the Running View's count and beside All
  // Profiles (owner). The default fixtures seed 2 profiles already running,
  // so the poll (independent of `profile_list`) reports running > 0 here even
  // though the list failed to load — the exact gap this asserts against.
  await expect(page.locator("aside [data-view] [data-count]")).toHaveCount(0);
  await expect(page.locator("aside [data-nav='profiles'] [data-running]")).toHaveCount(0);
  await page.locator("aside [data-nav='profiles']").hover();
  // The trigger names its tooltip through aria-describedby only once it is
  // open; no wait tied to the hover delay.
  await expect(page.locator("aside [data-nav='profiles']")).not.toHaveAttribute("aria-describedby", /.+/);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator("aside [data-nav='profiles'] [data-total]")).toHaveText("8");
  await expect(page.locator("aside [data-view='builtin:no-proxy'] [data-count]")).toHaveText("1");
});

test("a screen size larger than this screen is shown, not Select…", async ({ page }) => {
  await openApp(page);
  // Amazon US seller has a 2560 x 1440 Windows fingerprint; the test window is 1280 x 800.
  await row(page, "Amazon US seller").locator("[data-cell='name']").click();
  // Peek's Screen row shows the size as the profile form's select does.
  const size = page.locator("aside[data-peek] [data-property='screen']");
  await expect(size).toContainText("2560 × 1440, larger than this screen");
  await expect(size).not.toContainText("Select");
});

test("the Trash says how many days are left, in words", async ({ page }) => {
  await openApp(page, { section: "trash" });
  await expect(page.getByText("3 days left")).toBeVisible();
  await expect(page.getByText("1 day left")).toBeVisible();
});

// Fix round 1: the last-day badge (`left === 0`, "Last day" / its zh form) is the reason the Deleted column was widened, but no
// default fixture reaches it — a test-only seed pushes one Trash item's
// `expires_at` to right now (the frozen clock), which `daysUntil` reads as 0
// days left, without touching the default fixtures (no screenshot moves).
async function trashItemExpiresToday(page: Page) {
  await page.evaluate(() => {
    const m = (window as unknown as {
      __shardxMock: { state: { trash: { expires_at: number }[] }; save: () => void };
    }).__shardxMock;
    m.state.trash[0].expires_at = Math.floor(Date.now() / 1000);
    m.save();
  });
  await page.reload();
  await waitForIdle(page);
}

// The check that would catch the badge cut (its word's own scrollWidth) or
// spilling into the Size column next to it (its right edge outside its
// Time left cell). The Trash is a DataList since F25a: the badge has its
// own column, whose floor is that column's track.
async function expectBadgeFits(page: Page, text: string) {
  const word = page.getByText(text, { exact: true });
  await expect(word).toBeVisible();
  expect(await word.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const badge = word.locator("xpath=..");
  const cell = word.locator("xpath=ancestor::*[@data-cell='left'][1]");
  const badgeBox = await badge.boundingBox();
  const cellBox = await cell.boundingBox();
  expect(badgeBox).not.toBeNull();
  expect(cellBox).not.toBeNull();
  expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(cellBox!.x + cellBox!.width + 0.5);
  // Never over the neighbour: the badge ends at or left of the Size cell.
  const sizeBox = await cell.locator("xpath=following-sibling::*[@data-cell='size'][1]").boundingBox();
  expect(sizeBox).not.toBeNull();
  expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(sizeBox!.x + 0.5);
}

test("the Trash's longest countdown badge stays fully visible", async ({ page }) => {
  await openApp(page, { section: "trash" });
  await trashItemExpiresToday(page);
  await expectBadgeFits(page, "Last day");
});

test("in Chinese, the Trash's longest countdown badge stays fully visible", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
  await openApp(page, { section: "trash" });
  await trashItemExpiresToday(page);
  await expectBadgeFits(page, "最后一天");
});

test.describe("at the minimum window size", () => {
  test.use({ viewport: { width: 1024, height: 680 } });

  test("the Trash's longest countdown badge stays fully visible", async ({ page }) => {
    await openApp(page, { section: "trash" });
    await trashItemExpiresToday(page);
    await expectBadgeFits(page, "Last day");
  });

  test("in Chinese, the Trash's longest countdown badge stays fully visible", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
    await openApp(page, { section: "trash" });
    await trashItemExpiresToday(page);
    await expectBadgeFits(page, "最后一天");
  });
});
