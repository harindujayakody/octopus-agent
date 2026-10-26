import { expect, test, type Locator, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";

// Onboarding Task 2: the tour engine. A test registry of steps points at
// elements the test tags itself (`data-tour`), on real pages and on boxes it
// adds, so the engine is tested apart from the real tour's steps (Task 3).

type Step = { id: string; section: string; target: string | null; title: string; body: string; picture?: string };
type TourWindow = { __tour: { useTour: { getState: () => { run: unknown; start: (steps: Step[], kind: "full" | "page") => void } } } };

const step = (id: string, section: string, target: string | null, title: string, extra: Partial<Step> = {}): Step =>
  ({ id, section, target, title, body: `${title}, explained.`, ...extra });

/** Tags every element matching a selector with its `data-tour` key as it appears (pages load later). */
async function tagOnSight(page: Page, map: Record<string, string>) {
  await page.addInitScript((m) => {
    const tag = () => {
      for (const [sel, key] of Object.entries(m)) {
        for (const el of document.querySelectorAll(sel)) if (el.getAttribute("data-tour") !== key) el.setAttribute("data-tour", key);
      }
    };
    new MutationObserver(tag).observe(document, { childList: true, subtree: true });
  }, map);
}

async function startTour(page: Page, steps: Step[]) {
  await appModule(page, "/src/features/tour/index.ts", "__tour");
  await page.evaluate((s) => (window as unknown as TourWindow).__tour.useTour.getState().start(s, "full"), steps);
}

const card = (page: Page) => page.locator("[data-tour-card]");
const scrim = (page: Page) => page.locator("[data-tour-scrim]");

/** The cut-out the scrim draws, "x y w h r" in layout px, or "none". */
const cutout = (page: Page) => scrim(page).getAttribute("data-cutout");

/** The rect a cut-out around `sel` has: x, y, width, height in layout px (Interface size counts), 8 px out on every side. */
const holeAround = (page: Page, sel: string) => page.evaluate((s) => {
  const el = document.querySelector(s)!;
  const html = document.documentElement;
  const k = html.getBoundingClientRect().width / html.offsetWidth || 1;
  const r = el.getBoundingClientRect();
  return [r.left / k - 8, r.top / k - 8, r.width / k + 16, r.height / k + 16];
}, sel);

/** The cut-out around `sel`. */
async function expectHoleAt(page: Page, sel: string) {
  await expect.poll(async () => {
    const got = (await cutout(page))?.split(" ").map(Number) ?? [];
    const exp = await holeAround(page, sel);
    return got.length === 5 && exp.every((v, i) => Math.abs(v - got[i]) <= 1);
  }, { message: `the cut-out sits around ${sel}` }).toBe(true);
}

/** The card sits beside `sel`, apart from it and close to it (its arrow's gap). */
async function expectBeside(page: Page, dialog: Locator, sel: string) {
  await expect.poll(async () => {
    const c = (await dialog.boundingBox())!;
    const t = (await page.locator(sel).boundingBox())!;
    const gapX = Math.max(t.x - (c.x + c.width), c.x - (t.x + t.width));
    const gapY = Math.max(t.y - (c.y + c.height), c.y - (t.y + t.height));
    const gap = Math.max(gapX, gapY);
    return gap > 0 && gap <= 40;
  }, { message: `the card sits beside ${sel}` }).toBe(true);
}

/** A fixed box on the right: it moves when the window narrows and when Interface size changes. */
const addFixedBox = (page: Page) => page.evaluate(() => {
  const el = document.createElement("div");
  el.id = "t-fixed";
  el.dataset.tour = "t-fixed";
  Object.assign(el.style, { position: "fixed", right: "40px", top: "300px", width: "120px", height: "40px", borderRadius: "6px" });
  document.body.append(el);
});

test("Next and Back move across two pages", async ({ page }) => {
  await tagOnSight(page, {
    "main[data-section='profiles'] [data-page-title]": "t-profiles",
    "main[data-section='proxies'] [data-page-title]": "t-proxies",
    "aside [data-nav='proxies']": "t-nav",
  });
  await openApp(page);
  await startTour(page, [
    step("one", "profiles", "t-profiles", "Your profiles"),
    step("two", "proxies", "t-proxies", "Your proxies"),
    step("three", "proxies", "t-nav", "The proxies item"),
  ]);
  const first = page.getByRole("dialog", { name: "Your profiles" });
  await expect(first).toContainText("1 of 3");
  await expect(first).toHaveAccessibleDescription("Your profiles, explained.");
  await expectHoleAt(page, "[data-tour='t-profiles']");
  // The first step has no Back.
  await expect(first.getByRole("button", { name: "Back" })).toHaveCount(0);

  await first.getByRole("button", { name: "Next" }).click();
  await expect(page.locator("main[data-section='proxies']")).toBeVisible();
  const second = page.getByRole("dialog", { name: "Your proxies" });
  await expect(second).toContainText("2 of 3");
  await expectHoleAt(page, "main[data-section='proxies'] [data-tour='t-proxies']");

  await second.getByRole("button", { name: "Back" }).click();
  await expect(page.locator("main[data-section='profiles']")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Your profiles" })).toContainText("1 of 3");
  await expectHoleAt(page, "[data-tour='t-profiles']");

  await page.getByRole("dialog", { name: "Your profiles" }).getByRole("button", { name: "Next" }).click();
  await page.getByRole("dialog", { name: "Your proxies" }).getByRole("button", { name: "Next" }).click();
  const last = page.getByRole("dialog", { name: "The proxies item" });
  await expect(last).toContainText("3 of 3");
  // The last step says Finish, and Finish ends the tour.
  await last.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as TourWindow).__tour.useTour.getState().run)).toBeNull();
});

type Ended = { id: number; reason: string; kind: string; page?: string; visited: string[] };
type EndWindow = { __tour: { useTour: { getState: () => {
  start: (steps: Step[], kind: "full" | "page", page?: string) => void;
  next: () => Promise<void>;
  end: (reason: string) => void;
  ended: Ended | null;
} } } };

test("ending a run records why, which kind and the pages it showed", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/features/tour/index.ts", "__tour");
  const steps = [step("one", "profiles", null, "Your profiles"), step("two", "proxies", null, "Your proxies"), step("three", "settings", null, "Your settings")];
  const endAfterTwo = async (reason: string, kind: "full" | "page", pageArg?: string) => {
    await page.evaluate(([s, k, p]) => (window as unknown as EndWindow).__tour.useTour.getState().start(s as Step[], k as "full" | "page", p as string | undefined), [steps, kind, pageArg] as const);
    await expect(page.getByRole("dialog", { name: "Your profiles" })).toBeVisible();
    await page.evaluate(() => (window as unknown as EndWindow).__tour.useTour.getState().next());
    await expect(page.getByRole("dialog", { name: "Your proxies" })).toBeVisible();
    await page.evaluate((r) => (window as unknown as EndWindow).__tour.useTour.getState().end(r), reason);
    await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
    return page.evaluate(() => (window as unknown as EndWindow).__tour.useTour.getState().ended);
  };
  // Nothing before a first end.
  expect(await page.evaluate(() => (window as unknown as EndWindow).__tour.useTour.getState().ended)).toBeNull();
  // Skip, Esc and a cancelled page change: the pages shown so far (two of three).
  const ids: number[] = [];
  for (const reason of ["skip", "esc", "cancelled"]) {
    const ended = (await endAfterTwo(reason, "full"))!;
    expect(ended).toMatchObject({ reason, kind: "full", visited: ["profiles", "proxies"] });
    ids.push(ended.id);
  }
  // A page run says which page it was.
  const pageRun = (await endAfterTwo("skip", "page", "proxies"))!;
  expect(pageRun).toMatchObject({ reason: "skip", kind: "page", page: "proxies" });
  ids.push(pageRun.id);
  // Every end is a new one, even the same reason twice.
  expect(new Set(ids).size).toBe(ids.length);
  // Finish on the last step: all three pages, and "done".
  await page.evaluate((s) => (window as unknown as EndWindow).__tour.useTour.getState().start(s as Step[], "full"), steps);
  await expect(page.getByRole("dialog", { name: "Your profiles" })).toBeVisible();
  await page.evaluate(async () => { const t = (window as unknown as EndWindow).__tour.useTour.getState; await t().next(); await t().next(); });
  await expect(page.getByRole("dialog", { name: "Your settings" })).toBeVisible();
  await page.getByRole("dialog", { name: "Your settings" }).getByRole("button", { name: "Finish" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as EndWindow).__tour.useTour.getState().ended?.reason)).toBe("done");
  expect((await page.evaluate(() => (window as unknown as EndWindow).__tour.useTour.getState().ended))?.visited).toEqual(["profiles", "proxies", "settings"]);
});

test("Esc ends and shows the replay toast", async ({ page }) => {
  await tagOnSight(page, { "aside [data-nav='proxies']": "t-nav" });
  await openApp(page);
  await startTour(page, [step("one", "profiles", "t-nav", "The proxies item"), step("two", "profiles", "t-nav", "Again")]);
  await expect(page.getByRole("dialog", { name: "The proxies item" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
  await expect(page.locator("[data-toast]").filter({ hasText: "You can replay the tour from Settings" })).toBeVisible();
  // Esc ended only the tour: the page stays as it was, and has the keyboard.
  await expect(page.locator("main[data-section='profiles']")).toBeVisible();
  await expect.poll(() => keyboardOnPage(page)).toBe(true);
});

// Final review I1: a page change the tour did not make (a link elsewhere in
// the app, a deep link) ends the run as "cancelled"; the tour's own
// moves do not. Once the layer is gone, the store lets go of the element it held.
test("a page change the tour did not make ends the run as cancelled, and the store lets go of the element", async ({ page }) => {
  await tagOnSight(page, { "main[data-section='proxies'] [data-page-title]": "t-proxies" });
  await openApp(page);
  await startTour(page, [step("one", "profiles", null, "Your profiles"), step("two", "proxies", "t-proxies", "Your proxies"), step("three", "proxies", null, "Your end")]);
  await appModule(page, "/src/shared/model/navigation.ts", "__nav");
  type Held = { __tour: { useTour: { getState: () => { target: unknown; ended: Ended | null } } } };
  const held = () => page.evaluate(() => (window as unknown as Held).__tour.useTour.getState().target !== null);
  expect(await held()).toBe(false);
  await page.getByRole("dialog", { name: "Your profiles" }).getByRole("button", { name: "Next" }).click();
  // The tour's own move to Proxies is no foreign change: the run goes on, on its element.
  const second = page.getByRole("dialog", { name: "Your proxies" });
  await expect(second).toContainText("2 of 3");
  await expectHoleAt(page, "main[data-section='proxies'] [data-tour='t-proxies']");
  expect(await held()).toBe(true);
  // Anything else moving the app to another page ends it.
  await page.evaluate(() => (window as unknown as { __nav: { useNav: { getState: () => { setSection: (s: string) => Promise<boolean> } } } }).__nav.useNav.getState().setSection("fingerprints"));
  await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
  await expect(page.locator("main[data-section='fingerprints']")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Held).__tour.useTour.getState().ended)).toMatchObject({ reason: "cancelled", kind: "full", visited: ["profiles", "proxies"] });
  // The scrim left from where it was, and then the detached element was let go.
  await expect.poll(held).toBe(false);
});

/** The keyboard is on the page (where it begins), never left on `<body>`. */
const keyboardOnPage = (page: Page) => page.evaluate(() => {
  const now = document.activeElement;
  return !!now && now !== document.body && !!now.closest("main");
});

test("a tour started from the palette hands the keyboard to the page when it ends", async ({ page }) => {
  await tagOnSight(page, {
    "main[data-section='profiles'] [data-page-title]": "t-profiles",
    "aside [data-nav='proxies']": "t-nav",
  });
  await openApp(page);
  await appModule(page, "/src/features/tour/index.ts", "__tour");
  await appModule(page, "/src/shared/model/palette.ts", "__palette");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("combobox", { name: "Search commands" })).toBeFocused();
  // As a palette command runs: the palette closes (its field, which had the
  // keyboard, leaves the page) and the tour starts.
  await page.evaluate((steps) => {
    const w = window as unknown as TourWindow & { __palette: { usePalette: { getState: () => { closeAfterRun: () => void } } } };
    w.__palette.usePalette.getState().closeAfterRun();
    w.__tour.useTour.getState().start(steps, "full");
  }, [step("one", "profiles", "t-profiles", "Your profiles"), step("two", "profiles", "t-nav", "The proxies item")]);
  const tour = card(page);
  await expect(tour).toContainText("1 of 2");
  // Landed: a press before then is ignored, as the engine holds Next while it looks.
  await expect(tour).not.toHaveAttribute("data-entering");
  await expect(tour.getByRole("button", { name: "Next" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tour).toContainText("2 of 2");
  await expect(tour.getByRole("button", { name: "Finish" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
  // The end card takes the keyboard; Done hands it to the page, not to <body>.
  const end = page.getByRole("dialog", { name: "You’re all set." });
  await expect(end.getByRole("button", { name: "Done" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(end).toHaveCount(0);
  await expect.poll(() => keyboardOnPage(page)).toBe(true);
});

test("a missing target centres the card with its picture", async ({ page }) => {
  await openApp(page);
  await startTour(page, [step("gone", "profiles", "t-missing", "Not here yet", { picture: "panel" }), step("two", "profiles", null, "Next one")]);
  const dialog = page.getByRole("dialog", { name: "Not here yet" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-tour-picture='panel']")).toBeVisible();
  await expect.poll(() => cutout(page)).toBe("none");
  await expect(dialog.locator("[data-tour-arrow]")).toHaveCount(0);
  const vp = page.viewportSize()!;
  await expect.poll(async () => {
    const b = (await dialog.boundingBox())!;
    return Math.abs(b.x + b.width / 2 - vp.width / 2) <= 2 && Math.abs(b.y + b.height / 2 - vp.height / 2) <= 2;
  }).toBe(true);
});

test("the cut-out follows the target after a window resize and after Interface size 125%", async ({ page }) => {
  await openApp(page);
  await addFixedBox(page);
  await startTour(page, [step("fixed", "profiles", "t-fixed", "A box on the right")]);
  const dialog = page.getByRole("dialog", { name: "A box on the right" });
  await expect(dialog).toBeVisible();
  await expectHoleAt(page, "#t-fixed");
  // Concentric: the box's own 6 px radius and the 8 px around it.
  expect((await cutout(page))!.split(" ")[4]).toBe("14");
  await expect(dialog.locator("[data-tour-arrow]")).toBeVisible();
  await expectBeside(page, dialog, "#t-fixed");

  await page.setViewportSize({ width: 1100, height: 760 });
  await expectHoleAt(page, "#t-fixed");
  await expectBeside(page, dialog, "#t-fixed");

  // Interface size is CSS zoom on <html>: no resize event comes with it.
  await appModule(page, "/src/shared/model/interfaceSize.ts", "__size");
  await page.evaluate(() => (window as unknown as { __size: { useInterfaceSize: { getState: () => { previewSize: (n: number) => void } } } }).__size.useInterfaceSize.getState().previewSize(125));
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe("1.25");
  await expectHoleAt(page, "#t-fixed");
  await expectBeside(page, dialog, "#t-fixed");
});

test("a target below the fold is scrolled into view before the cut-out lands", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.id = "t-scroller";
    Object.assign(box.style, { position: "fixed", left: "400px", top: "120px", width: "300px", height: "300px", overflow: "auto" });
    const tall = document.createElement("div");
    Object.assign(tall.style, { position: "relative", height: "2000px" });
    const target = document.createElement("div");
    target.id = "t-deep";
    target.dataset.tour = "t-deep";
    Object.assign(target.style, { position: "absolute", top: "1800px", left: "20px", width: "100px", height: "30px" });
    tall.append(target);
    box.append(tall);
    document.body.append(box);
    // Every cut-out the layer draws, from its first.
    const w = window as unknown as { __holes: string[] };
    w.__holes = [];
    new MutationObserver(() => {
      const v = document.querySelector("[data-tour-scrim]")?.getAttribute("data-cutout");
      if (v && v !== w.__holes.at(-1)) w.__holes.push(v);
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-cutout"] });
  });
  await startTour(page, [step("deep", "profiles", "t-deep", "Far down")]);
  await expect(page.getByRole("dialog", { name: "Far down" })).toBeVisible();
  expect(await page.locator("#t-scroller").evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
  await expectHoleAt(page, "#t-deep");
  // No cut-out was ever drawn where the target was before the scroll: each
  // one sits inside the scroller's view (120 to 420), 8 px around it.
  const holes = await page.evaluate(() => (window as unknown as { __holes: string[] }).__holes);
  const drawn = holes.filter((h) => h !== "none");
  expect(drawn.length).toBeGreaterThan(0);
  for (const h of drawn) {
    const [, y, , height] = h.split(" ").map(Number);
    expect(y).toBeGreaterThanOrEqual(120 - 8 - 1);
    expect(y + height).toBeLessThanOrEqual(420 + 8 + 1);
  }
});

test("clicks on the page behind the scrim do nothing", async ({ page }) => {
  await tagOnSight(page, { "aside [data-nav='proxies']": "t-nav" });
  await openApp(page);
  const nav = (await page.locator("aside [data-nav='proxies']").boundingBox())!;
  const create = (await page.getByRole("button", { name: "New profile" }).first().boundingBox())!;
  await startTour(page, [step("nav", "profiles", "t-nav", "The proxies item"), step("two", "profiles", null, "Next one")]);
  const dialog = page.getByRole("dialog", { name: "The proxies item" });
  await expect(dialog).toBeVisible();
  // The highlighted item itself, inside the cut-out, then a button elsewhere.
  await page.mouse.click(nav.x + nav.width / 2, nav.y + nav.height / 2);
  await page.mouse.click(create.x + create.width / 2, create.y + create.height / 2);
  await page.waitForTimeout(300);
  await expect(page.locator("main[data-section='profiles']")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "New profile" })).toHaveCount(0);
  await expect(dialog).toContainText("1 of 2");
  // A press on the scrim leaves the keyboard in the card.
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
});

test("focus stays in the card and arrows work", async ({ page }) => {
  await tagOnSight(page, {
    "main[data-section='profiles'] [data-page-title]": "t-profiles",
    "aside [data-nav='proxies']": "t-nav",
  });
  await openApp(page);
  await startTour(page, [
    step("one", "profiles", "t-profiles", "Your profiles"),
    step("two", "profiles", "t-nav", "The proxies item"),
    step("three", "profiles", null, "The end"),
  ]);
  const tour = card(page);
  await expect(tour).toContainText("1 of 3");
  const inCard = () => tour.evaluate((el) => el.contains(document.activeElement));
  await expect(tour.getByRole("button", { name: "Next" })).toBeFocused();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    expect(await inCard()).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await inCard()).toBe(true);

  await page.keyboard.press("ArrowRight");
  await expect(tour).toContainText("2 of 3");
  expect(await inCard()).toBe(true);
  await page.keyboard.press("ArrowLeft");
  await expect(tour).toContainText("1 of 3");
  expect(await inCard()).toBe(true);

  // Enter on Next moves one step, not two (the button and the key).
  await tour.getByRole("button", { name: "Next" }).focus();
  await page.keyboard.press("Enter");
  await expect(tour).toContainText("2 of 3");
  await page.waitForTimeout(200);
  await expect(tour).toContainText("2 of 3");

  // The page's own keys stay off while the tour runs: G P would open Proxies.
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await page.waitForTimeout(200);
  await expect(page.locator("main[data-section='profiles']")).toBeVisible();
  expect(await inCard()).toBe(true);
});

// Polish pass on the engine's parked nits.
test("a held Enter on Next presses it once, and Tab from outside the card comes back to it", async ({ page }) => {
  await tagOnSight(page, { "aside [data-nav='proxies']": "t-nav" });
  await openApp(page);
  await startTour(page, [step("one", "profiles", null, "One"), step("two", "profiles", null, "Two"), step("three", "profiles", null, "Three")]);
  const tour = card(page);
  const next = tour.getByRole("button", { name: "Next" });
  await expect(tour).toContainText("1 of 3");
  await expect(next).toBeFocused();
  // The press is the button's own; the repeats of a held key are swallowed, or Next
  // would click again on every step that lands.
  const prevented = await next.evaluate((el) => {
    const press = (repeat: boolean) => {
      const e = new KeyboardEvent("keydown", { key: "Enter", repeat, bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    return { first: press(false), repeat: press(true) };
  });
  expect(prevented).toEqual({ first: false, repeat: true });
  await expect(tour).toContainText("1 of 3");

  // The keyboard outside the card (a window control was pressed, then Tab): Tab comes back
  // into the card instead of reaching a button of the page behind.
  await page.locator("aside [data-nav='proxies']").focus();
  await page.keyboard.press("Tab");
  await expect.poll(() => tour.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await expect(page.locator("main[data-section='profiles']")).toBeVisible();
});

test("the cut-out follows a target the page draws again", async ({ page }) => {
  await openApp(page);
  await addFixedBox(page);
  await startTour(page, [step("fixed", "profiles", "t-fixed", "A box on the right")]);
  await expect(page.getByRole("dialog", { name: "A box on the right" })).toBeVisible();
  await expectHoleAt(page, "#t-fixed");
  // A re-render that replaces the node: the old one is gone, a new one stands lower.
  await page.evaluate(() => {
    const old = document.getElementById("t-fixed")!;
    const fresh = old.cloneNode(true) as HTMLElement;
    fresh.style.top = "380px";
    old.replaceWith(fresh);
  });
  await expectHoleAt(page, "#t-fixed");
});

test("the title strip still drags the window while the tour runs", async ({ page }) => {
  await openApp(page);
  await startTour(page, [step("one", "profiles", null, "One"), step("two", "profiles", null, "Two")]);
  await expect(card(page)).toBeVisible();
  const drags = () => page.evaluate(() => (window as unknown as { __shardxMock: { windowCalls: string[] } }).__shardxMock.windowCalls.filter((c) => c.includes("start_dragging")).length);
  const before = await drags();
  // The page behind: nothing drags there.
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.up();
  expect(await drags()).toBe(before);
  await page.mouse.move(300, 12);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(drags).toBe(before + 1);
  await expect(card(page)).toContainText("1 of 2");
});

test("a lookup that is aborted ends at once", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/features/tour/index.ts", "__tour");
  const out = await page.evaluate(async () => {
    // A page that says it is busy keeps a missing element's lookup waiting until the cap (2 s).
    const busy = document.createElement("div");
    busy.setAttribute("data-loading", "");
    document.querySelector("main")!.append(busy);
    const find = (window as unknown as { __tour: { findTarget: (k: string, ms?: number, s?: AbortSignal) => Promise<HTMLElement | null> } }).__tour.findTarget;
    const abort = new AbortController();
    const t0 = performance.now();
    setTimeout(() => abort.abort(), 50);
    const el = await find("t-nowhere", 2000, abort.signal);
    const ms = performance.now() - t0;
    busy.remove();
    return { el, ms };
  });
  expect(out.el).toBeNull();
  expect(out.ms).toBeLessThan(1000);
});

test("with Reduce motion the card has no transform transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await tagOnSight(page, { "main[data-section='profiles'] [data-page-title]": "t-profiles" });
  await openApp(page);
  await startTour(page, [step("one", "profiles", "t-profiles", "Your profiles")]);
  // Landed: off its entering look (which holds every transition off for a frame).
  await expect(card(page)).toBeVisible();
  await expect(card(page)).not.toHaveAttribute("data-entering");
  const motion = () => page.evaluate(() => {
    const c = getComputedStyle(document.querySelector("[data-tour-card]")!);
    const s = getComputedStyle(document.querySelector("[data-tour-scrim]")!);
    return { card: c.transitionProperty, scrim: s.transitionProperty, scrimMs: s.transitionDuration };
  });
  // Full motion: the card scales in and the cut-out glides.
  const full = await motion();
  expect(full.card).toMatch(/scale|transform/);
  expect(full.scrim).toContain("clip-path");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(async () => (await motion()).card).toBe("opacity");
  const reduced = await motion();
  expect(reduced.scrim.includes("clip-path") && reduced.scrimMs !== "0s").toBe(false);
});

// A page change: the cut-out first lands on the page's sidebar item while the page opens,
// the card says only which page, and then the cut-out glides to the action.

/** What the layer showed at one moment: the cut-out, which beat or step was on the card, its scale and transform. */
type Seen = { t: number; cut: string | null; beat: string | null; step: string | null; scale: string; transform: string };
type Watched = { seen: Seen[]; said: string[] };

/** From now on, notes every change of the cut-out, the beat and the step (with the time and the card's
 *  scale and transform), and everything the polite live region says. */
async function watchTour(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __watched: Watched };
    w.__watched = { seen: [], said: [] };
    const note = () => {
      const scrim = document.querySelector("[data-tour-scrim]");
      const c = document.querySelector<HTMLElement>("[data-tour-card]");
      if (!scrim || !c) return;
      const style = getComputedStyle(c);
      const e = { t: performance.now(), cut: scrim.getAttribute("data-cutout"), beat: c.getAttribute("data-beat"), step: c.getAttribute("data-step"), scale: style.scale, transform: style.transform };
      const last = w.__watched.seen.at(-1);
      if (!last || last.cut !== e.cut || last.beat !== e.beat || last.step !== e.step) w.__watched.seen.push(e);
    };
    new MutationObserver(note).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-cutout", "data-beat", "data-step"] });
    const live = document.querySelector("[data-live='polite']")!;
    new MutationObserver(() => { if (live.textContent) w.__watched.said.push(live.textContent); }).observe(live, { childList: true, characterData: true, subtree: true });
  });
}
const watched = (page: Page) => page.evaluate(() => (window as unknown as { __watched: Watched }).__watched);

/** Whether a drawn cut-out ("x y w h r") sits on a rect from `holeAround`. */
const isAt = (cut: string | null, want: number[]) => !!cut && cut.split(" ").map(Number).slice(0, 4).every((v, i) => Math.abs(v - want[i]) <= 1);

/** Two pages, as the beat tests start: Profiles, then Proxies (its title is the target). `rail`: the sidebar is folded first. */
async function twoPages(page: Page, { rail = false } = {}) {
  await tagOnSight(page, {
    "main[data-section='profiles'] [data-page-title]": "t-profiles",
    "main[data-section='proxies'] [data-page-title]": "t-proxies",
  });
  await openApp(page);
  // Both pages' code is loaded before the tour starts, so a beat is its hold and not the wait for a lazy page.
  for (const section of ["proxies", "profiles"]) {
    await page.locator(`aside [data-nav='${section}']`).click();
    await expect(page.locator(`main[data-section='${section}'] [data-page-title]`)).toBeVisible();
  }
  if (rail) {
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  }
  await startTour(page, [step("one", "profiles", "t-profiles", "Your profiles"), step("two", "proxies", "t-proxies", "Your proxies")]);
  await expect(page.getByRole("dialog", { name: "Your profiles" })).toBeVisible();
  await watchTour(page);
}

test("a page change lands the cut-out on the page's sidebar item first, then on the action", async ({ page }) => {
  await twoPages(page);
  // The first step is on the page the tour is on: no beat, and its card names that page.
  await expect(card(page)).not.toHaveAttribute("data-beat");
  await expect(card(page).locator("[data-tour-page]")).toHaveText("All profiles");
  await page.getByRole("dialog", { name: "Your profiles" }).getByRole("button", { name: "Next" }).click();

  // The beat: the page's item in the sidebar in the cut-out; the card says only which page.
  await expect(card(page)).toHaveAttribute("data-beat", "proxies");
  const opening = page.getByRole("dialog", { name: "Proxies", exact: true });
  await expect(opening).toContainText("Opening Proxies");
  await expect(opening.getByRole("button")).toHaveCount(0);
  await expect(opening.locator("[data-tour-page-icon]")).toHaveCount(1);
  await expectHoleAt(page, "aside [data-nav='proxies']");

  // Then the action, and its card names the page above the step's title.
  const second = page.getByRole("dialog", { name: "Your proxies" });
  await expect(second).toContainText("2 of 2");
  await expect(card(page)).not.toHaveAttribute("data-beat");
  await expect(second.locator("[data-tour-page]")).toHaveText("Proxies");
  await expectHoleAt(page, "main[data-section='proxies'] [data-tour='t-proxies']");

  const { seen, said } = await watched(page);
  const nav = await holeAround(page, "aside [data-nav='proxies']");
  const onNav = seen.findIndex((e) => e.beat === "proxies" && isAt(e.cut, nav));
  expect(onNav, "the cut-out sat on the sidebar item during the beat").toBeGreaterThanOrEqual(0);
  expect(seen.findIndex((e) => e.step === "two"), "the step came after the beat").toBeGreaterThan(onNav);
  // A screen reader hears the page change, and then the step.
  expect(said).toContain("Proxies page");
  expect(said.indexOf("Proxies page")).toBeLessThan(said.findIndex((s) => s.startsWith("Step 2 of 2")));

  // Back is a page change too.
  await second.getByRole("button", { name: "Back" }).click();
  await expect(card(page)).toHaveAttribute("data-beat", "profiles");
  await expectHoleAt(page, "aside [data-nav='profiles']");
  await expect(page.getByRole("dialog", { name: "Your profiles" })).toContainText("1 of 2");
});

test("Next, Enter and the Right arrow during the beat skip straight to the action", async ({ page }) => {
  // Full motion: the beat holds a second, so a skip is plain to see.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await twoPages(page);
  const skipWith = async (key: string, beat: string, landed: string) => {
    await expect(card(page)).toHaveAttribute("data-beat", beat);
    const pressed = await page.evaluate(() => performance.now());
    await page.keyboard.press(key);
    await expect(card(page)).toHaveAttribute("data-step", landed);
    const { seen } = await watched(page);
    const at = seen.find((e) => e.step === landed && e.t >= pressed)!.t;
    expect(at - pressed, `${key} skipped the hold`).toBeLessThan(500);
  };
  await card(page).getByRole("button", { name: "Next" }).click();
  await skipWith("ArrowRight", "proxies", "two");
  await expectHoleAt(page, "main[data-section='proxies'] [data-tour='t-proxies']");
  await card(page).getByRole("button", { name: "Back" }).click();
  await skipWith("Enter", "profiles", "one");
  await expectHoleAt(page, "main[data-section='profiles'] [data-tour='t-profiles']");
  // Left is Back, not a skip: during a beat it does nothing.
  await card(page).getByRole("button", { name: "Next" }).click();
  await expect(card(page)).toHaveAttribute("data-beat", "proxies");
  await page.keyboard.press("ArrowLeft");
  await expect(card(page)).toHaveAttribute("data-beat", "proxies");
});

test("Esc during the beat ends the tour", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await twoPages(page);
  await card(page).getByRole("button", { name: "Next" }).click();
  await expect(card(page)).toHaveAttribute("data-beat", "proxies");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-tour-layer]")).toHaveCount(0);
  await expect(page.locator("[data-toast]").filter({ hasText: "You can replay the tour from Settings" })).toBeVisible();
  expect((await page.evaluate(() => (window as unknown as EndWindow).__tour.useTour.getState().ended))?.reason).toBe("esc");
  // The page the tour had opened stays open.
  await expect(page.locator("main[data-section='proxies']")).toBeVisible();
});

test("with the sidebar folded to its rail the beat highlights the page title", async ({ page }) => {
  await twoPages(page, { rail: true });
  await page.getByRole("dialog", { name: "Your profiles" }).getByRole("button", { name: "Next" }).click();
  await expect(card(page)).toHaveAttribute("data-beat", "proxies");
  await expectHoleAt(page, "main[data-section='proxies'] [data-page-title]");
  await expect(page.getByRole("dialog", { name: "Proxies", exact: true })).toContainText("Opening Proxies");
  await expect(page.getByRole("dialog", { name: "Your proxies" })).toBeVisible();
});

test("with full motion the cut-out glides from the item to the action in 250 ms, after a one second beat", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await twoPages(page);
  await card(page).getByRole("button", { name: "Next" }).click();
  await expect(card(page)).toHaveAttribute("data-beat", "proxies");
  const glide = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector("[data-tour-scrim]")!);
    return { property: s.transitionProperty, duration: s.transitionDuration, easing: s.transitionTimingFunction };
  });
  expect(glide).toEqual({ property: "clip-path", duration: "0.25s", easing: "cubic-bezier(0.77, 0, 0.175, 1)" });
  await expect(card(page)).toHaveAttribute("data-step", "two");
  const { seen } = await watched(page);
  expect(seen.find((e) => e.step === "two")!.t - seen.find((e) => e.beat === "proxies")!.t).toBeGreaterThanOrEqual(900);
});

test("with Reduce motion the beat has no glide and no transform: about 600 ms on the item, then the action fades in", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await twoPages(page);
  await card(page).getByRole("button", { name: "Next" }).click();
  await expect(card(page)).toHaveAttribute("data-beat", "proxies");
  // Landed: off its entering look (which holds every transition off for a frame).
  await expect(card(page)).not.toHaveAttribute("data-entering");
  const motion = () => page.evaluate(() => {
    const c = getComputedStyle(document.querySelector("[data-tour-card]")!);
    const s = getComputedStyle(document.querySelector("[data-tour-scrim]")!);
    return { card: c.transitionProperty, scrim: s.transitionProperty, scrimMs: s.transitionDuration };
  });
  // On the item: the card only fades, and the cut-out is not set to glide.
  const onItem = await motion();
  expect(onItem.card).toBe("opacity");
  expect(onItem.scrim.includes("clip-path") && onItem.scrimMs !== "0s").toBe(false);
  await expect(card(page)).toHaveAttribute("data-step", "two");
  await expect(card(page)).not.toHaveAttribute("data-entering");
  const onAction = await motion();
  expect(onAction.card).toBe("opacity");
  expect(onAction.scrim.includes("clip-path") && onAction.scrimMs !== "0s").toBe(false);
  // At no moment did the card scale or move by a transform.
  const { seen } = await watched(page);
  expect(seen.filter((e) => e.scale !== "none" || e.transform !== "none")).toEqual([]);
  expect(seen.find((e) => e.step === "two")!.t - seen.find((e) => e.beat === "proxies")!.t).toBeGreaterThanOrEqual(500);
});

test("a page run stays on its page: no beat, and its cards name the page", async ({ page }) => {
  await tagOnSight(page, { "main[data-section='proxies'] [data-page-title]": "t-proxies" });
  await openApp(page, { section: "proxies" });
  await appModule(page, "/src/features/tour/index.ts", "__tour");
  await watchTour(page);
  await page.evaluate((steps) => (window as unknown as EndWindow).__tour.useTour.getState().start(steps as Step[], "page", "proxies"),
    [step("a", "proxies", "t-proxies", "First tip"), step("b", "proxies", null, "Second tip")]);
  const first = page.getByRole("dialog", { name: "First tip" });
  await expect(first).toBeVisible();
  await expect(first.locator("[data-tour-page]")).toHaveText("Proxies");
  await first.getByRole("button", { name: "Next" }).click();
  const second = page.getByRole("dialog", { name: "Second tip" });
  await expect(second.locator("[data-tour-page]")).toHaveText("Proxies");
  const { seen, said } = await watched(page);
  expect(seen.filter((e) => e.beat !== null)).toEqual([]);
  expect(said.filter((s) => s.endsWith(" page"))).toEqual([]);
});
