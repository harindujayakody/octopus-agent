import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, type Theme } from "./support/app";

// Owner feedback 5i (2026-09-26, relayed by shard-64): "green dot is for
// running, but when it's not running there is no dot; let's add different
// colors dots, like idle, warning, etc." The owner's earlier rule still
// holds (Task 5f, e2e/no-dot-status.spec.ts): the dot is always
// `aria-hidden` and always sits next to the word that actually carries the
// state. This only adds color coding on top of it, through one shared
// `StatusDot` (src/shared/ui/StatusDot.tsx) and one mapping per entity
// (`profileStatus`'s `dot`, `proxyStatusDot`).
//
// Fix round 1, ruling C2: success/info/warning/error use the same
// `--color-*-text` token the Alert and toast icons use (`neutral`/`outline`
// use the idle role since audit Phase B) — one color per state everywhere, and (since
// Batch 1's fix round already darkened light's `--success-text`/
// `--warning-text` to clear 3:1 for icon-on-tint use) every tone now clears
// a flat 3:1 floor in both themes; no more documented exception.

const profileRow = (page: Page, name: string) =>
  page.locator("[role='row'][data-profile-id]").filter({ has: page.locator("[data-cell='name']").getByText(name, { exact: true }) });
const proxyRow = (page: Page, name: string) => page.locator("[role='row'][data-proxy-id]", { hasText: name });

/** Relative luminance (WCAG). `c` is 0-255 sRGB. */
function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const parseRgb = (s: string): [number, number, number, number] => {
  const m = s.match(/[\d.]+/g)!.map(Number);
  return [m[0], m[1], m[2], m[3] ?? 1];
};
/** Composites `fg` (possibly translucent) over an opaque `bg`. */
function composite(fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] {
  const [r, g, b, a] = fg;
  return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
}

/** The dot's own color (fill, or border for the outline tone) and, composited
 *  down to a fully opaque result, the surface actually painted behind it —
 *  climbing from the row upward and compositing every translucent layer
 *  found along the way (fix round 1, finding 6: the previous version
 *  stopped at the first layer with *any* alpha above 0 and then discarded
 *  that alpha entirely, so a selected row's 10%-alpha tint was measured as
 *  the pure, undiluted primary color instead of the pale tint it actually
 *  paints). */
/** Climbs from `el`'s row upward, collecting every background layer up to
 *  (and including) the first fully-opaque one, then composites them from
 *  the outermost (farthest, painted first) layer inward. */
async function compositedRowBg(el: Locator): Promise<[number, number, number]> {
  const layers = await el.evaluate((node) => {
    const alphaOf = (c: string) => { const a = c.match(/[\d.]+/g)?.[3]; return a === undefined ? 1 : Number(a); };
    const stack: string[] = [];
    let n: Element | null = node.closest("[role='row']");
    while (n) {
      const c = getComputedStyle(n).backgroundColor;
      stack.push(c);
      if (alphaOf(c) >= 1) break;
      n = n.parentElement;
    }
    if (stack.length === 0 || alphaOf(stack[stack.length - 1]) < 1) stack.push(getComputedStyle(document.body).backgroundColor);
    return stack;
  });
  let bg = parseRgb(layers[layers.length - 1]).slice(0, 3) as [number, number, number];
  for (let i = layers.length - 2; i >= 0; i--) bg = composite(parseRgb(layers[i]), bg);
  return bg;
}

async function dotContrast(dot: Locator): Promise<number> {
  const fg = await dot.evaluate((el) => {
    const cs = getComputedStyle(el);
    const filled = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
    return filled ? cs.backgroundColor : cs.borderTopColor;
  });
  const bg = await compositedRowBg(dot);
  return contrast(parseRgb(fg).slice(0, 3) as [number, number, number], bg);
}

/** Resolves a CSS color custom property to its computed `rgb()` string, via
 *  a throwaway probe element (`warning`/`info` have no dot on screen today
 *  to measure directly — see the Task 8 note in the batch report — so this
 *  reads the same token `StatusDot` would use). */
async function resolveColorVar(page: Page, cssVar: string): Promise<[number, number, number]> {
  const rgb = await page.evaluate((v) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${v})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, cssVar);
  return parseRgb(rgb).slice(0, 3) as [number, number, number];
}

async function run(page: Page, theme: Theme) {
  // -- Profiles --------------------------------------------------------
  await openApp(page, { theme });
  const running = profileRow(page, "Amazon US seller").locator("[data-cell='status']");
  const idle = profileRow(page, "Etsy craft shop").locator("[data-cell='status']"); // last run 2 days ago
  const never = profileRow(page, "Sandbox").locator("[data-cell='status']");

  const runningDot = running.locator("[aria-hidden='true'][data-tone]");
  const idleDot = idle.locator("[aria-hidden='true'][data-tone]");
  const neverDot = never.locator("[aria-hidden='true'][data-tone]");
  await expect(runningDot).toHaveAttribute("data-tone", "success");
  await expect(idleDot).toHaveAttribute("data-tone", "neutral");
  await expect(neverDot).toHaveAttribute("data-tone", "outline");
  // Every row's own word is still there, next to the dot (Task 5f's rule).
  await expect(running.locator("[data-status-label]")).toHaveText("Running");
  await expect(idle.locator("[data-status-label]")).not.toBeEmpty();
  await expect(never.locator("[data-status-label]")).toHaveText("Never run");

  // -- Contrast (Profiles): a flat 3:1 minimum (WCAG 1.4.11), against the
  // row's own composited background, read before navigating away (the
  // locators above go stale once Proxies replaces this page).
  expect(await dotContrast(runningDot), `${theme} success vs row`).toBeGreaterThanOrEqual(3.0);
  expect(await dotContrast(idleDot), `${theme} neutral vs row`).toBeGreaterThanOrEqual(3.0);
  expect(await dotContrast(neverDot), `${theme} outline vs row`).toBeGreaterThanOrEqual(3.0);

  // warning and info: not reachable through any dot on screen today (no
  // "Proxy missing" data yet, and "Testing…" is transient), so resolve
  // their token directly and measure against the same row surface.
  const rowBg = await compositedRowBg(idle);
  const warningRgb = await resolveColorVar(page, "--color-warning-text");
  const infoRgb = await resolveColorVar(page, "--color-information-text");
  expect(contrast(warningRgb, rowBg), `${theme} warning token vs row`).toBeGreaterThanOrEqual(3.0);
  expect(contrast(infoRgb, rowBg), `${theme} info token vs row`).toBeGreaterThanOrEqual(3.0);

  // -- Proxies -----------------------------------------------------------
  // Live layer (Task 6, spec 4.2): the Test result is a tinted pill whose
  // word carries the state, with no dot; its word-on-tint contrast is
  // check:contrast's and the pills test's below.
  await openApp(page, { theme, section: "proxies" });
  const result = (name: string) => proxyRow(page, name).locator("[data-cell='test'] [data-pill='proxy-test']");
  await expect(result("DC Tokyo")).toHaveAttribute("data-state", "ok");
  await expect(result("Old datacenter (expired)")).toHaveAttribute("data-state", "failed");
  await expect(result("New DC Warsaw")).toHaveAttribute("data-state", "untested");
  await expect(result("Old datacenter (expired)").locator("[data-status-label]")).toHaveText("Failed");
  await expect(result("New DC Warsaw").locator("[data-status-label]")).toHaveText("Not tested");
  await expect(proxyRow(page, "DC Tokyo").locator("[data-cell='test'] [data-tone]")).toHaveCount(0);
  // F18 (A11Y-18): a failed test leads its pill with its own mark, never a red dot.
  const failed = proxyRow(page, "Old datacenter (expired)").locator("[data-cell='test']");
  const failedMark = failed.locator("[data-failed-mark]");
  await expect(failed.locator("[data-tone]")).toHaveCount(0);
  await expect(failedMark).toBeVisible();
  expect(await dotContrast(failedMark), `${theme} error mark vs row`).toBeGreaterThanOrEqual(3.0);
}

test("status dots: color follows the state, light theme", async ({ page }) => { await run(page, "light"); });
test("status dots: color follows the state, dark theme", async ({ page }) => { await run(page, "dark"); });

test("Peek and the pinned sidebar item show the same colored dot", async ({ page }) => {
  await openApp(page);
  await profileRow(page, "Amazon US seller").locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek] [data-peek-run-status]").locator("xpath=..").locator("[data-tone]")).toHaveAttribute("data-tone", "success");
  await expect(page.locator("aside [data-pinned='a78a0eea'] [data-tone]")).toHaveAttribute("data-tone", "success");
});

// F1 (Live layer): Proxy Peek's test result is the ProxyTestPill, a word in
// its state's tint, with no dot. The Proxies row still draws a dot and a word
// until the pair that rebuilds that list adopts the pill (Pair 18 review, M7).
test("ProxyPeek shows a failed test as the test pill: the word, in its state", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await proxyRow(page, "Old datacenter").locator("[data-cell='name']").click();
  const pill = page.locator("aside[data-peek='proxy'] [data-peek-test-status]");
  await expect(pill).toHaveAttribute("data-state", "failed");
  await expect(pill.locator("[data-status-label]")).toHaveText("Failed");
});

// Fix round 1, finding 3: the palette and the pinned sidebar item go
// through `profileStatus`/`StatusDot` too, not a hard-mapped tone — one
// state, one color, everywhere, including a never-run profile (outline)
// and a running pinned item (one dot, not the old avatar corner dot plus
// the badge's).
test("Palette: a never-run profile shows the outline tone, never a filled dot", async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Sandbox");
  const option = page.getByRole("option", { name: /^Sandbox/ });
  await expect(option.locator("[data-tone]")).toHaveAttribute("data-tone", "outline");
  await expect(option).toContainText("Never run");
});

test("Pinned sidebar: a running profile shows exactly one dot", async ({ page }) => {
  await openApp(page);
  // "a78a0eea" (Amazon US seller) is pinned and running by default.
  const pinned = page.locator("aside [data-pinned='a78a0eea']");
  await expect(pinned.locator("[aria-hidden='true'][data-tone]")).toHaveCount(1);
  await expect(pinned.locator("[data-tone]")).toHaveAttribute("data-tone", "success");
  await expect(pinned).toContainText("Running");
});

// -- The Live layer's pills (Task 2, spec 4.2) ---------------------------
// One tinted pill per state, on their own test page (e2e/kit/pills.tsx)
// until the rows adopt them (Tasks 5 and 6). The word always shows: the
// lead (a dot or a spinner) is decoration only.

const pillsPage = (page: Page, theme: Theme) => page.goto(`/e2e/kit/pills.html?theme=${theme}`);
const pill = (page: Page, name: string) => page.locator(`[data-case='${name}'] [data-pill]`).first();

/** name, visible word, the token its text uses, and its lead. */
const PILLS: [string, string, string, "dot:success" | "dot:neutral" | "dot:outline" | "spinner" | null][] = [
  ["profile-running", "Running", "--success-text", "dot:success"],
  ["profile-starting", "Starting…", "--information-text", "spinner"],
  ["profile-stopping", "Stopping…", "--information-text", "spinner"],
  ["profile-failed", "Failed to start", "--error-text", null],
  ["profile-idle", "3 days ago", "--text-sub-600", "dot:neutral"],
  ["profile-never", "Never run", "--text-sub-600", "dot:outline"],
  ["profile-warning", "Proxy missing", "--warning-text", null],
  ["proxy-ok", "OK 120 ms", "--success-text", null],
  ["proxy-failed", "Failed", "--error-text", null],
  ["proxy-untested", "Not tested", "--text-sub-600", null],
  ["proxy-busy", "Testing…", "--information-text", "spinner"],
];

test("pills: each state shows its word, in its tone, with its lead", async ({ page }) => {
  await pillsPage(page, "light");
  for (const [name, word, token, lead] of PILLS) {
    const p = pill(page, name);
    await expect(p.locator("[data-status-label]"), name).toHaveText(word);
    const [color, want] = await p.evaluate((el, t) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${t})`;
      el.parentElement!.appendChild(probe);
      const out = [getComputedStyle(el).color, getComputedStyle(probe).color];
      probe.remove();
      return out;
    }, token);
    expect(color, `${name} text color`).toBe(want);
    const dots = p.locator("[data-tone]");
    const spinners = p.locator("svg[data-icon='spinner']");
    if (lead === null) {
      await expect(dots, name).toHaveCount(0);
      await expect(spinners, name).toHaveCount(0);
    } else if (lead === "spinner") {
      await expect(spinners, name).toHaveCount(1);
    } else {
      await expect(dots, name).toHaveAttribute("data-tone", lead.slice(4));
    }
  }
  // A failed test's pill leads with its own mark (F18, A11Y-18).
  await expect(pill(page, "proxy-failed").locator("[data-failed-mark]")).toHaveCount(1);
  // The Running dot carries the halo (the kit's `halo` utility draws it).
  await expect(pill(page, "profile-running").locator("[data-tone='success']")).toHaveAttribute("data-halo", "");
  // A proxy's test detail is read out with its word, never shown twice.
  await expect(pill(page, "proxy-ok").locator(".sr-only")).toHaveText("Reached in 120 ms, Sep 1, 12:00 PM");
  // Protocols: the word as the type column shows it today, on one neutral
  // chip (Lane D, 75632bc2, owner 2026-10-01): a protocol is not a state, so
  // all three share the plain Folder chip's weak fill and sub text, no hue.
  const looks = new Set<string>();
  for (const kind of ["socks5", "http", "https"]) {
    const p = pill(page, `protocol-${kind}`);
    await expect(p).toHaveText(kind.toUpperCase());
    await expect(p).not.toHaveClass(/\blabel-chip\b/);
    const [text, fill, wantText, wantFill] = await p.evaluate((el) => {
      const probe = document.createElement("span");
      el.parentElement!.appendChild(probe);
      probe.style.color = "var(--text-sub-600)";
      probe.style.backgroundColor = "var(--bg-weak-50)";
      const cs = getComputedStyle(el);
      const ps = getComputedStyle(probe);
      const out = [cs.color, cs.backgroundColor, ps.color, ps.backgroundColor];
      probe.remove();
      return out;
    });
    expect(text, `${kind} text`).toBe(wantText);
    expect(fill, `${kind} fill`).toBe(wantFill);
    looks.add(`${text} ${fill}`);
  }
  expect(looks.size).toBe(1);
});

/** A pill's word against its own fill, composited over everything under it,
 *  as the browser paints them (a 1 px canvas resolves any color syntax,
 *  oklch and color-mix included, to sRGB). */
async function pillContrast(p: Locator): Promise<number> {
  const [text, fill] = await p.evaluate((el) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const layers: string[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) layers.unshift(getComputedStyle(n).backgroundColor);
    const paint = (colors: string[]) => {
      ctx.clearRect(0, 0, 1, 1);
      for (const c of ["#fff", ...colors]) { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); }
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)] as [number, number, number];
    };
    return [paint([...layers, getComputedStyle(el).color]), paint(layers)];
  });
  return contrast(text, fill);
}

for (const theme of ["light", "dark"] as Theme[]) {
  test(`pills: every word reads at 4.5:1 on its fill (${theme})`, async ({ page }) => {
    await pillsPage(page, theme);
    const names = [...PILLS.map(([n]) => n), "protocol-socks5", "protocol-http", "protocol-https"];
    for (const name of names) expect(await pillContrast(pill(page, name)), `${theme} ${name}`).toBeGreaterThanOrEqual(4.5);
  });
}

test("pills: as tall as a Tag chip, fully rounded, a 14 px lead; protocols keep the chip radius", async ({ page }) => {
  await pillsPage(page, "light");
  const beside = page.locator("[data-case='beside-tag']");
  const status = (await beside.locator("[data-pill]").boundingBox())!;
  const tag = (await beside.locator("[data-tag]").boundingBox())!;
  expect(status.height).toBe(tag.height);
  expect(status.y).toBe(tag.y);
  const radius = (l: Locator) => l.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
  expect(await radius(pill(page, "profile-idle"))).toBeGreaterThanOrEqual(status.height / 2);
  expect(await radius(pill(page, "protocol-http"))).toBe(await radius(beside.locator("[data-tag]")));
  const slot = (await pill(page, "profile-running").locator("[data-tone]").locator("xpath=..").boundingBox())!;
  expect([slot.width, slot.height]).toEqual([14, 14]);
});
