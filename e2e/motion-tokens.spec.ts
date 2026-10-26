import { expect, test, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// Audit Phase B, B5 (animations.md S1 to S3; rulings 5, 6, 7).

// A production build minifies CSS values (".97" for 0.97, ".15s" for 150ms):
// read them back in the written form.
const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const sec = /^(-?\d*\.?\d+)s$/.exec(v);
    if (sec) return `${Math.round(Number.parseFloat(sec[1]) * 1000)}ms`;
    return /^-?\./.test(v) ? v.replace(/^(-?)\./, "$10.") : v;
  }, name);

/** Elements that transition everything, the focus outline, or the ~20 properties of a bare `transition`. */
const badTransitions = (page: Page) =>
  page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const cs = getComputedStyle(el);
      if (cs.transitionDuration.split(",").every((d) => Number.parseFloat(d) === 0)) continue;
      const props = cs.transitionProperty.split(",").map((p) => p.trim());
      if (props.includes("all") || props.includes("outline-color") || props.length >= 10) {
        bad.push(`${el.tagName.toLowerCase()} "${String(el.className).slice(0, 60)}": ${cs.transitionProperty}`);
      }
    }
    return bad;
  });

/** Running animations on an element (a spinner turning, a dot pulsing). */
const running = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => el.getAnimations().filter((a) => a.playState === "running").length);

/** A number CountRoll shows and how far it is off its line, px (+ below). */
type Shown = { n: string; y: number };
type Frame = { ms: number; note: string; shown: Shown[] };

/**
 * CountRoll on the motion page, stepped one 60 Hz frame at a time (its roll
 * paused and moved by hand, so the frames are the same on any machine),
 * pressing More or Fewer at the given frames. Each frame lists every number
 * on screen, even partly, with its offset. A press is logged twice at the
 * same instant: the frame before it and the numbers right after it.
 */
const countFrames = (page: Page, presses: Record<number, "More" | "Fewer">, frames: number) =>
  page.evaluate(async ({ presses, frames }) => {
    const root = document.querySelector("[data-case='count'] [data-count-roll]")!;
    const track = root.firstElementChild as HTMLElement;
    const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("[data-case='count'] button")].find((b) => b.textContent === name)!;
    const FRAME = 1000 / 60;
    const settle = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const shown = () => {
      const t = getComputedStyle(track).transform;
      const y = t === "none" ? 0 : new DOMMatrixReadOnly(t).m42;
      const line = track.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      const all = [{ n: track.lastChild!.textContent!, y }];
      for (const copy of track.querySelectorAll<HTMLElement>("[aria-hidden='true']")) {
        if (!copy.textContent) continue;
        all.push({ n: copy.textContent, y: copy.getBoundingClientRect().top - line.top + y });
      }
      // Only what the clip lets through, even a sliver.
      return all.filter((s) => Math.abs(s.y) < box.height).map((s) => ({ n: s.n, y: Math.round(s.y * 10) / 10 }));
    };
    const log: { ms: number; note: string; shown: { n: string; y: number }[] }[] = [];
    let ms = 0;
    for (let f = 0; f <= frames; f++) {
      if (f > 0) {
        ms += FRAME;
        for (const a of root.getAnimations({ subtree: true })) {
          const end = (a.effect as KeyframeEffect).getComputedTiming().endTime as number;
          const next = (a.currentTime as number) + FRAME * a.playbackRate;
          if (next >= end || next <= 0) { a.finish(); await settle(); }
          else a.currentTime = next;
        }
      }
      log.push({ ms: Math.round(ms * 10) / 10, note: "", shown: shown() });
      const press = presses[f];
      if (press) {
        const had = new Set(root.getAnimations({ subtree: true }));
        button(press).click();
        await new Promise((done) => setTimeout(done));
        // Held where they are (a turned roll's new rate settles once it is
        // ready); a roll the press started, at its first frame.
        const now = root.getAnimations({ subtree: true });
        for (const a of now) a.pause();
        await Promise.all(now.map((a) => a.ready));
        for (const a of now) if (!had.has(a)) a.currentTime = 0;
        log.push({ ms: Math.round(ms * 10) / 10, note: press, shown: shown() });
      }
    }
    return log;
  }, { presses, frames });

/** Each number that is on screen in both of two logged lines, and how far it moved, px. */
function moves(log: Frame[]): { at: string; n: string; moved: number; press: boolean }[] {
  const out: { at: string; n: string; moved: number; press: boolean }[] = [];
  for (let i = 1; i < log.length; i++) {
    for (const s of log[i].shown) {
      const was = log[i - 1].shown.filter((b) => b.n === s.n);
      if (was.length > 0) out.push({ at: `${log[i].ms} ms ${log[i].note}`, n: s.n, moved: Math.min(...was.map((b) => Math.abs(b.y - s.y))), press: log[i].note !== "" });
    }
  }
  return out;
}

test.describe("with motion on", () => {
  test.use({ reducedMotion: "no-preference" });

  test("nothing transitions everything or the focus outline (PERF-06, ruling 7)", async ({ page }) => {
    await openApp(page);
    expect(await badTransitions(page)).toEqual([]);
    await page.locator("[role='row'][data-profile-id]").first().click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    expect(await badTransitions(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.locator("aside").getByRole("button", { name: "New folder" }).click();
    await expect(page.getByRole("dialog", { name: /New folder/ })).toBeVisible();
    expect(await badTransitions(page)).toEqual([]);
    await openApp(page, { section: "settings" });
    expect(await badTransitions(page)).toEqual([]);
  });

  test("full motion: the tokens travel and scale", async ({ page }) => {
    await openApp(page);
    expect(await token(page, "--motion-scale-in")).toBe("0.97");
    expect(await token(page, "--motion-shift")).toBe("8px");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ease-out").replace(/\s/g, "").replace(/([(,])\./g, "$10."))).toBe("cubic-bezier(0.23,1,0.32,1)");
  });

  test("the in-app switch removes travel and scale even when the OS does not", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("shardx.reduceMotion", "true"));
    await openApp(page);
    expect(await token(page, "--motion-scale-in")).toBe("1");
    expect(await token(page, "--motion-shift")).toBe("0px");
  });

  test("Live motion: the halo breathes, a card lifts 1 px, a count rolls once to the newest number, a move redirects from where it is", async ({ page }) => {
    await page.goto("/e2e/kit/motion.html");
    expect(await token(page, "--motion-lift")).toBe("1px");
    const breathe = page.locator("[data-case='breathe'] [data-halo]");
    expect(await breathe.evaluate((el) => getComputedStyle(el, "::before").animationName)).toBe("halo-breathe");
    // The in-app switch stops the loop too, not only the OS setting.
    await page.evaluate(() => { document.documentElement.dataset.reduceMotion = "true"; });
    expect(await breathe.evaluate((el) => getComputedStyle(el, "::before").animationName)).toBe("none");
    await page.evaluate(() => { delete document.documentElement.dataset.reduceMotion; });

    const card = page.locator("[data-case='lift'] > div");
    await card.hover();
    await expect.poll(() => card.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)).toBe(-1);

    // Two changes within one roll: one animation, retargeted, on the spring.
    const count = page.locator("[data-case='count'] [data-count-roll]");
    await page.evaluate(async () => {
      const more = [...document.querySelectorAll("button")].find((b) => b.textContent === "More")!;
      more.click();
      await new Promise(requestAnimationFrame);
      more.click();
    });
    const rolls = await count.evaluate((el) => el.getAnimations({ subtree: true }).map((a) => (a.effect as KeyframeEffect).getTiming().easing));
    expect(rolls).toHaveLength(1);
    expect(rolls[0]).toMatch(/^linear\(/);
    await expect(count).toHaveText("4");
    expect(await count.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);

    // animateFrom redirected mid-flight starts from where the box is, not
    // from either end, and leaves its target on the box.
    const [mid, start, kept] = await page.locator("[data-case='move'] > div").evaluate(async (el) => {
      const { animateFrom } = window as unknown as { animateFrom: (el: HTMLElement, to: Keyframe) => Animation };
      const y = (t: string) => new DOMMatrixReadOnly(t).m42;
      const down = animateFrom(el, { transform: "translateY(0px)" });
      down.pause();
      down.currentTime = 60;
      const at = y(getComputedStyle(el).transform);
      const back = animateFrom(el, { transform: "translateY(8px)" });
      const from = y(String((back.effect as KeyframeEffect).getKeyframes()[0].transform));
      await back.finished;
      await new Promise(requestAnimationFrame);
      return [at, from, el.style.transform];
    });
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(8);
    expect(start).toBeCloseTo(mid, 3);
    expect(kept).toBe("translateY(8px)");
  });

  test("CountRoll 2, 3, 4, 3 (review Focus 3's case): at every press each number on screen stays put, and none jumps as a roll ends", async ({ page }) => {
    await page.goto("/e2e/kit/motion.html");
    // 3 at the first frame; 4 three frames (50 ms) in, late in that roll;
    // back to 3 two frames (33 ms) later, early in the second roll, which
    // itself began off rest (review I2).
    const log = await countFrames(page, { 0: "More", 3: "More", 5: "Fewer" }, 24);
    if (process.env.COUNT_ROLL_FRAMES) for (const l of log) console.log(`${String(l.ms).padStart(6)} ms ${l.note.padEnd(5)} ${l.shown.map((s) => `${s.n}@${s.y}`).join("  ")}`);
    const line = await page.locator("[data-case='count'] [data-count-roll]").evaluate((el) => el.getBoundingClientRect().height);
    for (let i = 1; i < log.length; i++) {
      const before = log[i - 1], after = log[i];
      for (const s of before.shown) {
        const kept = after.shown.some((a) => a.n === s.n);
        // A press takes nothing off the screen; a number leaves only by
        // rolling out past the clip (over half a line off its line the frame before).
        if (after.note) expect(kept, `${s.n}@${s.y} at the ${after.note} press, ${after.ms} ms`).toBe(true);
        else if (!kept) expect(Math.abs(s.y), `${s.n} leaving at ${after.ms} ms`).toBeGreaterThan(line / 2);
      }
    }
    // A press moves nothing; between frames nothing leaps.
    for (const m of moves(log)) expect(m.moved, `${m.n} at ${m.at}`).toBeLessThan(m.press ? 0.5 : line * 0.6);
    // It ends on 3, on its line, alone, and the last frames only settle: no snap as the roll ends.
    expect(log.at(-1)!.shown).toEqual([{ n: "3", y: 0 }]);
    for (const m of moves(log.slice(-6))) expect(m.moved, `${m.n} at ${m.at}`).toBeLessThan(1);
  });

  test("changing the theme starts no transitions (PERF-07)", async ({ page }) => {
    await openApp(page, { section: "settings", theme: "light" });
    await page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: "Dark", exact: true }).click();
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a instanceof CSSTransition).length);
    expect(running).toBe(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme-switching", /.*/);
  });
});

test("the OS setting removes travel and scale; fades stay", async ({ page }) => {
  await openApp(page);
  expect(await token(page, "--motion-scale-in")).toBe("1");
  expect(await token(page, "--motion-nudge")).toBe("0px");
  expect(await token(page, "--motion-base")).toBe("150ms");
});

test("Live motion tokens resolve; under Reduce motion the halo stays still and nothing lifts", async ({ page }) => {
  await page.goto("/e2e/kit/motion.html");
  expect(await token(page, "--motion-flash")).toBe("400ms");
  expect(await token(page, "--motion-count")).toBe("200ms");
  expect(await token(page, "--motion-spring")).toBe("450ms");
  expect(await token(page, "--ease-spring")).toMatch(/^linear\(0, [\d., ]+, 1\)$/);
  expect(await token(page, "--motion-lift")).toBe("0px");
  // The Running dot's halo draws: a soft disc under a copy of the dot.
  const halo = page.locator("[data-case='halo'] [data-halo]");
  expect(await halo.evaluate((el) => getComputedStyle(el, "::before").content)).toBe('""');
  expect(await halo.evaluate((el) => getComputedStyle(el, "::before").backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  expect(await halo.evaluate((el) => getComputedStyle(el, "::after").backgroundColor)).toBe(await halo.evaluate((el) => getComputedStyle(el).backgroundColor));
  for (const name of ["breathe", "halo-once"]) {
    const dot = page.locator(`[data-case='${name}'] [data-halo]`);
    expect(await dot.evaluate((el) => getComputedStyle(el, "::before").animationName), name).toBe("none");
    expect(await dot.evaluate((el) => getComputedStyle(el).animationName), name).toBe("none");
  }
  // A new row fades in place, and its tint (a layer over it) still fades
  // over its second; the count swaps at once.
  expect(await page.locator("[data-case='slide-in'] > div").evaluate((el) => getComputedStyle(el).animationDuration)).toBe("0.15s");
  expect(await page.locator("[data-case='slide-in'] > div").evaluate((el) => getComputedStyle(el, "::before").animationDuration)).toBe("1s");
  const count = page.locator("[data-case='count'] [data-count-roll]");
  await page.getByRole("button", { name: "More" }).click();
  await expect(count).toHaveText("3");
  expect(await count.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  // In running text a count sits on the line's baseline, like the words around it.
  const tops = await page.locator("[data-case='count-inline'] p").evaluate((p) =>
    [p.querySelector("[data-count-roll] > span")!.lastChild!, p.querySelector(":scope > span:last-child")!.firstChild!].map((text) => {
      const glyphs = document.createRange();
      glyphs.selectNodeContents(text);
      return glyphs.getBoundingClientRect().top;
    }));
  expect(tops[0]).toBe(tops[1]);
});

test("a loading button's spinner keeps turning with Reduce motion on (ANIM-05, A11Y-20)", async ({ page }) => {
  await page.goto("/e2e/kit/overlays.html");
  await page.evaluate(() => { document.documentElement.dataset.reduceMotion = "true"; });
  const spinner = page.getByRole("button", { name: "Saving" }).locator("svg");
  await expect(spinner).toBeVisible();
  expect(await spinner.evaluate((el) => el.getAnimations().filter((a) => a.playState === "running").length)).toBeGreaterThan(0);
});

// Controller ruling (Task 15): a pending test is a busy signal, so under
// Reduce motion (the OS here, the in-app switch too) it keeps moving, never a
// still mark. The word says "Testing…". Since the Live layer's Task 6 the
// busy mark is the test pill's spinner, not a dot (merge point 3).
test("a pending test's spinner keeps turning with Reduce motion on", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.reduceMotion", "true"));
  await openApp(page, { section: "proxies" });
  await page.evaluate(() => { (window as unknown as { __shardxMockSlow: Record<string, number> }).__shardxMockSlow = { proxy_full_test: 5000 }; });
  const row = page.locator("[role='row'][data-proxy-id='px-us-2']");
  await row.hover();
  await row.getByRole("button", { name: "Test" }).click();
  await expect(row.locator("[data-cell='test']")).toContainText(/testing/i);
  expect(await running(page, "[role='row'][data-proxy-id='px-us-2'] [data-cell='test'] [data-pill='proxy-test'] .animate-spin")).toBeGreaterThan(0);
});
