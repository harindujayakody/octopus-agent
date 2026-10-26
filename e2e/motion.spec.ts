import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// Motion probes from animations.md S6: one surface at a time, a leaving
// surface takes no input, Cmd+K is there on the first frame. The suite runs
// with reduced motion; these run with motion on.
test.use({ reducedMotion: "no-preference" });

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });

// openApp fixes the test clock, which swaps requestAnimationFrame for a timer
// that does not follow painted frames: two of its "frames" can pass before the
// browser paints one. The probes count real frames with the browser's own.
type Clocked = { __pwClock?: { builtins?: { requestAnimationFrame?: typeof requestAnimationFrame } } };
type Armed = { __nativeRaf: typeof requestAnimationFrame };

/** Resolves the browser's own requestAnimationFrame once and parks it on the
 *  page as `__nativeRaf`; every probe reads it from there. With the test clock
 *  installed and no native one under it, it throws: a probe must never count
 *  fake frames without saying so. Call it before a probe (a reload loses it). */
async function armRaf(page: Page) {
  await page.evaluate(() => {
    const clock = (window as unknown as Clocked).__pwClock;
    const raf = clock ? clock.builtins?.requestAnimationFrame : window.requestAnimationFrame;
    if (typeof raf !== "function") throw new Error("no native requestAnimationFrame: the frame probes would count fake frames");
    (window as unknown as Armed).__nativeRaf = raf.bind(window);
  });
}

/** Samples `probe` in the page on every animation frame for `ms` and returns every sample. */
async function framesWhile<T>(page: Page, ms: number, probe: () => T): Promise<T[]> {
  await armRaf(page);
  return page.evaluate(([ms, src]) => new Promise<T[]>((done) => {
    const raf = (window as unknown as Armed).__nativeRaf;
    const fn = new Function(`return (${src})()`) as () => T;
    const out: T[] = [];
    const end = performance.now() + (ms as number);
    const tick = () => { out.push(fn()); if (performance.now() < end) raf(tick); else done(out); };
    raf(tick);
  }), [ms, probe.toString()] as const);
}

test("after Esc on a dialog, the next frame's pointer target is the page", async ({ page }) => {
  await openApp(page);
  const target = row(page, "FB Ads acc-01").locator("[data-cell='name']");
  const box = (await target.boundingBox())!;
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await armRaf(page);
  const hit = await page.evaluate(([x, y]) => new Promise<string>((done) => {
    const raf = (window as unknown as Armed).__nativeRaf;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    raf(() => raf(() => {
      const el = document.elementFromPoint(x, y);
      done(el?.closest("[role='row']") ? "row" : el?.outerHTML.slice(0, 80) ?? "none");
    }));
  }), [box.x + box.width / 2, box.y + box.height / 2] as const);
  expect(hit).toBe("row");
});

test("the palette hands off to the shortcut sheet: never two dialogs at once", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("keyboard shortcuts");
  const samples = framesWhile(page, 400, () =>
    [...document.querySelectorAll("[role='dialog']")].filter((d) => getComputedStyle(d).opacity !== "0").length);
  await page.keyboard.press("Enter");
  const counts = await samples;
  expect(Math.max(...counts)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});

test("the row menu hands off to the tag picker: no menu once the picker is there", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").click({ button: "right" });
  const samples = framesWhile(page, 400, () => ({
    picker: document.querySelector("[role='dialog']") !== null,
    menu: document.querySelector("[role='menu']") !== null,
  }));
  await page.getByRole("menuitem", { name: /^Edit tags/ }).click();
  const overlap = (await samples).filter((s) => s.picker && s.menu);
  expect(overlap).toHaveLength(0);
});

type FirstFrame = { held: boolean; opacity: number; scale: string };

/**
 * Runs `act` in the page and reads the dialog panel it opens: at the first
 * frame, whether its enter is still held (the starting style not yet
 * dropped); then its opacity and scale one frame into its enter. A busy
 * machine can start a composited transition a frame late, so "one frame in"
 * counts from the transition's own start, not from the key.
 */
async function firstFrame(page: Page, panel: string, act: () => void): Promise<FirstFrame> {
  await armRaf(page);
  return page.evaluate(([panel, src]) => new Promise<FirstFrame>((done) => {
    const raf = (window as unknown as Armed).__nativeRaf;
    (new Function(`return (${src})()`) as () => void)();
    raf(() => {
      const el = document.querySelector<HTMLElement>(panel);
      if (!el) { done({ held: true, opacity: -1, scale: "" }); return; }
      const held = el.hasAttribute("data-starting-style");
      void Promise.all(el.getAnimations().map((a) => a.ready)).then(() => raf(() => {
        const s = getComputedStyle(el);
        done({ held, opacity: Number(s.opacity), scale: s.scale });
      }));
    });
  }), [panel, act.toString()] as const);
}

test("Cmd+K: the palette is on screen one frame after the key", async ({ page }) => {
  await openApp(page);
  const first = await firstFrame(page, "[role='dialog'][aria-label='Command palette']", () => {
    const mac = navigator.userAgent.includes("Mac");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: mac, ctrlKey: !mac, bubbles: true }));
  });
  // The old hook held 0 for two frames; the new curve is past 40 % one frame in.
  expect(first.held).toBe(false);
  expect(first.opacity).toBeGreaterThan(0.3);
});

test("a list key pressed while a menu fades out still reaches the list", async ({ page }) => {
  await openApp(page);
  // The status cell makes the row active without starting an edit (Phase A 5d).
  await row(page, "Sandbox").locator("[data-cell='status']").click();
  if (await page.locator("aside[data-peek]").count()) await page.keyboard.press("Escape");
  await row(page, "Sandbox").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  // Both keys in one task of the page: on a busy machine a round trip between
  // them can outlast the 75 ms fade, and then the test proves nothing. React
  // commits the close in a microtask, and the row gets its focus back with
  // it; the list key follows. Sandbox is the last row, so the key goes up.
  const pressedWhileLeaving = await page.evaluate(() => new Promise<boolean>((done) => {
    const press = (key: string) =>
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    press("Escape");
    queueMicrotask(() => {
      const leaving = document.querySelector("[role='menu'][data-ending-style]") !== null;
      press("ArrowUp");
      done(leaving);
    });
  }));
  expect(pressedWhileLeaving).toBe(true);
  await expect(page.locator("[role='row'][data-active]")).toContainText("Scraper pricing");
});

/** Clicks "New folder" in the page and reads the dialog panel's opacity and scale one frame in. */
const newFolderFirstFrame = (page: Page) => firstFrame(page, "[role='dialog']", () => {
  // "New folder" since the names pass (Lane C, mp4 review M3).
  const button = [...document.querySelectorAll<HTMLButtonElement>("aside button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim())?.startsWith("New folder"))!;
  button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  button.click();
});

test("a dialog opened by the pointer grows from 0.97 and fades in", async ({ page }) => {
  await openApp(page);
  const first = await newFolderFirstFrame(page);
  expect(first.held).toBe(false);
  expect(first.opacity).toBeGreaterThan(0.2);
  expect(first.opacity).toBeLessThan(1);
  expect(first.scale).not.toBe("none");
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("a dialog still fades, but does not scale", async ({ page }) => {
    await openApp(page);
    const first = await newFolderFirstFrame(page);
    expect(first.opacity).toBeLessThan(1);
    expect(["none", "1"]).toContain(first.scale);
  });
});

/** Presses Esc in the page and says whether, one frame later, a dialog is leaving (an exit runs). */
const leavesWithExit = async (page: Page) => {
  await armRaf(page);
  return page.evaluate(() => new Promise<boolean>((done) => {
    const raf = (window as unknown as Armed).__nativeRaf;
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    raf(() => done(document.querySelector("[role='dialog'][data-ending-style], [role='alertdialog'][data-ending-style]") !== null));
  }));
};

const focusRow = async (page: Page, name: string) => {
  await row(page, name).locator("[data-cell='status']").click();
  if (await page.locator("aside[data-peek]").count()) await page.keyboard.press("Escape");
  await row(page, name).focus();
};

const OVERLAYS: { name: string; open: (page: Page) => Promise<void> }[] = [
  { name: "New folder", open: async (page) => { await page.getByRole("button", { name: "New folder" }).first().click(); } },
  { name: "Move to folder (M)", open: async (page) => { await focusRow(page, "Sandbox"); await page.keyboard.press("m"); } },
  // A proxy delete waits behind Undo now (ruling 18); emptying the Trash still asks.
  { name: "Empty Trash confirm", open: async (page) => {
    await openApp(page, { section: "trash" });
    await page.locator("main header").getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /^Empty Trash/ }).click();
  } },
  { name: "Add proxies", open: async (page) => {
    await openApp(page, { section: "proxies" });
    await page.locator("main header").getByRole("button", { name: "Add proxies" }).click();
  } },
  { name: "Extension from a link", open: async (page) => {
    await openApp(page, { section: "extensions" });
    await page.locator("main header").getByRole("button", { name: "Add extension" }).click();
    await page.getByRole("menuitem", { name: "From a link" }).click();
  } },
  { name: "Assign proxies", open: async (page) => {
    await row(page, "Sandbox").locator("[data-cell='checkbox'] input").check({ force: true });
    await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: /Change proxy/ }).click();
  } },
  { name: "Tag picker (T)", open: async (page) => { await focusRow(page, "Sandbox"); await page.keyboard.press("t"); } },
  { name: "Proxy picker (P)", open: async (page) => { await focusRow(page, "Sandbox"); await page.keyboard.press("p"); } },
];

for (const o of OVERLAYS) {
  test(`${o.name} leaves with an exit`, async ({ page }) => {
    await openApp(page);
    await o.open(page);
    await expect(page.getByRole("dialog").or(page.getByRole("alertdialog")).first()).toBeVisible();
    expect(await leavesWithExit(page)).toBe(true);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("a dismissed toast leaves with an exit and the stack glides", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const t = (window as unknown as { __shardxToast: { fail: (f: { title: string }) => void } }).__shardxToast;
    t.fail({ title: "One" }); t.fail({ title: "Two" });
  });
  // Both have risen in: a toast dismissed before its first frame shows is
  // still at opacity 0, so it has nothing to fade and goes at once.
  await expect.poll(() => page.evaluate(() => {
    const toasts = [...document.querySelectorAll<HTMLElement>("[data-toast]")];
    return toasts.length === 2 && toasts.every((el) => el.getAnimations().length === 0);
  })).toBe(true);
  await armRaf(page);
  const leaving = await page.evaluate(() => new Promise<boolean>((done) => {
    const raf = (window as unknown as Armed).__nativeRaf;
    const b = [...document.querySelectorAll<HTMLElement>("[data-toast]")][0].querySelector<HTMLButtonElement>("button[aria-label='Dismiss']")!;
    b.click();
    raf(() => done(document.querySelector("[data-toast][data-ending-style]") !== null));
  }));
  expect(leaving).toBe(true);
});
