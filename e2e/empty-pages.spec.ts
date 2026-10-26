import { expect, test, type Page } from "@playwright/test";
import { openApp, reloadApp } from "./support/app";
import { openSearch } from "./support/search";

// Clarity fixes, item 17: every first-run page is the same empty page. The
// kit EmptyState sits inside the page's list card, with an icon, a visible
// title, one hint line and the page's main action as a filled primary button.
// Bookmarks sat in a card and Extensions on the bare page, with tiles of
// different fills. (The modules' empty state is in the Modules dialog, not on
// a page: automation-list.spec.ts covers it.)

type Mock = { __shardxMock: { state: { automation: unknown[]; modules: unknown[] }; save: () => void } };

const mockKnobs = (page: Page, knobs: Record<string, unknown>) => page.addInitScript((k) => { Object.assign(window, k); }, knobs);

type Case = { name: string; title: string; action: string | null; open: (page: Page) => Promise<void> };

const fresh = (section: string) => async (page: Page) => {
  await mockKnobs(page, { __shardxMockEmpty: true });
  await page.addInitScript(() => localStorage.setItem("shardx.onboarding", JSON.stringify({ version: 2, state: "done", welcomeDone: true, tour: "done", pagesSeen: [], tipsOff: true })));
  await openApp(page, { section });
};
const noAutomation = async (page: Page) => {
  await openApp(page, { section: "automation" });
  await page.evaluate(() => {
    const m = (window as unknown as Mock).__shardxMock;
    m.state.automation.length = 0;
    m.state.modules.length = 0;
    m.save();
  });
  await reloadApp(page);
};

const CASES: Case[] = [
  { name: "Profiles", title: "No profiles yet", action: "New profile", open: fresh("profiles") },
  { name: "Proxies", title: "No proxies yet", action: "Add proxies", open: fresh("proxies") },
  { name: "Extensions", title: "No extensions yet", action: "Add an extension", open: fresh("extensions") },
  { name: "Bookmarks", title: "No bookmarks yet", action: "Add a bookmark", open: fresh("bookmarks") },
  {
    name: "Fingerprints", title: "No fingerprints yet", action: "Import a fingerprint",
    open: async (page) => { await mockKnobs(page, { __shardxMockNoFingerprints: true }); await openApp(page, { section: "fingerprints" }); },
  },
  { name: "Projects", title: "No projects yet", action: "New project", open: noAutomation },
  { name: "Trash", title: "Trash is empty", action: null, open: fresh("trash") },
];

/** What the empty page is made of, read off the real elements. */
async function measure(page: Page, c: Case) {
  const empty = page.locator("main [data-empty-state]");
  await expect(empty, c.name).toBeVisible();
  await expect(empty.getByRole("heading", { name: c.title }), c.name).toBeVisible();
  // Inside the list's card, never on the bare page.
  const card = empty.locator("xpath=ancestor::*[@data-list-tile][1]");
  await expect(card, `${c.name}: sits in a list card`).toHaveCount(1);
  return empty.evaluate((el, action) => {
    const card = el.closest("[data-list-tile]")!;
    const r = el.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const icon = el.firstElementChild as HTMLElement;
    const heading = el.querySelector("h2")!;
    const button = action ? [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === action) ?? null : null;
    const bb = button?.getBoundingClientRect();
    return {
      inside: r.left >= cr.left - 0.5 && r.right <= cr.right + 0.5 && r.top >= cr.top - 0.5 && r.bottom <= cr.bottom + 0.5,
      cardFill: getComputedStyle(card).backgroundColor,
      iconSize: `${Math.round(icon.getBoundingClientRect().width)}x${Math.round(icon.getBoundingClientRect().height)}`,
      iconFill: getComputedStyle(icon).backgroundColor,
      titleSize: getComputedStyle(heading).fontSize,
      titleSeen: heading.getBoundingClientRect().height > 1,
      hints: el.querySelectorAll(":scope > p").length,
      button: button ? { classes: [...button.classList].sort().join(" "), height: Math.round(bb!.height) } : null,
    };
  }, c.action);
}

test("every empty page sits in its list card, with the same icon, title, hint and button", async ({ page }) => {
  test.slow(); // opens every empty page in turn
  const seen: Record<string, Awaited<ReturnType<typeof measure>>> = {};
  for (const c of CASES) {
    await c.open(page);
    seen[c.name] = await measure(page, c);
    const m = seen[c.name];
    expect(m.inside, `${c.name}: inside the card`).toBe(true);
    expect(m.titleSeen, `${c.name}: the title is visible`).toBe(true);
    expect(m.iconSize, `${c.name}: icon tile`).toBe("48x48");
    expect(m.hints, `${c.name}: one hint line`).toBe(1);
    if (c.action) {
      expect(m.button, `${c.name}: has ${c.action}`).not.toBeNull();
      // The page's main action is the filled primary button.
      expect(m.button!.classes, c.name).toContain("bg-primary-base");
    }
  }
  const all = Object.entries(seen);
  const [firstName, first] = all[0];
  for (const [name, m] of all) {
    expect(m.cardFill, `${name} card fill = ${firstName}`).toBe(first.cardFill);
    expect(m.iconFill, `${name} icon fill = ${firstName}`).toBe(first.iconFill);
    expect(m.titleSize, `${name} title size = ${firstName}`).toBe(first.titleSize);
    if (m.button && first.button) {
      expect(m.button.classes, `${name} button classes = ${firstName}`).toBe(first.button.classes);
      expect(m.button.height, `${name} button height = ${firstName}`).toBe(first.button.height);
    }
  }
});

test("the main action of an empty page works", async ({ page }) => {
  await fresh("bookmarks")(page);
  await page.locator("main [data-empty-state]").getByRole("button", { name: "Add a bookmark" }).click();
  await expect(page.getByRole("dialog", { name: "New bookmark" })).toBeVisible();
});

test("a search that finds nothing keeps its own icon, title and Clear button", async ({ page }) => {
  await openApp(page, { section: "extensions" });
  await (await openSearch(page)).fill("zzzz");
  const empty = page.locator("main [data-empty-state]");
  await expect(empty.getByRole("heading", { name: /zzzz/ })).toBeVisible();
  await expect(empty.getByRole("button", { name: "Clear search" })).toBeVisible();
  await expect(empty.locator("xpath=ancestor::*[@data-list-tile][1]")).toHaveCount(1);
  // The Clear button is the stroke one, not the primary action.
  await expect(empty.getByRole("button", { name: "Clear search" })).not.toHaveClass(/bg-primary-base/);
});
