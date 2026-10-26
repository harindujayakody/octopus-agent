// The source of every role color in tokens.css and of the label palette in the
// app (colors.md Appendix A, as retuned since: the light state colors of Task
// 2's fix round, Task 3's static fills, Task 7's "Increase contrast" values,
// the owner's dark filled Alert). tokens.css ships hex (spec: "Tokens stay in
// hex"); this file keeps the OKLCH they come from. To retune: edit L, C or H
// here, run `node ui-kit/scripts/gen-colors.mjs --write`, then
// `npm run check:contrast`. Neutrals have chroma 0 (O2: pure gray). A role
// that points at another role (`ref`) is written as `var(--that-role)`.

import { oklchToHex } from "./color-math.mjs";

/** An opaque color from OKLCH lightness (0-1), chroma and hue (degrees). */
const ok = (L, C, H) => ({ oklch: [L, C, H] });
/** `hex` at `pct` percent opacity: an overlay that works on any layer. */
const alpha = (hex, pct) => ({ hex, pct });
/** Another role's value, as `var(--token)`. */
const ref = (token) => ({ ref: token });

const BLACK = "#000000", WHITE = "#ffffff", BRAND = "#535efd"; // BRAND = oklch(0.571 0.232 273.4)

/** `top` (an overlay) laid over the opaque `base`, as one opaque color. */
const over = (top, base) => ({ over: [top, base] });
// The surfaces and overlays a list row is drawn with, and the row's fills
// made from them (owner, 2026-10-07, item 20): each state one opaque color,
// its overlay laid over what it lies on (the panel's white, or a tile), which
// the row and its pinned cells both paint (tokens.css `row-fill-*`): a
// translucent layer is dithered as it paints and can composite apart from an
// opaque twin on a display with its own color profile.
const ROW = {
  light: { white: ok(1, 0, 0), tile: ok(1, 0, 0), hover: alpha(BLACK, 5), active: alpha(BLACK, 8), selected: alpha(BRAND, 12) },
  dark: { white: ok(0.213, 0, 0), tile: ok(0.252, 0, 0), hover: alpha(WHITE, 5), active: alpha(WHITE, 9), selected: alpha(BRAND, 22) },
};
const rowFills = (r) => ({
  "--bg-row-hover": over(r.hover, r.white),
  "--bg-row-hover-tile": over(r.hover, r.tile),
  "--bg-row-active": over(r.active, r.white),
  "--bg-row-active-tile": over(r.active, r.tile),
  "--bg-row-selected": over(r.selected, r.white),
  "--bg-row-selected-hover": over(r.hover, over(r.selected, r.white)),
});

const ERROR = { light: ok(0.566, 0.215, 24.9), dark: ok(0.64, 0.2, 25.1) };
const WARNING = { light: ok(0.626, 0.15, 60.1), dark: ok(0.74, 0.1598, 60.27) };
const SUCCESS = { light: ok(0.6, 0.16, 149.9), dark: ok(0.719, 0.17, 150) };
const INFORMATION = { light: ok(0.60051, 0.13708, 239.797), dark: ok(0.699, 0.14, 240.2) };
// The state tints derive from each state's own base, so a retuned L, C or H
// moves them too (they were a repeated literal hex that could drift).
const hexOf = (c) => oklchToHex(...c.oklch);
const STATE_HEX = {
  error: { light: hexOf(ERROR.light), dark: hexOf(ERROR.dark) },
  warning: { light: hexOf(WARNING.light), dark: hexOf(WARNING.dark) },
  success: { light: hexOf(SUCCESS.light), dark: hexOf(SUCCESS.dark) },
  information: { light: hexOf(INFORMATION.light), dark: hexOf(INFORMATION.dark) },
};
const tint = (state, theme, pct) => alpha(STATE_HEX[state][theme], pct);
// Filled danger buttons and filled Alerts in light: white text at 4.5:1 or
// better (Task 3). The same in both themes.
const FILLS = {
  "--error-fill": ok(0.566, 0.215, 24.9), "--error-fill-hover": ok(0.5155, 0.1998, 24.88),
  "--warning-fill": ok(0.5494, 0.1284, 60.36), "--success-fill": ok(0.52, 0.144, 149.9), "--information-fill": ok(0.54, 0.123, 239.8),
};

/** [stylesheet ("kit" = ui-kit/src/styles/tokens.css, "app" = src/app/styles/index.css), selector, media query or null, { token: source }] */
export const SOURCES = [
  ["kit", "@theme", null, {
    "--color-primary-base": ok(0.571, 0.232, 273.4),
    "--color-primary-darker": ok(0.507, 0.232, 273.1),
    "--color-primary-dark": ok(0.467, 0.217, 272.8),
  }],
  ["kit", ":root", null, {
    // The ground: one step under #f7f7f7 (light flip, owner 2026-10-01), the
    // darkest gray where soft text on a hovered ground keeps 4.5:1.
    "--bg-canvas": ok(0.9702, 0, 0),
    "--bg-white-0": ROW.light.white,
    "--bg-raised": ok(1, 0, 0),
    "--bg-popover": ok(1, 0, 0),
    "--bg-sunken": ok(0.952, 0, 0),
    "--bg-weak-50": alpha(BLACK, 4),
    // Light flip (owner, 2026-10-01): content is white on the gray ground,
    // never gray on white. The page is the ground itself (`--bg-page`); a
    // tile is white on it (`--bg-tile-fill`; `--bg-tile` the same as one
    // opaque color, for what covers a tile's own scrolling content). A
    // control on the
    // ground rests white (`--bg-on-page`, its selected segment a gray step,
    // `--bg-on-page-selected`); on a white tile it rests at the weak fill
    // (`--bg-on-tile`). An interactive tile on the ground turns a slightly
    // dusky white on hover (`--bg-tile-hover`, #fafafa) and keeps its rest
    // shadow: no lift, no edge, never the ground's gray (owner, 2026-10-02:
    // "make white color a bit dusk, just a bit").
    "--bg-page": ref("--bg-canvas"),
    "--bg-tile": ROW.light.tile,
    "--bg-tile-fill": ok(1, 0, 0),
    "--bg-tile-hover": ok(0.9848, 0, 0),
    "--bg-on-page": ok(1, 0, 0),
    "--bg-on-page-selected": alpha(BLACK, 8),
    "--bg-on-tile": alpha(BLACK, 4),
    "--bg-control-on": ref("--bg-raised"),
    "--bg-hover": ROW.light.hover,
    "--bg-active": ROW.light.active,
    "--bg-selected": ROW.light.selected,
    ...rowFills(ROW.light),
    "--bg-tooltip": ok(0.205, 0, 0),
    "--text-strong-950": ok(0.205, 0, 0),
    "--text-sub-600": ok(0.42, 0, 0),
    "--text-soft-400": ok(0.521, 0, 0),
    "--text-disabled-300": ok(0.802, 0, 0),
    "--text-tooltip": ok(1, 0, 0),
    "--stroke-sub-300": alpha(BLACK, 14),
    "--stroke-soft-200": alpha(BLACK, 7),
    "--stroke-control": ok(0.6, 0, 0),
    "--stroke-image": alpha(BLACK, 10),
    "--icon-strong-950": ok(0.205, 0, 0),
    "--icon-sub-600": ok(0.42, 0, 0),
    "--icon-soft-400": ok(0.6, 0, 0),
    "--icon-disabled-300": ok(0.802, 0, 0),
    "--idle": ok(0.6, 0, 0),
    "--primary-text": ok(0.507, 0.232, 273.1),
    "--primary-text-on-highlight": ref("--primary-text"),
    "--primary-tint": alpha(BRAND, 12),
    "--primary-tint-hover": alpha(BRAND, 18),
    "--focus": ok(0.571, 0.232, 273.4),
    "--error-base": ERROR.light, "--error-text": ok(0.48, 0.2, 25), "--error-text-on-highlight": ref("--error-text"), "--error-tint": tint("error", "light", 12), "--error-tint-hover": tint("error", "light", 18),
    // The danger menu item, aimed at: the same wash in both themes (dark was 18%, a strong red bar in a menu).
    "--error-tint-menu": tint("error", "light", 12),
    "--warning-base": WARNING.light, "--warning-text": ok(0.484, 0.124, 60.1), "--warning-text-on-highlight": ref("--warning-text"), "--warning-tint": tint("warning", "light", 12), "--warning-tint-hover": tint("warning", "light", 18),
    "--success-base": SUCCESS.light, "--success-text": ok(0.462, 0.13, 150), "--success-text-on-highlight": ref("--success-text"), "--success-tint": tint("success", "light", 12), "--success-tint-hover": tint("success", "light", 18),
    "--information-base": INFORMATION.light, "--information-text": ok(0.47, 0.114, 239.9), "--information-text-on-highlight": ref("--information-text"), "--information-tint": tint("information", "light", 12), "--information-tint-hover": tint("information", "light", 18),
    ...FILLS,
    // A filled Alert: the solid fill, white text and an 80% white dismiss icon.
    "--error-alert": ref("--error-fill"), "--warning-alert": ref("--warning-fill"), "--success-alert": ref("--success-fill"),
    "--information-alert": ref("--information-fill"), "--primary-alert": ref("--color-primary-base"),
    "--on-alert": alpha(WHITE, 100), "--on-alert-soft": alpha(WHITE, 80),
    "--error-alert-icon": ref("--on-alert"), "--warning-alert-icon": ref("--on-alert"), "--success-alert-icon": ref("--on-alert"),
    "--information-alert-icon": ref("--on-alert"), "--primary-alert-icon": ref("--on-alert"),
    "--scrollbar-thumb": alpha(BLACK, 20),
    "--scrollbar-thumb-hover": alpha(BLACK, 30),
  }],
  ["kit", '[data-theme="dark"]', null, {
    "--bg-canvas": ok(0.182, 0, 0),
    "--bg-white-0": ROW.dark.white,
    "--bg-raised": ok(0.252, 0, 0),
    // A popover, menu or Select list (owner, 2026-10-07, item 10: it blended
    // into the list behind it): 0.073 above the list tile and 0.028 above a
    // hovered row on it. The ceiling is the soft text (#9e9e9e) at 4.5:1 on
    // the resting surface (L 0.329); hints step up to the sub gray while
    // their row is the highlight. check-contrast.mjs asserts the 0.04 step.
    "--bg-popover": ok(0.325, 0, 0),
    "--bg-sunken": ok(0.182, 0, 0),
    "--bg-weak-50": alpha(WHITE, 4),
    // Dark keeps step 1: the page a panel, a tile the weak fill on it (its
    // opaque twin #222222), a control the weak fill on the page and white 4%
    // stacking on a tile, a selected segment the raised layer.
    "--bg-page": ref("--bg-white-0"),
    "--bg-tile": ROW.dark.tile,
    "--bg-tile-fill": alpha(WHITE, 4),
    "--bg-tile-hover": alpha(WHITE, 9),
    "--bg-on-page": alpha(WHITE, 4),
    "--bg-on-page-selected": ref("--bg-control-on"),
    "--bg-on-tile": alpha(WHITE, 4),
    "--bg-control-on": alpha(WHITE, 9),
    "--bg-hover": ROW.dark.hover,
    "--bg-active": ROW.dark.active,
    "--bg-selected": ROW.dark.selected,
    ...rowFills(ROW.dark),
    "--bg-tooltip": ok(0.289, 0, 0),
    "--text-strong-950": ok(0.946, 0, 0),
    "--text-sub-600": ok(0.789, 0, 0),
    "--text-soft-400": ok(0.699, 0, 0),
    "--text-disabled-300": ok(0.559, 0, 0),
    "--text-tooltip": ok(0.946, 0, 0),
    "--stroke-sub-300": alpha(WHITE, 11),
    "--stroke-soft-200": alpha(WHITE, 6),
    "--stroke-control": ok(0.6, 0, 0),
    "--stroke-image": alpha(WHITE, 10),
    "--icon-strong-950": ok(0.946, 0, 0),
    "--icon-sub-600": ok(0.789, 0, 0),
    "--icon-soft-400": ok(0.6, 0, 0),
    "--icon-disabled-300": ok(0.559, 0, 0),
    "--idle": ok(0.6, 0, 0),
    "--primary-text": ok(0.76, 0.1228, 273.43),
    "--primary-text-on-highlight": ok(0.82, 0.1228, 273.43),
    "--primary-tint": alpha(BRAND, 22),
    "--primary-tint-hover": alpha(BRAND, 30),
    "--focus": ok(0.76, 0.1228, 273.43),
    // A badge in a highlighted or pressed popover row (OptionBadgeMark): its
    // state text a step lighter, so it holds 4.5:1 on the tint over the row's
    // fill (the row adds white 5% to 9% under the badge). Light needs none.
    "--error-base": ERROR.dark, "--error-text": ok(0.77, 0.135, 25), "--error-text-on-highlight": ok(0.825, 0.135, 25), "--error-tint": tint("error", "dark", 18), "--error-tint-hover": tint("error", "dark", 26),
    "--error-tint-menu": tint("error", "dark", 12),
    "--warning-base": WARNING.dark, "--warning-text": ok(0.8197, 0.1239, 59.69), "--warning-text-on-highlight": ok(0.86, 0.1239, 59.69), "--warning-tint": tint("warning", "dark", 18), "--warning-tint-hover": tint("warning", "dark", 26),
    "--success-base": SUCCESS.dark, "--success-text": ok(0.799, 0.149, 150.1), "--success-text-on-highlight": ok(0.835, 0.149, 150.1), "--success-tint": tint("success", "dark", 18), "--success-tint-hover": tint("success", "dark", 26),
    "--information-base": INFORMATION.dark, "--information-text": ok(0.789, 0.119, 240.2), "--information-text-on-highlight": ok(0.84, 0.119, 240.2), "--information-tint": tint("information", "dark", 18), "--information-tint-hover": tint("information", "dark", 26),
    ...FILLS,
    // A filled Alert in dark (owner): the state's tint, never a solid block, with the theme's own text.
    "--error-alert": ref("--error-tint-hover"), "--warning-alert": ref("--warning-tint-hover"), "--success-alert": ref("--success-tint-hover"),
    "--information-alert": ref("--information-tint-hover"), "--primary-alert": ref("--primary-tint-hover"),
    "--on-alert": ref("--text-strong-950"), "--on-alert-soft": ref("--icon-sub-600"),
    // Its status icon in the state's text color, as on every tinted surface.
    "--error-alert-icon": ref("--error-text"), "--warning-alert-icon": ref("--warning-text"), "--success-alert-icon": ref("--success-text"),
    "--information-alert-icon": ref("--information-text"), "--primary-alert-icon": ref("--primary-text"),
    "--scrollbar-thumb": alpha(WHITE, 18),
    "--scrollbar-thumb-hover": alpha(WHITE, 28),
  }],
  ["kit", ":root", "prefers-contrast: more", {
    "--text-sub-600": ok(0.269, 0, 0),
    "--text-soft-400": ok(0.371, 0, 0),
    "--stroke-soft-200": alpha(BLACK, 20),
  }],
  ["kit", '[data-theme="dark"]', "prefers-contrast: more", {
    "--text-sub-600": ok(0.94, 0, 0),
    "--text-soft-400": ok(0.851, 0, 0),
    "--stroke-soft-200": alpha(WHITE, 16),
  }],
  // Labels: equal L and 95% of the sRGB chroma limit per hue (COLOR-09); light
  // green sits at L 0.586 so it keeps 3:1 on the current sidebar item.
  ["app", ":root", null, {
    "--label-blue": ok(0.6, 0.1621, 250.16), "--label-violet": ok(0.6, 0.251, 302), "--label-magenta": ok(0.5993, 0.2475, 339.93),
    "--label-red": ok(0.601, 0.232, 24.9), "--label-orange": ok(0.6012, 0.1507, 50.16), "--label-yellow": ok(0.5994, 0.1166, 90.04),
    "--label-green": ok(0.5855, 0.1533, 150.05), "--label-sky": ok(0.6002, 0.1084, 225.34),
  }],
  ["app", '[data-theme="dark"]', null, {
    "--label-blue": ok(0.721, 0.144, 249.7), "--label-violet": ok(0.721, 0.168, 302), "--label-magenta": ok(0.72, 0.226, 340.1),
    "--label-red": ok(0.72, 0.165, 25.1), "--label-orange": ok(0.721, 0.181, 50.1), "--label-yellow": ok(0.7214, 0.1403, 90.09),
    "--label-green": ok(0.7207, 0.1887, 149.97), "--label-sky": ok(0.7206, 0.1293, 224.63),
  }],
];
