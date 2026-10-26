import { openSearch } from "./search";
import { expect, type CDPSession, type Page, type Response } from "@playwright/test";
import { openApp, waitForIdle } from "./app";

/// 2,000 profiles in name order, shuffled first: the generated names arrive
/// sorted, which would make the name sort free (performance.md, "Runtime").
export async function twoThousandByName(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __shardxMockProfiles: number }).__shardxMockProfiles = 2000;
    localStorage.setItem("shardx.profiles.sort", "name-asc");
  });
  await openApp(page);
  await page.evaluate(() => {
    const m = (window as unknown as { __shardxMock: { state: { order: string[] }; save: () => void } }).__shardxMock;
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const o = m.state.order;
    for (let i = o.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [o[i], o[j]] = [o[j], o[i]];
    }
    m.save();
  });
  // `?mock=reset` has left the address; the mock writes its state on pagehide
  // and the reload reads it back, shuffled.
  await page.reload();
  await waitForIdle(page);
  await expect(page.locator("[role='row'][data-profile-id]").first()).toBeVisible();
}

/// Slows the page's CPU (1 = full speed); 4 stands in for a mid-range laptop.
export async function cpu(page: Page, rate: number): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  return cdp;
}

/// Long tasks (over 50 ms) while the page sits idle for `ms`.
export async function idleLongTasks(page: Page, ms: number) {
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[]; __longObserver?: PerformanceObserver };
    w.__long = [];
    w.__longObserver?.disconnect();
    w.__longObserver = new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__long.push(e.duration); });
    w.__longObserver.observe({ type: "longtask" });
  });
  await page.waitForTimeout(ms);
  const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
  return { count: long.length, totalMs: Math.round(long.reduce((a, b) => a + b, 0)), maxMs: Math.round(Math.max(0, ...long)) };
}

/// Script time per frame while the list scrolls `frames` frames by `step` px.
export async function scrollScriptPerFrame(page: Page, cdp: CDPSession, frames = 150, step = 72): Promise<number> {
  await cdp.send("Performance.enable");
  const script = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "ScriptDuration")!.value;
  const grid = page.getByRole("treegrid");
  await grid.evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(200);
  const before = await script();
  await grid.evaluate((el, [frames, step]) => new Promise<void>((done) => {
    let n = 0;
    const tick = () => {
      el.scrollTop += step;
      if (++n < frames) requestAnimationFrame(tick);
      else requestAnimationFrame(() => done());
    };
    requestAnimationFrame(tick);
  }), [frames, step] as const);
  const after = await script();
  return Math.round(((after - before) * 1000 / frames) * 10) / 10;
}

/// ArrowDown in the list: from the key to the rendered result (the handler
/// and React's render), p50 and max over `presses`.
export async function arrowDown(page: Page, presses = 30) {
  await page.getByRole("treegrid").evaluate((el) => { el.scrollTop = 0; });
  await page.locator("[role='row'][data-profile-id]").first().focus();
  const times = await page.evaluate(async (presses) => {
    const out: number[] = [];
    for (let i = 0; i < presses; i++) {
      const target = document.activeElement as HTMLElement;
      const t0 = performance.now();
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));
      out.push(performance.now() - t0);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    return out.sort((a, b) => a - b);
  }, presses);
  const round = (n: number) => Math.round(n * 10) / 10;
  return { p50Ms: round(times[Math.floor(times.length / 2)]), maxMs: round(times[times.length - 1]) };
}

/// ArrowDown's handlers alone: the synchronous work of the key's dispatch,
/// before React renders the result (overview section 2: under 4 ms at 4x).
export async function arrowDownHandler(page: Page, presses = 30) {
  await page.getByRole("treegrid").evaluate((el) => { el.scrollTop = 0; });
  await page.locator("[role='row'][data-profile-id]").first().focus();
  const times = await page.evaluate(async (presses) => {
    const out: number[] = [];
    for (let i = 0; i < presses; i++) {
      const target = document.activeElement as HTMLElement;
      const t0 = performance.now();
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      out.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    return out.sort((a, b) => a - b);
  }, presses);
  const round = (n: number) => Math.round(n * 10) / 10;
  return { p50Ms: round(times[Math.floor(times.length / 2)]), maxMs: round(times[times.length - 1]) };
}

/// Real key presses into the filter: how many keys took longer than a frame
/// from the press to the next paint (Event Timing reports only entries of
/// 16 ms or more), and the slowest (overview section 2: under 16 ms at 1x).
export async function filterTyping(page: Page, text: string) {
  const box = await openSearch(page);
  await box.click();
  await box.fill("");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const w = window as unknown as { __keys: number[]; __keyObserver?: PerformanceObserver };
    w.__keys = [];
    w.__keyObserver?.disconnect();
    w.__keyObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === "keydown") w.__keys.push(e.duration);
    });
    w.__keyObserver.observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
  });
  await page.keyboard.type(text, { delay: 120 });
  await page.waitForTimeout(500);
  const long = await page.evaluate(() => (window as unknown as { __keys: number[] }).__keys);
  return { keys: text.length, slow: long.filter((d) => d > 16).length, maxMs: Math.round(Math.max(0, ...long)) };
}

/// Counts React commits from the next page load on: a minimal DevTools hook,
/// installed before React loads, which React calls after every commit (in
/// development and production builds alike). Read it with `commits(page)`.
export async function countCommits(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __commits: number; __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
    w.__commits = 0;
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      isDisabled: false,
      renderers: new Map(),
      inject: () => 1,
      checkDCE: () => {},
      onCommitFiberRoot: () => { w.__commits++; },
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
    };
  });
}
export const commits = (page: Page) => page.evaluate(() => (window as unknown as { __commits: number }).__commits);

/// Peek open on the first row, then ArrowDown `presses` times: how many
/// frames showed Peek without its form (a skeleton or an empty body; PERF-14).
export async function peekBlankFrames(page: Page, presses = 10) {
  await page.getByRole("treegrid").evaluate((el) => { el.scrollTop = 0; });
  await page.locator("[role='row'][data-profile-id]").first().locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek] [data-peek-section]").first()).toBeVisible();
  await waitForIdle(page);
  await page.evaluate(() => {
    const w = window as unknown as { __blank: number; __watch: boolean };
    w.__blank = 0;
    w.__watch = true;
    const tick = () => {
      if (!w.__watch) return;
      const peek = document.querySelector("aside[data-peek]");
      if (peek && !peek.querySelector("[data-peek-section]")) w.__blank++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(400);
  }
  const blank = await page.evaluate(() => {
    const w = window as unknown as { __blank: number; __watch: boolean };
    w.__watch = false;
    return w.__blank;
  });
  await page.keyboard.press("Escape");
  // Peek stays mounted, inert, through its exit (F12a); the next step's
  // fields must not meet it.
  await expect(page.locator("aside[data-peek]")).toHaveCount(0);
  return blank;
}

/// An inline rename: from Enter to the new name in the row, in ms (PERF-13).
export async function renameShowsAfterMs(page: Page) {
  const row = page.locator("[role='row'][data-profile-id]").nth(3);
  const id = (await row.getAttribute("data-profile-id"))!;
  await row.focus();
  await page.keyboard.press("e");
  await page.getByRole("textbox", { name: "Name" }).fill("Renamed by the probe");
  await page.evaluate((id) => {
    const w = window as unknown as { __enterAt: number; __shownAt: number };
    w.__enterAt = 0;
    w.__shownAt = 0;
    document.addEventListener("keydown", (e) => { if (e.key === "Enter") w.__enterAt = performance.now(); }, { capture: true, once: true });
    // The Name cell: the row's select box is an input too.
    const check = () => {
      const el = document.querySelector(`[role='row'][data-profile-id="${id}"] [data-cell='name']`);
      if (el && !el.querySelector("input") && el.textContent?.includes("Renamed by the probe")) { w.__shownAt = performance.now(); return; }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, id);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shownAt: number }).__shownAt), { timeout: 10_000 }).toBeGreaterThan(0);
  return page.evaluate(() => {
    const w = window as unknown as { __enterAt: number; __shownAt: number };
    return Math.round(w.__shownAt - w.__enterAt);
  });
}

/// New profile in the header: from the click to the profile form open on
/// the new profile, its name filled in, in ms. Nothing is created before
/// Create profile (manual save), so the form is what must show at once.
export async function createShowsAfterMs(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __clickAt: number; __peekAt: number };
    w.__clickAt = 0;
    w.__peekAt = 0;
    document.addEventListener("click", () => { w.__clickAt = performance.now(); }, { capture: true, once: true });
    const check = () => {
      const name = document.querySelector<HTMLInputElement>("[role='dialog'] [data-profile-form] input");
      if (name && /^Profile \d+$/.test(name.value)) { w.__peekAt = performance.now(); return; }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  await page.getByRole("button", { name: "New profile" }).first().click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __peekAt: number }).__peekAt), { timeout: 10_000 }).toBeGreaterThan(0);
  const ms = await page.evaluate(() => {
    const w = window as unknown as { __clickAt: number; __peekAt: number };
    return Math.round(w.__peekAt - w.__clickAt);
  });
  await waitForIdle(page);
  // Nothing typed: Esc closes it at once, and nothing was made.
  await page.keyboard.press("Escape");
  return ms;
}

/// From Proxies back to Profiles: the click on the sidebar item to the first
/// row on screen, in ms (performance.md gap 9).
export async function backToProfilesMs(page: Page) {
  await page.locator("aside [data-nav='proxies']").click();
  await expect(page.locator("main[data-section='proxies']")).toBeVisible();
  await waitForIdle(page);
  const ms = await page.evaluate(async () => {
    const nav = document.querySelector<HTMLElement>("aside [data-nav='profiles']")!;
    const t0 = performance.now();
    nav.click();
    await new Promise<void>((done) => {
      const tick = () => (document.querySelector("main[data-section='profiles'] [role='row'][data-profile-id]") ? done() : requestAnimationFrame(tick));
      tick();
    });
    return performance.now() - t0;
  });
  return Math.round(ms);
}

/// The app's first contentful paint on a reload at a CPU `rate`, median of
/// `runs` (PERF-16). Read from an observer: the test clock
/// (`openApp`) stands in for `performance`, whose own entry lists are then
/// empty. -1 when a reload painted no content within 5 s of settling: no
/// median, and no probe left waiting for its whole timeout.
export async function firstPaintMs(page: Page, cdp: CDPSession, rate: number, runs = 5) {
  const out: number[] = [];
  for (let i = 0; i < runs; i++) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    await page.reload();
    await waitForIdle(page);
    out.push(await page.evaluate(() => new Promise<number>((done) => {
      const none = setTimeout(() => { observer.disconnect(); done(-1); }, 5_000);
      const observer = new PerformanceObserver((list) => {
        const entry = list.getEntriesByName("first-contentful-paint")[0];
        if (entry) { observer.disconnect(); clearTimeout(none); done(entry.startTime); }
      });
      observer.observe({ type: "paint", buffered: true });
    })));
  }
  if (out.includes(-1)) return -1;
  out.sort((a, b) => a - b);
  return Math.round(out[Math.floor(out.length / 2)]);
}

/// Script and style bytes a window loads until it settles (PERF-24): the
/// launcher, or a panel window addressed by `hash` ("#/?fleet=1"). A fresh
/// document with the HTTP cache off, so every file counts each time.
export async function startupBytes(page: Page, hash = "") {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.goto("about:blank");
  const sizes: Promise<{ css: boolean; n: number }>[] = [];
  const onResponse = (res: Response) => {
    const url = res.url();
    if (!/\.(js|css)(\?|$)/.test(url)) return;
    sizes.push(res.body().then((b) => ({ css: /\.css(\?|$)/.test(url), n: b.length }), () => ({ css: false, n: 0 })));
  };
  page.on("response", onResponse);
  await page.goto(`/?section=profiles${hash}`);
  await waitForIdle(page);
  await page.waitForTimeout(500);
  page.off("response", onResponse);
  const all = await Promise.all(sizes);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await cdp.detach();
  const kb = (css: boolean) => Math.round(all.filter((s) => s.css === css).reduce((a, s) => a + s.n, 0) / 1024);
  return { jsKb: kb(false), cssKb: kb(true) };
}

/// A bulk Undo over the whole view (merge point 3): `rows` rows from the top
/// (main-thread time from the click until every restore has answered, at
/// least 1.2 s; `settleMs` says how long that was)
/// (the rows a 720 px window shows)
/// go to the Trash, then Undo brings them back at once and every one of them
/// slides in with the Live layer's tint for 1 s. Main-thread time over the
/// 1.2 s after the click (CDP: tasks, style, layout and script), the slowest
/// animation frame and how many ran over 50 ms, and the click's own time to
/// its next paint (Event Timing reports 16 ms and up; 0 is under a frame).
export async function bulkUndoTint(page: Page, cdp: CDPSession, rows = 15) {
  // Back on Profiles the list puts its remembered place back once its rows
  // are in (scrollMemory). At 4x that can land after this starts, and the
  // rows below then sit off screen under the sticky header (a forced check
  // there hit Select all). So the list is moved to the top until it stays.
  await waitForIdle(page);
  await expect.poll(() => page.getByRole("treegrid").evaluate(async (el) => {
    el.scrollTop = 0;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return el.scrollTop;
  })).toBe(0);
  const list = page.locator("[role='row'][data-profile-id]");
  const bar = page.getByRole("toolbar", { name: /selected/ });
  // Start from no selection (Esc in the list clears it).
  await list.first().focus();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  for (let i = 0; i < rows; i++) await list.nth(i).locator("[data-cell='checkbox'] input").check({ force: true });
  await list.first().focus();
  // The bar counts the selection; rows scrolled out of a virtual list are not in the page.
  await expect(page.getByRole("toolbar", { name: `${rows} selected` })).toBeVisible();
  await page.keyboard.press("Delete");
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeVisible();
  await waitForIdle(page);
  await page.waitForTimeout(1200);
  await cdp.send("Performance.enable");
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __click: number[]; __undoObservers?: PerformanceObserver[] };
    w.__frames = [];
    w.__click = [];
    for (const o of w.__undoObservers ?? []) o.disconnect();
    const frames = new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__frames.push(e.duration); });
    frames.observe({ type: "long-animation-frame" });
    const click = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === "click" || e.name === "pointerup") w.__click.push(e.duration);
    });
    click.observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
    w.__undoObservers = [frames, click];
  });
  const before = await metrics();
  const clickAt = Date.now();
  await undo.click();
  await page.waitForTimeout(1200);
  // And on until every restore has answered and the rows are the
  // backend's (the mock answers each in 60 to 180 ms, one by one), so the
  // update that lands then is measured too (speed lane 2026-10-02: the
  // Undo now puts every answered row in at once, after the last answer).
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shardxMock: { pending: number } }).__shardxMock.pending), { timeout: 10_000 }).toBe(0);
  await page.waitForTimeout(300);
  const settleMs = Date.now() - clickAt;
  const after = await metrics();
  const seen = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __click: number[] };
    return { frames: w.__frames, click: w.__click };
  });
  const ms = (name: string) => Math.round((after[name] - before[name]) * 1000);
  await list.first().focus();
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
  await waitForIdle(page);
  return {
    rows,
    settleMs,
    taskMs: ms("TaskDuration"),
    styleMs: ms("RecalcStyleDuration"),
    layoutMs: ms("LayoutDuration"),
    scriptMs: ms("ScriptDuration"),
    longFrames: seen.frames.length,
    maxFrameMs: Math.round(Math.max(0, ...seen.frames)),
    clickToPaintMs: Math.round(Math.max(0, ...seen.click)),
  };
}

/// Scrolling under the header's material with its blur on (Live layer,
/// spec 7): headless Chromium here reports `prefers-reduced-transparency:
/// reduce`, which makes the header solid, so this pins `no-preference`
/// through CDP for the run, then puts the page's own media back. Script ms
/// per frame, as `scrollScriptPerFrame`, plus the frames themselves (the
/// blur costs compositor and raster time, which script time cannot see):
/// the median and 95th-percentile frame interval, and frames over 20 ms.
export async function scrollWithHeaderBlur(page: Page, cdp: CDPSession, frames = 150, step = 72) {
  return scrollWithHeader(page, cdp, "no-preference", frames, step);
}

/// The same scroll and frame reading with the header solid (`reduce`
/// pinned): the baseline the blur case's frames are judged against
/// (merge point 4), so slow frames at 4x can be put on the blur or not.
export async function scrollWithHeaderSolid(page: Page, cdp: CDPSession, frames = 150, step = 72) {
  return scrollWithHeader(page, cdp, "reduce", frames, step);
}

async function scrollWithHeader(page: Page, cdp: CDPSession, transparency: "no-preference" | "reduce", frames: number, step: number) {
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: transparency }] });
  const blur = await page.locator("[data-list-header]").first().evaluate((el) => getComputedStyle(el).backdropFilter);
  await cdp.send("Performance.enable");
  const script = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "ScriptDuration")!.value;
  // The list is a treegrid since F24 (Pair 32).
  const grid = page.getByRole("treegrid");
  await grid.evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(200);
  const before = await script();
  const stamps = await grid.evaluate((el, [frames, step]) => new Promise<number[]>((done) => {
    const out: number[] = [];
    let n = 0;
    const tick = (t: number) => {
      out.push(t);
      el.scrollTop += step;
      if (++n < frames) requestAnimationFrame(tick);
      else requestAnimationFrame((end) => { out.push(end); done(out); });
    };
    requestAnimationFrame(tick);
  }), [frames, step] as const);
  const after = await script();
  await cdp.send("Emulation.setEmulatedMedia", { features: [] });
  const gaps = stamps.slice(1).map((t, i) => t - stamps[i]).sort((a, b) => a - b);
  const at = (q: number) => Math.round(gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))] * 10) / 10;
  return {
    backdropFilter: blur,
    scriptMsPerFrame: Math.round(((after - before) * 1000 / frames) * 10) / 10,
    frameP50Ms: at(0.5),
    frameP95Ms: at(0.95),
    framesOver20Ms: gaps.filter((g) => g > 20).length,
  };
}

/// Startup: from the launcher's navigation start (the window opening) to
/// its first Profiles rows painted, median of `runs`, at a CPU `rate`
/// (speed lane 2026-10-02). A page of its own, with no test clock (it
/// stands in for `performance`), on the stored 2,000 profiles (stored on
/// the page's pagehide: a navigation away first, so they are there), the HTTP
/// cache off (every script fetched and compiled each time, as a cold start
/// does), the mock answering at once: the app's own time, not the mock's
/// 60 to 180 ms per call. "Painted": the task after the animation frame of
/// the commit that put the first row in.
export async function firstRowsMs(page: Page, rate: number, runs = 5) {
  // A context of its own (the test clock belongs to the page's context),
  // with the page's stored data: the settings and the mock's 2,000 profiles.
  const base = page.url().replace(/^(https?:\/\/[^/]+).*$/, "$1");
  const ctx = await page.context().browser()!.newContext({ storageState: await page.context().storageState(), viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    const w = window as unknown as { __firstRows: number; __shardxMockLatency: number };
    w.__shardxMockLatency = 0;
    w.__firstRows = -1;
    const observer = new MutationObserver(() => {
      if (!document.querySelector("[role='row'][data-profile-id]")) return;
      observer.disconnect();
      requestAnimationFrame(() => setTimeout(() => { w.__firstRows = performance.now(); }, 0));
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  const out: number[] = [];
  for (let i = 0; i < runs; i++) {
    await p.goto(`${base}/?section=profiles`);
    await expect.poll(() => p.evaluate(() => (window as unknown as { __firstRows: number }).__firstRows), { timeout: 30_000 }).toBeGreaterThan(0);
    out.push(await p.evaluate(() => (window as unknown as { __firstRows: number }).__firstRows));
  }
  await cdp.detach();
  await ctx.close();
  out.sort((a, b) => a - b);
  return Math.round(out[Math.floor(out.length / 2)]);
}
