import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp } from "./support/app";

// Owner feedback (2026-09-26): the Stop button was a near-white pink slab
// (`#ffebec`) with red text in the dark theme. State fills (`*-weak`/`*-soft`)
// must be dark tints of the state color in dark, not the light pastels
// (COLOR Appendix A). This checks the composited color (fill over its
// surface), not the raw token, since the fills are translucent.

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(input: string): Rgba {
  const m = input.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not a color: ${input}`);
  const [r, g, b, a = 1] = m[1].split(",").map((s) => parseFloat(s));
  return { r, g, b, a };
}

/** Composites `fg` (possibly translucent) over an opaque `bg`. */
function composite(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

/** WCAG relative luminance. */
function relLuminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two relative luminances. */
function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const bgColor = (l: Locator) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
const textColor = (l: Locator) => l.evaluate((el) => getComputedStyle(el).color);

test("dark theme: the running profile's Stop button is a dark tint, not a pastel slab", async ({ page }) => {
  await openApp(page, { theme: "dark" });
  const stopBtn = row(page, "Amazon US seller").getByRole("button", { name: "Stop" });
  await expect(stopBtn).toBeVisible();

  const surface = parseColor(await bgColor(page.getByRole("treegrid")));
  const fill = parseColor(await bgColor(stopBtn));
  const composited = composite(fill, surface);
  const bgLum = relLuminance(composited);
  expect(bgLum).toBeLessThan(0.06);

  const label = parseColor(await textColor(stopBtn));
  const ratio = contrastRatio(relLuminance(label), bgLum);
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test("dark theme: another tinted state fill (the danger menu item) is a dark tint", async ({ page }) => {
  // "Move to Trash" is a Menu item with `danger: true`: `text-error-text
  // hover:bg-error-weak`. Reachable from any Profiles row's context menu.
  await openApp(page, { theme: "dark" });
  await row(page, "Etsy craft shop").click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const item = menu.getByRole("menuitem", { name: "Move to Trash" });
  await item.hover();
  // The fill transitions in (`transition-colors duration-200`); wait for it
  // to settle before reading the computed background.
  await page.waitForTimeout(250);

  const surface = parseColor(await bgColor(menu));
  const fill = parseColor(await bgColor(item));
  const composited = composite(fill, surface);
  expect(relLuminance(composited)).toBeLessThan(0.06);
});

test("light theme: the Stop button is the error tint with the error text, 4.5:1 or better", async ({ page }) => {
  await openApp(page, { theme: "light" });
  const stopBtn = row(page, "Amazon US seller").getByRole("button", { name: "Stop" });
  await expect(stopBtn).toBeVisible();
  // The list's tile is the surface under the row (vf-f, merge point 12: the treegrid itself is clear).
  const surface = parseColor(await bgColor(page.locator("main .list-tile").first()));
  const composited = composite(parseColor(await bgColor(stopBtn)), surface);
  const label = parseColor(await textColor(stopBtn));
  // --error-text in light is #b1001b (colors.md A.3, darkened in Phase B
  // Task 2 fix round 1 to hold 4.5:1 on its tint over any row).
  expect(await textColor(stopBtn)).toBe("rgb(177, 0, 27)");
  expect(contrastRatio(relLuminance(label), relLuminance(composited))).toBeGreaterThanOrEqual(4.5);
});

// Fix round 1 (controller findings, superseded by owner feedback 5q below):
// Alert's status icon used `p.accent` (`text-{status}-base`) on top of the
// dark tints — 1.9-3.6:1, below the 3:1 WCAG 1.4.11 floor for non-text
// (icon) contrast. And the `light`/`lighter` container forced
// `dark:text-static-black` (title) and `dark:text-neutral-700`/
// `dark:text-neutral-500` (body/close) — near-black text on a dark fill
// (~1.5:1).
//
// Owner feedback 5q (2026-09-26): "don't like colors on those toasts."
// `ToastHost` renders the kit `Toast` (audit Phase C, Task 22): a neutral
// raised surface (`bg-bg-raised`, the one dialogs use; popovers and menus
// have their own, `bg-bg-popover`) in both
// themes, no tinted fill; the kind shows only in the icon (the state base
// tones, 3:1 or better on the raised surface — see below). The mock's
// `__shardxToast` hook raises one without needing a flow that produces one.
type ToastHook = { info: (t: string) => void; ok: (t: string) => void; err: (t: string) => void };
const raiseToast = (page: Page, kind: "info" | "ok" | "err", text: string) =>
  page.evaluate(
    ([k, t]) => (window as unknown as { __shardxToast: ToastHook }).__shardxToast[k as "info" | "ok" | "err"](t),
    [kind, text],
  );

// Fix round 1 (M6): the success toast was untested, and nothing asserted
// that the three kinds don't all render the same icon color.
for (const [kind, text] of [["info", "Mock info toast"], ["ok", "Mock success toast"], ["err", "Mock error toast"]] as const) {
  test(`dark theme: a ${kind} toast's icon and text are readable on its neutral surface`, async ({ page }) => {
    await openApp(page, { theme: "dark" });
    await raiseToast(page, kind, text);
    const toast = page.locator("[data-toast]").filter({ hasText: text });
    await expect(toast).toBeVisible();

    // The toast's own surface is opaque now (bg-bg-raised, no tint), so
    // compositing over `body` is a no-op here; kept so this reads the same
    // as the state-fill checks above.
    const surface = parseColor(await bgColor(page.locator("body")));
    const fill = parseColor(await bgColor(toast));
    const composited = composite(fill, surface);
    const bgLum = relLuminance(composited);

    // The status icon: the toast's first <span> (in DOM order, before the
    // Dismiss IconButton's own icon-wrapping span).
    const icon = toast.locator("span").first();
    const iconRgb = parseColor(await textColor(icon));
    expect(contrastRatio(relLuminance(iconRgb), bgLum)).toBeGreaterThanOrEqual(3);

    // The body text: the only text node Toast renders besides the icon and
    // Undo (no title, no action, since the mock hook raises a plain toast).
    const body = toast.getByText(text);
    const bodyRgb = parseColor(await textColor(body));
    expect(contrastRatio(relLuminance(bodyRgb), bgLum)).toBeGreaterThanOrEqual(4.5);
  });
}

// Fix round 1 (I3): this used to be one test looping both themes on one
// page. `openApp` only writes `shardx-ui-kit-theme` when the key is absent
// (`e2e/support/app.ts`), so the second `openApp(page, { theme: "dark" })`
// on the SAME page kept the "light" the ThemeProvider had already stored on
// the first pass — the "dark" half silently re-checked light. One test per
// theme (a fresh `page` fixture each) plus an explicit `html[data-theme]`
// check closes that hole.
for (const theme of ["light", "dark"] as const) {
  test(`${theme} theme: a toast's own background is the neutral raised surface, not a tint`, async ({ page }) => {
    await openApp(page, { theme });
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(theme);
    await raiseToast(page, "info", "Mock info toast");
    const toast = page.locator("[data-toast]").filter({ hasText: "Mock info toast" });
    await expect(toast).toBeVisible();
    const menuBg = await page.evaluate(() => {
      // The raised surface (dialogs, toasts); read the token directly rather
      // than opening one.
      const probe = document.createElement("div");
      probe.className = "bg-bg-raised";
      probe.style.position = "fixed";
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return c;
    });
    expect(await bgColor(toast)).toBe(menuBg);
  });
}

// One test per theme (fresh page each), the same I3 fix as above: reusing
// one page for both themes kept the first `openApp` call's theme.
for (const theme of ["light", "dark"] as const) {
  test(`${theme} theme: the info/success/error toast icons are pairwise different colors`, async ({ page }) => {
    await openApp(page, { theme });
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(theme);
    const colors: string[] = [];
    for (const [kind, text] of [["info", "Info x"], ["ok", "Ok x"], ["err", "Err x"]] as const) {
      await raiseToast(page, kind, text);
      const toast = page.locator("[data-toast]").filter({ hasText: text });
      await expect(toast).toBeVisible();
      colors.push(await textColor(toast.locator("span").first()));
    }
    expect(new Set(colors).size, `${theme}: ${colors.join(", ")}`).toBe(colors.length);
  });
}

// The kit Toast (audit Phase C, Task 22) draws its icon in the state's base
// tone: on the neutral raised surface (no tint under it) the base holds 3:1
// in both themes (light: --information-base #0089c9 3.9:1, --error-base
// #d81e2c 5.1:1, --success-base #149948 3.7:1 on white). The darker *-text
// tones were for the tinted Alert fills a toast no longer has.
for (const [kind, text, iconRgb] of [
  ["info", "Mock info toast", "rgb(0, 137, 201)"],
  ["err", "Mock error toast", "rgb(216, 30, 44)"],
  ["ok", "Mock success toast", "rgb(20, 153, 72)"],
] as const) {
  test(`light theme: a ${kind} toast's icon is its state's base color`, async ({ page }) => {
    await openApp(page, { theme: "light" });
    await raiseToast(page, kind, text);
    const toast = page.locator("[data-toast]").filter({ hasText: text });
    await expect(toast).toBeVisible();
    const icon = toast.locator("span").first();
    expect(await textColor(icon)).toBe(iconRgb);
  });
}
