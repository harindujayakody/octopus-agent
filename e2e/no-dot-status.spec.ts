import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle } from "./support/app";

// Task 5f, the owner's rule: "never use only dot statuses: a user who
// doesn't see colors, or doesn't understand what a dot means, doesn't
// understand it." Every status is a word; a dot may stay next to its word,
// `aria-hidden`, decoration only. Task 5d already covers the Profiles row's
// own Status column (see e2e/profile-status.spec.ts) — this file covers the
// rest of the inventory plus a generic guard against a regression.

const proxyRow = (page: Page, name: string) => page.locator("[role='row'][data-proxy-id]", { hasText: name });
const profileRow = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const pinned = (page: Page, id: string) => page.locator(`aside [data-pinned='${id}']`);
const palette = (page: Page) => page.getByRole("dialog", { name: "Command palette" });
const search = (page: Page) => palette(page).getByRole("combobox", { name: "Search commands" });

test("Proxies: no status columnheader without text; the Test result carries the word", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const headers = page.getByRole("row").first().getByRole("columnheader");
  const n = await headers.count();
  for (let i = 0; i < n; i++) {
    const cell = headers.nth(i);
    const text = (await cell.textContent())?.trim();
    // The checkbox and actions columns are legitimately unlabeled visually
    // (a control fills them), but neither claims to be "Status" any more —
    // the separate status-dot column is gone.
    if (!text) expect(await cell.getAttribute("aria-label")).not.toBe("Status");
  }
  await expect(proxyRow(page, "Old datacenter").locator("[data-cell='test'] [data-status-label]")).toHaveText("Failed");
});

test("Sidebar: the running count is in words; pinned rows say Running only when running", async ({ page }) => {
  await openApp(page);
  // The mock's default seed has two profiles running (Amazon US seller, eBay DE buyer).
  // The Running View's count sits beside its word. All profiles' count reads
  // "2/8" (owner, 2026-09-30), and its name says it in words.
  const runningView = page.locator("aside [data-view='builtin:running']");
  await expect(runningView).toContainText("Running");
  await expect(runningView.locator("[data-count]")).toHaveText("2");
  await expect(page.locator("aside [data-nav='profiles'] [data-running-of]")).toHaveText("2/8");
  await expect(page.locator("aside [data-nav='profiles']")).toHaveAccessibleName(/8 profiles, 2 running/);
  await expect(pinned(page, "a78a0eea")).toContainText("Running"); // Amazon US seller: running
  await expect(pinned(page, "c31d92f0")).not.toContainText("Running"); // FB Ads acc-01: stopped
});

test("Sidebar footer shows the API word", async ({ page }) => {
  await openApp(page);
  // The mock's default settings have the API enabled.
  await expect(page.locator("aside").getByText("API on", { exact: true })).toBeVisible();
});

test("Peek of a running profile shows Running", async ({ page }) => {
  await openApp(page);
  await profileRow(page, "Amazon US seller").locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek]")).toContainText("Running");
});

test("ProxyPeek of the failed proxy shows Failed", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await proxyRow(page, "Old datacenter").locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek='proxy']")).toContainText("Failed");
});

test("Palette: typing Amazon lists the item with the text Running", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+k");
  await search(page).fill("Amazon");
  await expect(palette(page).getByRole("option", { name: /Amazon US seller/ })).toContainText("Running");
});

// Fix round 1, item 8: P16's one word for a deleted proxy has to read the
// same everywhere profileStatus is shown, and never override a session that
// is actually running.
test("\"Proxy missing\" reads the same in the row, the pinned sidebar and the palette; a running profile still reads Running", async ({ page }) => {
  await openApp(page);
  // px-us-1 is shared by Amazon US seller (running, pinned) and FB Ads acc-01
  // (idle, pinned): one deletion exercises both "running wins" and "the
  // warning shows the same word everywhere" in one profile pair.
  await page.evaluate(() => (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke("proxy_delete", { id: "px-us-1" }));
  await page.reload();
  await waitForIdle(page);

  await expect(profileRow(page, "FB Ads acc-01").locator("[data-cell='status']")).toContainText("Proxy missing");
  await expect(pinned(page, "c31d92f0")).toContainText("Proxy missing"); // FB Ads acc-01
  await page.keyboard.press("ControlOrMeta+k");
  await search(page).fill("FB Ads acc-01");
  await expect(palette(page).getByRole("option", { name: /FB Ads acc-01/ })).toContainText("Proxy missing");
  await page.keyboard.press("Escape");

  // Running wins over the warning: a session actually under way still reads
  // Running everywhere, proxy gone or not.
  await expect(profileRow(page, "Amazon US seller").locator("[data-cell='status']")).toContainText("Running");
  await expect(profileRow(page, "Amazon US seller").locator("[data-cell='status']")).not.toContainText("Proxy missing");
  await expect(pinned(page, "a78a0eea")).toContainText("Running");
  await expect(pinned(page, "a78a0eea")).not.toContainText("Proxy missing");
});

// Fix round 1, item 1: a colored Folder and a tagged profile, so the guard's
// identity-dot branch actually has something to exempt on the page it scans
// (before this, no Folder had a color and no profile had a tag in the mock,
// so that branch was never exercised). Owner feedback 5t: the TagPicker and
// the Filters Tag select now show tags and folders as chips, never a dot, so
// the seeded color/tag also exercises those two menus in the guard below.
const seedFolderColor = (page: Page) => page.addInitScript(() => {
  if (localStorage.getItem("shardx.folderMeta") === null) {
    localStorage.setItem("shardx.folderMeta", JSON.stringify({ Ads: { color: "orange", icon: "folder" } }));
  }
});
const seedTag = (page: Page) => page.addInitScript(() => {
  if (localStorage.getItem("shardx.tags") === null) {
    localStorage.setItem("shardx.tags", JSON.stringify({
      version: 1,
      tags: [{ id: "t-warm", name: "Warm-up", color: "orange" }],
      byProfile: { f62a9d43: ["t-warm"] }, // Sandbox
    }));
  }
});

// The generic guard: any small, round, status-colored dot must be decoration
// next to a visible word. Task 5t removes the picker/Filters identity-dot
// exemption Batch 1 kept here — a Tag or a Folder is a chip everywhere now,
// never a dot, so the scan below runs with no exemption at all. "Within its
// parent" climbs past a bare wrapper span (a kit Button renders its
// `leftIcon` in one, a sibling of the visible label, not a parent of it) but
// only follows *sibling* text at each step, never a whole ancestor's
// combined subtree — otherwise one chip's name would cover for a *different*
// chip's broken dot in the same cell.
async function findDotOnlyStatuses(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    const isTransparent = (c: string) => !c || c === "transparent" || /rgba?\([^)]*,\s*0\s*\)/.test(c);
    const BOUNDARY = "button, a, [role='gridcell'], [role='option'], li, [data-cell]";
    const hasNearbyWord = (start: Element): boolean => {
      let node: Element = start;
      for (let hops = 0; hops < 4; hops++) {
        const parent: Element | null = node.parentElement;
        if (!parent) return false;
        const siblingHasText = Array.from(parent.children)
          .some((sib) => sib !== node && (sib.textContent ?? "").trim().length > 0);
        if (siblingHasText) return true;
        if (parent.matches(BOUNDARY)) return false;
        node = parent;
      }
      return false;
    };
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const w = el.clientWidth, h = el.clientHeight;
      if (w === 0 || h === 0 || w > 10 || h > 10) continue;
      const cs = getComputedStyle(el);
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      if (radius < Math.min(w, h) / 2 - 0.5) continue; // not round
      if (isTransparent(cs.backgroundColor)) continue; // no fill: not a status dot
      const hidden = el.getAttribute("aria-hidden") === "true";
      if (hidden && hasNearbyWord(el)) continue;
      bad.push(`${el.tagName.toLowerCase()}.${el.className || "(no class)"}`);
    }
    return bad;
  });
}

test("no status is carried by color alone on the Profiles or Proxies page", async ({ page }) => {
  await seedFolderColor(page);
  await seedTag(page);
  await openApp(page, { section: "profiles" });
  expect(await findDotOnlyStatuses(page)).toEqual([]);

  // Task 5t: the TagPicker and the Filters Tag select show tags (and
  // folders) as chips, no dot at all — Batch 1's identity-dot exemption for
  // these two menus is gone, so the guard runs with each open.
  await page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='tags']").dblclick();
  await expect(page.getByRole("dialog", { name: "Tags" })).toBeVisible();
  expect(await findDotOnlyStatuses(page)).toEqual([]);
  await page.keyboard.press("Escape"); // close the TagPicker

  // F19: the Filters menu's Tag values, each the tag's chip and its count.
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("option", { name: /^Tag/ }).click();
  await expect(page.getByRole("option", { name: /^Warm-up/ })).toBeVisible();
  expect(await findDotOnlyStatuses(page)).toEqual([]);
  await page.keyboard.press("Escape"); // close Filters

  await openApp(page, { section: "proxies" });
  expect(await findDotOnlyStatuses(page)).toEqual([]);
});
