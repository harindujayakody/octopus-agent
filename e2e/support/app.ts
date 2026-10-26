import { expect, type Locator, type Page } from "@playwright/test";

/** Every page of the new UI. Same values as SECTIONS in src/shared/types,
 *  less the Team page: it opens from the space menu, inside a team only (team-admin.spec.ts). */
export const SECTIONS = [
  "profiles", "proxies", "automation",
  "fingerprints", "extensions", "bookmarks",
  "trash", "settings",
] as const;
export type Section = (typeof SECTIONS)[number];

export type Theme = "light" | "dark";

/** Frozen "now", so uptimes and "last run 5 min ago" never drift between runs. */
export const NOW = new Date("2026-09-01T12:00:00Z");

/** `hash` addresses a satellite window, e.g. "#/?fleet=1". */
/** `idle: false` returns before the mock settles (to see a page loading). */
/** `askDirect: true` keeps the "Start without a proxy?" question on (it is off for every other test). */
/** `onboarding: "fresh"` seeds nothing: a first install, which meets the welcome, the tour offer and
 *  the page tips. Every other test starts with all three finished, so none of them covers a spec's page. */
type OpenOptions = { path?: string; hash?: string; section?: string; theme?: Theme; idle?: boolean; askDirect?: boolean; onboarding?: "done" | "fresh" };

/** The version the mock backend reports (`plugin:app|version` in src/dev/mock/handlers.ts): seeded as
 *  the What's new version already seen, so a test is neither a first install nor an update. */
const MOCK_VERSION = "2.0.3";

/**
 * Opens the app on the mock backend with seeded data, a fixed clock, English,
 * and the given theme. Settings
 * are written only when absent, so a later navigation (a reload) sees what
 * the app itself stored.
 */
export async function openApp(
  page: Page,
  { path = "/", hash = "", section = "profiles", theme = "dark", idle = true, askDirect = false, onboarding = "done" }: OpenOptions = {},
) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ theme, askDirect, onboarding, version }) => {
    const init = (key: string, value: string) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    };
    init("shardx-ui-kit-theme", theme);
    init("shardx.lang", "en");
    // Most tests start Sandbox (no proxy) while proxies exist: the O9a
    // question would stop them. The tests of that question turn it back on.
    if (!askDirect) init("shardx.confirmDirectStart", "off");
    // The welcome, the tour offer and the page tips are finished, as on a
    // computer that has used the app: none covers a test's page. `state` is
    // left to the first loaded list, as ever (fresh install or not).
    if (onboarding === "done") {
      init("shardx.onboarding", JSON.stringify({ version: 2, state: "unknown", welcomeDone: true, tour: "done", pagesSeen: [], tipsOff: true }));
      init("shardx-patchlog-seen-version", version);
    }
  }, { theme, askDirect, onboarding, version: MOCK_VERSION });
  await page.goto(`${path}?mock=reset&section=${section}${hash}`);
  await expect
    .poll(() => page.evaluate(() => "__shardxMock" in window), {
      message: "mock backend missing: is a non-mock `npm run dev` holding port 1420?",
    })
    .toBe(true);
  // The launcher's code is its own chunk (Pair 59): the mock is up before
  // the shell is. The page's own title (its ready signal) comes first, so
  // the idle wait below covers the page's own loads. Any page's title: an
  // unknown section opens Profiles. A window with no launcher page has no
  // title and waits for idle only, as before: a panel window
  // (addressed by hash) and the engine screen (`__shardxMockEngine`).
  const launcherPage = path === "/" && !/[?&](syncPanel|helperPanel|fleet)=/.test(hash)
    && !(await page.evaluate(() => !!(window as { __shardxMockEngine?: string }).__shardxMockEngine));
  if (idle) {
    // The first load of a page's own chunk: a busy machine (three browsers) can
    // take longer than the built mode's 5 s assertion time, never the test's 15 s.
    if (launcherPage) await expect(page.locator("main [data-page-title]")).toBeAttached({ timeout: 10_000 });
    // A page whose code is still on its way shows its header over its
    // loading look (App.tsx `SectionLoading`): the page itself comes next.
    if (launcherPage) await expect(page.locator("main [data-page-loading]")).toHaveCount(0, { timeout: 10_000 });
    await waitForIdle(page);
  }
  // Automation loads its code on first use: its header is there at once, and
  // the projects count (beside the title) once the page has its projects, or
  // its error state once the first read failed (the page's own ready signal;
  // waitForIdle cannot see a chunk still on its way).
  if (launcherPage && section === "automation") {
    const projectsCount = page.locator("main header [data-count]").filter({ hasText: /\d/ });
    await expect(projectsCount.or(page.locator("main").getByRole("button", { name: "Retry" })).first()).toBeVisible();
  }
}

/**
 * Resolves once no slow mock command has been in flight for `quietPolls`
 * consecutive 50 ms polls. Pages load in chains (one answer triggers the next
 * request), so a single idle moment is not enough: the quiet window has to
 * outlast a render and effect. Counted in polls, not time, because the test
 * clock is frozen.
 */
export async function waitForIdle(page: Page, quietPolls = 8) {
  await page.waitForFunction(
    (quietPolls) => {
      const w = window as unknown as { __shardxMock?: { pending: number }; __idlePolls?: number };
      // Right after a navigation the mock may not have installed itself yet.
      if (!w.__shardxMock) return false;
      w.__idlePolls = w.__shardxMock.pending > 0 ? 0 : (w.__idlePolls ?? 0) + 1;
      return w.__idlePolls >= quietPolls;
    },
    quietPolls,
    { polling: 50 },
  );
}

/** Puts an app module on `window[name]`: the same instance the app itself
 *  uses, loaded from the dev server (dev project only; the production build
 *  has no source paths). Audit Phase D Task 1 planned this helper. */
export async function appModule(page: Page, path: string, name: string) {
  // Built mode (E2E_BUILT=1): the build lists its modules on `__e2eModules`.
  if (process.env.E2E_BUILT === "1") {
    await page.evaluate(async ([p, n]) => {
      const mods = (window as unknown as { __e2eModules: Record<string, () => Promise<unknown>> }).__e2eModules;
      if (!mods?.[p]) throw new Error(`appModule: ${p} is not in the e2e build`);
      (window as unknown as Record<string, unknown>)[n] = await mods[p]();
    }, [path, name]);
    return;
  }
  await page.addScriptTag({ type: "module", content: `import * as m from "${path}"; window["${name}"] = m;` });
  await expect.poll(() => page.evaluate((n) => n in window, name)).toBe(true);
}

/** Reloads the app on the same data and waits for it the way `openApp`
 *  does. A bare `page.reload()` returns before the dev server has sent every
 *  module; under a full parallel run that took longer than an assertion's
 *  10 s (the `views.spec.ts:20` flake). */
export async function reloadApp(page: Page) {
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => "__shardxMock" in window), { timeout: 60_000 })
    .toBe(true);
  // As in openApp: the mock is up before the launcher's own chunk (Pair 59),
  // so a launcher window waits for its page's title before the idle wait.
  const url = new URL(page.url());
  const launcherPage = url.pathname === "/" && !/[?&](syncPanel|helperPanel|fleet)=/.test(url.hash)
    && !(await page.evaluate(() => !!(window as { __shardxMockEngine?: string }).__shardxMockEngine));
  if (launcherPage) await expect(page.locator("main [data-page-title]")).toBeAttached();
  await waitForIdle(page);
}

/** A list wider than its card (owner decision 2026-09-26): it scrolls
 *  sideways inside the card and the page never does. Scrolled to its start
 *  and to its right end, `row`'s Name stays in the card and on top, and the
 *  row's hover action `hoverButton` ("Pin", "Edit") and its More actions
 *  button stay in the card, on top and clickable. Leaves the list at its
 *  right end. */
export async function expectScrollsInCard(page: Page, grid: Locator, row: Locator, hoverButton: string) {
  expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const card = (await grid.boundingBox())!;
  const inCard = async (loc: Locator) => {
    const b = (await loc.boundingBox())!;
    return b.x >= card.x - 1 && b.x + b.width <= card.x + card.width + 1;
  };
  // Nothing covers it: the point at its middle hits it (or what it holds).
  const onTop = (loc: Locator) => loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit !== null && (hit === el || el.contains(hit));
  });
  const name = row.locator("[data-cell='name']");
  const more = row.getByRole("button", { name: "More actions", exact: true });
  for (const end of ["start", "end"] as const) {
    await grid.evaluate((el, at) => { el.scrollLeft = at === "start" ? 0 : el.scrollWidth; }, end);
    // The pointer on the pinned Name: the row is hovered, its actions show.
    const n = (await name.boundingBox())!;
    await page.mouse.move(n.x + 8, n.y + n.height / 2);
    expect(await inCard(name)).toBe(true);
    expect(await onTop(name)).toBe(true);
    for (const button of [row.getByRole("button", { name: hoverButton, exact: true }), more]) {
      await expect(button).toBeVisible();
      expect(await inCard(button)).toBe(true);
      expect(await onTop(button)).toBe(true);
    }
  }
  await more.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
}

/** "New profile" opens the profile form (manual save): Create profile makes
 *  the profile, once the form has its defaults, and the form closes. */
export async function pressCreate(page: Page, { wait = true }: { wait?: boolean } = {}) {
  const form = page.getByRole("dialog", { name: "New profile", exact: true });
  await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue(/./);
  await form.getByRole("button", { name: "Create profile" }).click();
  // `wait: false`: back at once, for a test of what the new row does as it arrives.
  if (wait) await expect(form).toHaveCount(0);
}

/** A Profiles (or Proxies) row by the name it shows. */
export const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });

/** The profile form on `name`, from its row's menu (Edit): the dialog "Edit
 *  {name}", read, on `tab` when one is given. Nothing is written until its Save. */
export async function openEditForm(page: Page, name = "Sandbox", tab?: "Basics" | "Proxy" | "Fingerprint" | "Extensions") {
  await row(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const form = page.getByRole("dialog", { name: `Edit ${name}`, exact: true });
  await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue(name);
  if (tab) await form.getByRole("tab", { name: tab }).click();
  return form;
}

/** The list header's column titles, in the order it draws them (`data-col`,
 *  the columns a person chose, not the select box or the row actions). */
export const titles = (page: Page) => page.locator("[role='row'][aria-rowindex='1'] [data-col]").allTextContents();

/** Seeds `key` only when nothing is stored there yet, so a reload keeps what
 *  the app itself wrote. `value` may already be a string (a broken value, or
 *  one of a different shape) or a plain object to stringify. */
/** The tags as the backend keeps them (tags.rs, in the mock): tag ids by
 *  profile id are `by_profile` there, `byProfile` in what older builds kept. */
export type StoredTags = { tags: { id: string; name: string; color: string }[]; by_profile: Record<string, string[]> };
export const storedTags = (page: Page): Promise<StoredTags> => page.evaluate(() =>
  (window as unknown as { __shardxMock: { state: { tags?: StoredTags } } }).__shardxMock.state.tags ?? { tags: [], by_profile: {} });

/** The folders kept while empty and their looks, as the backend keeps them (folders.rs, in the mock). */
export type StoredFolders = { registry: string[]; meta: Record<string, { color: string | null; icon: string }> };
export const storedFolders = (page: Page): Promise<StoredFolders> => page.evaluate(() =>
  (window as unknown as { __shardxMock: { state: { folders?: StoredFolders } } }).__shardxMock.state.folders ?? { registry: [], meta: {} });

/** One tag exists, so the Tags column shows (it stays out until a tag exists, CRAFT-14). */
export const seedATag = (page: Page) => page.addInitScript(() => {
  if (localStorage.getItem("shardx.tags") === null) {
    localStorage.setItem("shardx.tags", JSON.stringify({ version: 1, tags: [{ id: "t-warm", name: "Warm-up", color: "orange" }], byProfile: { aed41005: ["t-warm"] } }));
  }
});

export const seed = (page: Page, key: string, value: unknown) => page.addInitScript(([k, v]) => {
  if (localStorage.getItem(k) === null) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
}, [key, value] as const);

/** Opens the header's Display popover and waits for it. A plain click, never
 *  forced, on the button itself: nothing to race there. */
export async function openDisplay(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Display" }).click();
  const display = page.getByRole("dialog", { name: "Display" });
  await expect(display).toBeVisible();
  return display;
}

/** Opens Display, ticks (or unticks) the given column(s) by their header
 *  name, and closes it. Every click here is a plain click, never forced: the
 *  kit Popover reports `toBeVisible()` as soon as its position is computed,
 *  a couple of animation frames before its `data-state` flips from "closed"
 *  to "open" and lifts `pointer-events-none` — a forced click inside that
 *  window is real input that passes straight through to whatever is under
 *  the popover (the `views.spec.ts:20` flake's actual root cause; a plain
 *  click makes Playwright wait out the window instead). */
export async function toggleDisplayColumns(page: Page, names: string | string[]) {
  const display = await openDisplay(page);
  for (const n of Array.isArray(names) ? names : [names]) {
    await display.getByRole("checkbox", { name: n, exact: true }).click();
  }
  await page.keyboard.press("Escape");
}
