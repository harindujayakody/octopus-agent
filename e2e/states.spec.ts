import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle, type Theme } from "./support/app";

// The state matrix (LQ-06): the states the 2026-09-25 audits found drifting,
// under pixel test in both themes, plus Chinese, a Windows user agent and
// Windows forced colors for four of them. Baselines describe the app as it
// is. A task that changes one of these states re-baselines it on purpose and
// CHANGES.md says why.
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const peek = (page: Page) => page.locator("aside[data-peek]");
const setMock = (page: Page, knobs: Record<string, unknown>) =>
  page.addInitScript((k) => { Object.assign(window, k); }, knobs);

type State = {
  name: string;
  section?: string;
  /** Before the app loads: mock knobs, stored values. */
  before?: (page: Page) => Promise<void>;
  /** Brings the app into the state. */
  open: (page: Page) => Promise<void>;
  /** Focus leaves the list row before the shot (see `settle`). */
  blurRow?: boolean;
};

const STATES: State[] = [
  {
    name: "profiles-peek",
    open: async (page) => {
      await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
      await expect(peek(page)).toHaveAttribute("aria-label", "Peek: Etsy craft shop");
    },
  },
  {
    name: "proxy-peek",
    section: "proxies",
    open: async (page) => {
      await page.locator("[role='row'][data-proxy-id]", { hasText: "DC Tokyo" }).locator("[data-cell='name']").click();
      await expect(page.locator("aside[data-peek='proxy']")).toBeVisible();
    },
  },
  {
    name: "fingerprint-peek",
    section: "fingerprints",
    open: async (page) => {
      await page.locator("[data-fingerprint-id]", { hasText: "macOS 14, Apple M1" }).click();
      await expect(page.locator("aside[data-peek='fingerprint']")).toBeVisible();
    },
  },
  {
    // The profile form (a dialog) on its Fingerprint tab, opened by the
    // details panel's Fingerprint section "Edit". Replaces the widened Peek
    // editor, which was removed on purpose.
    name: "profile-form-fingerprint",
    open: async (page) => {
      await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
      await expect(peek(page)).toHaveAttribute("aria-label", "Peek: Etsy craft shop");
      await peek(page).locator("[data-peek-section='fingerprint']").getByRole("button", { name: "Edit", exact: true }).click();
      const form = page.getByRole("dialog", { name: "Edit Etsy craft shop", exact: true });
      // Shot once it has scaled in (it opens from 0.96).
      await expect(form).toHaveAttribute("data-state", "open");
      await expect(form.getByRole("tab", { name: "Fingerprint" })).toHaveAttribute("aria-selected", "true");
      await expect(form.getByRole("heading", { name: "Hardware and screen" })).toBeVisible();
    },
  },
  {
    name: "palette",
    open: async (page) => {
      await page.keyboard.press("ControlOrMeta+k");
      await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    },
  },
  {
    name: "row-menu",
    open: async (page) => {
      await row(page, "Etsy craft shop").click({ button: "right" });
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
  {
    name: "filters",
    open: async (page) => {
      await page.getByRole("button", { name: "Filters", exact: true }).click();
      await page.getByRole("option", { name: /^Status/ }).click();
      await expect(page.getByRole("option", { name: /^Running/ })).toBeVisible();
    },
  },
  {
    name: "display",
    open: async (page) => {
      await page.getByRole("button", { name: "Display" }).click();
      await expect(page.getByRole("dialog", { name: "Display" })).toBeVisible();
    },
  },
  {
    name: "new-folder",
    open: async (page) => {
      await page.locator("aside").getByRole("button", { name: "New folder" }).click();
      await expect(page.getByRole("dialog", { name: /New folder/ })).toBeVisible();
    },
  },
  {
    name: "confirm",
    open: async (page) => {
      await page.locator("aside [data-folder='Ads']").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Delete folder" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "bulk-bar",
    open: async (page) => {
      for (const name of ["Etsy craft shop", "FB Ads acc-01", "Sandbox"]) {
        await row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
      }
      await expect(page.getByRole("toolbar", { name: /selected/ })).toContainText("3 selected");
    },
    // Merge point 1: its focused Sandbox row's hover actions differed by
    // 2 px at the Move to Trash icon between two runs, as undo-toast's did.
    blurRow: true,
  },
  {
    name: "undo-toast",
    open: async (page) => {
      await row(page, "Sandbox").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Move to Trash" }).click();
      await expect(page.locator("[data-toast]").filter({ hasText: "Sandbox" })).toBeVisible();
    },
    blurRow: true,
  },
  // Merge point 4 visual review: the shortcut sheet (Pair 43's registry
  // sheet in Pair 29's dialog shell) had no baseline.
  {
    name: "shortcut-sheet",
    open: async (page) => {
      await page.keyboard.type("?");
      await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveAttribute("data-state", "open");
    },
  },
  {
    name: "fresh-install",
    before: (page) => setMock(page, { __shardxMockEmpty: true }),
    open: async (page) => { await expect(page.locator("main [data-empty-state]")).toBeVisible(); },
  },
  {
    name: "list-error",
    before: (page) => setMock(page, { __shardxMockFail: { profile_list: 1 } }),
    open: async (page) => { await expect(page.getByText("Couldn’t load profiles")).toBeVisible(); },
  },
  {
    name: "rows-2000",
    before: (page) => setMock(page, { __shardxMockProfiles: 2000 }),
    open: async (page) => {
      await page.getByRole("treegrid").evaluate((el) => { el.scrollTop = Math.round(el.scrollHeight / 2); });
      await expect(row(page, "Profile 1").first()).toBeVisible();
    },
  },
  // Fix round 1 (M10): no seed shows a tag or a colored Folder anywhere in
  // this matrix, so the tinted-chip look (owner feedback 5j) never had a
  // screenshot baseline. Etsy craft shop (aed41005, Folder "Shops") gets
  // all 8 LABEL_COLORS as tags, and Shops gets a color, then Peek opens.
  {
    name: "label-chips",
    before: (page) => page.addInitScript(() => {
      localStorage.setItem("shardx.folderMeta", JSON.stringify({ Shops: { color: "green", icon: "folder" } }));
      const ids = ["blue", "violet", "magenta", "red", "orange", "yellow", "green", "sky"];
      localStorage.setItem("shardx.tags", JSON.stringify({
        version: 1,
        tags: ids.map((id) => ({ id: `t-${id}`, name: id, color: id })),
        byProfile: { aed41005: ids.map((id) => `t-${id}`) },
      }));
    }),
    open: async (page) => {
      await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
      await expect(peek(page)).toHaveAttribute("aria-label", "Peek: Etsy craft shop");
    },
  },
];

/** No hover, no running timers on screen: the shot shows only the state.
 *  A focused row shows its hover actions (`group-focus-within`), and they
 *  rasterized one of two ways from run to run. Their row's line takes no
 *  layout now, so they sit on whole pixels, and profiles-peek held (0 of 60
 *  captures differed with the row focused), but undo-toast did not: 10 of
 *  24 captures had 2 px past the threshold, at the Move to Trash icon (the
 *  rest of that row re-rasterized by less than 6/255). So focus leaves the
 *  row only in a state that asks for it (`blurRow`: undo-toast, and bulk-bar
 *  after the same 2 px flake at merge point 1); the others show the focused
 *  row as a user sees it (Pair 3 review, Minor 5). The row
 *  keeps its active or Peek fill. A menu or dialog keeps its focus. */
async function settle(page: Page, s: State) {
  await page.mouse.move(1, 1);
  if (s.blurRow) {
    await page.evaluate(() => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused.closest("[role='row']")) focused.blur();
    });
  }
  await waitForIdle(page);
}

/** Forced-colors shots only. The palette opens with its search field focused
 *  and the text caret blinks there, so about half the runs caught the caret
 *  and half caught the gap between two blinks: 16 px at x=395, the field's
 *  left edge. Playwright's `caret: "hide"` cannot reach it, because forced
 *  colors paints caret-color as CanvasText and ignores the page's
 *  `transparent` (measured: the computed value stays black and the caret
 *  keeps blinking). `caret-animation` is not a color, so forced colors leaves
 *  it alone, and `manual` paints the caret steadily instead of blinking
 *  (30 of 30 captures over 4.5 s drew it) — which is what the baselines
 *  already hold. */
async function steadyCaret(page: Page) {
  await page.addStyleTag({ content: "* { caret-animation: manual !important; }" });
}

async function shoot(page: Page, s: State, theme: Theme, file: string, { forced = false } = {}) {
  await s.before?.(page);
  await openApp(page, { section: s.section ?? "profiles", theme });
  await s.open(page);
  await settle(page, s);
  // Curved edges once differed by session here; whole-tile raster (playwright.config.ts) settled it.
  if (forced) await steadyCaret(page);
  await expect(page).toHaveScreenshot(file);
}

for (const theme of ["dark", "light"] as const) {
  for (const s of STATES) {
    test(`state ${s.name}, ${theme}`, { tag: "@visual" }, async ({ page }) => {
      await shoot(page, s, theme, `state-${s.name}-${theme}.png`);
    });
  }
}

// Four states that carry the most text and chrome.
const SUBSET = STATES.filter((s) => ["profiles-peek", "palette", "confirm", "fresh-install"].includes(s.name));

// The same four states opened without English names, for the Chinese UI.
const zhOpen: Record<string, (page: Page) => Promise<void>> = {
  "profiles-peek": async (page) => {
    await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
    await expect(peek(page)).toBeVisible();
  },
  palette: async (page) => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog")).toBeVisible();
  },
  confirm: async (page) => {
    await page.locator("aside [data-folder='Ads']").click({ button: "right" });
    await page.getByRole("menuitem").last().click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
  },
  "fresh-install": async (page) => { await expect(page.locator("main [data-empty-state]")).toBeVisible(); },
};

for (const s of SUBSET) {
  test(`state ${s.name}, Chinese`, { tag: "@visual" }, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
    await shoot(page, { ...s, open: zhOpen[s.name] }, "dark", `state-${s.name}-zh.png`);
  });
}

test.describe("on Windows", () => {
  test.use({ userAgent: WINDOWS_UA });
  // Playwright's "ControlOrMeta" shortcut follows the real test-runner OS
  // (macOS), not the page's spoofed user agent, so it would send Cmd+K here
  // while the app (reading the Windows UA) listens for Ctrl+K. Send the key
  // a real Windows keyboard would.
  const windowsOpen: Partial<Record<string, (page: Page) => Promise<void>>> = {
    palette: async (page) => {
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    },
  };
  for (const s of SUBSET) {
    test(`state ${s.name}, Windows`, { tag: "@visual" }, async ({ page }) => {
      await shoot(page, { ...s, open: windowsOpen[s.name] ?? s.open }, "dark", `state-${s.name}-windows.png`);
    });
  }
});

for (const s of SUBSET) {
  test(`state ${s.name}, forced colors`, { tag: ["@forced", "@visual"] }, async ({ page }) => {
    await shoot(page, s, "dark", `state-${s.name}.png`, { forced: true });
  });
}
