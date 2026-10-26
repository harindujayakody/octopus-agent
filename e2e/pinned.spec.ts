import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";
import { openSearch } from "./support/search";

const pinned = (page: Page, id: string) => page.locator(`aside [data-pinned='${id}']`);
const running = (page: Page) => page.evaluate(() => Object.keys((window as unknown as { __shardxMock: { state: { running: Record<string, unknown> } } }).__shardxMock.state.running));

test("the sidebar lists pinned profiles with their status", async ({ page }) => {
  await openApp(page);
  await expect(pinned(page, "a78a0eea")).toContainText("Amazon US seller");
  await expect(pinned(page, "a78a0eea").locator("[data-running]")).toHaveCount(1);
  await expect(pinned(page, "c31d92f0")).toContainText("FB Ads acc-01");
  await expect(pinned(page, "c31d92f0").locator("[data-running]")).toHaveCount(0);
  // Owner fix 2: a pin glyph, not the old bordered first-letter tile — the
  // icon slot (NavItem's leading span) now holds only the pin svg, no text.
  const icon = pinned(page, "a78a0eea").locator("button").first().locator(":scope > span").first();
  await expect(icon.locator("svg[data-icon='pin']")).toHaveCount(1);
  await expect(icon).toHaveText("");
});

// 6.2 (EMIL O-1): a click shows; the play button that shows on hover starts.
test("the play button on an idle pinned profile starts it", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await pinned(page, "c31d92f0").hover();
  await pinned(page, "c31d92f0").locator("[data-pinned-action]").getByRole("button", { name: "Start FB Ads acc-01" }).click();
  await expect(pinned(page, "c31d92f0").locator("[data-running]")).toHaveCount(1, { timeout: 500 });
  await expect.poll(() => running(page)).toContain("c31d92f0");
});

test("clicking a running pinned profile shows it in the list instead of starting it again", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const before = await running(page);
  await pinned(page, "a78a0eea").click();
  await expect(page.locator("main[data-section='profiles']")).toBeVisible();
  const active = page.locator("[role='row'][data-active]");
  await expect(active).toContainText("Amazon US seller");
  await expect(active).toBeFocused();
  expect(await running(page)).toEqual(before);
});

test("pinning from the row menu adds the profile; Unpin removes it", async ({ page }) => {
  await openApp(page);
  await page.locator("[role='row'][data-profile-id='f62a9d43']").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin" }).click();
  await expect(pinned(page, "f62a9d43")).toBeVisible();
  await pinned(page, "f62a9d43").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Unpin" }).click();
  await expect(pinned(page, "f62a9d43")).toHaveCount(0);
});

test("showing a running pinned profile clears a search that hides it", async ({ page }) => {
  await openApp(page);
  await (await openSearch(page)).fill("Sandbox");
  await pinned(page, "a78a0eea").click();
  const active = page.locator("[role='row'][data-active]");
  await expect(active).toContainText("Amazon US seller");
  await expect(active).toBeFocused();
  await expect(page.getByRole("searchbox", { name: "Search…" })).toHaveValue("");
});


// The owner removed the pinned row tint (2026-10-01): a pinned row draws
// like any other row, at rest and as the target, its pinned cells too; a
// selection still fills it.
test("a pinned row has no fill", async ({ page }) => {
  await openApp(page, { theme: "light" });
  const r = page.locator("[role='row'][data-profile-id='a78a0eea']");
  const plain = page.locator("[role='row'][data-profile-id='f62a9d43']");
  // The row's own fill and its pinned cells' opaque layers.
  const look = (l: typeof r) => l.evaluate((el) => {
    const layers = [".list-pin-check", ".list-pin-end"].map((s) => getComputedStyle(el.querySelector(s)!, "::before").backgroundImage);
    return [getComputedStyle(el).backgroundColor, getComputedStyle(el).backgroundImage, ...layers].join(" | ");
  });
  const fill = (l: typeof r) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await look(r)).toBe(await look(plain));
  expect(await fill(r)).toBe("rgba(0, 0, 0, 0)");
  // As the target (the pointer moves onto it), the same fill as an unpinned target.
  await plain.hover();
  await expect(plain).toHaveAttribute("data-active", "true");
  const plainTarget = await look(plain);
  await r.hover();
  await expect(r).toHaveAttribute("data-active", "true");
  expect(await look(r)).toBe(plainTarget);
  // A selection still fills it.
  await r.locator("[data-cell='checkbox'] input").check();
  await page.mouse.move(0, 0);
  await expect(r).toHaveAttribute("aria-selected", "true");
  const selected = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--bg-row-selected)";
    document.body.append(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  });
  // The checked fill lies over the panel's white (the kit's row-fill-selected),
  // as one opaque color (owner, 2026-10-07, item 20).
  await expect.poll(() => r.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(selected);
});
