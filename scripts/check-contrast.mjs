// Measures, in the light and dark themes and in each theme's "Increase
// contrast" variant:
// - at 4.5:1, the strong and sub text on every layer (canvas, surface,
//   raised, sunken; hover and active over canvas, surface and raised;
//   selected over surface; the weak fill over surface and raised; a tile, a
//   hovered row on a tile and a control on a tile; the page, a control on
//   it and a selected segment in that control)
//   and the soft text on all but the current nav item (active over canvas); the
//   primary text on the layers it sits on and on its tint; each state's text
//   on canvas, surface and raised, and on its tint and its tint-hover (badges,
//   chips, danger hovers) laid over the surface or a hovered, keyboard-active
//   or checked row; a tinted Alert's strong and sub text on each state's tint
//   and tint-hover over canvas, surface and raised; tooltip text; white on the
//   primary fill and on each state's fill (danger button, filled Alert in
//   light); a filled Alert's text on its own fill (solid in light, the state
//   tint in dark); the neutral button;
// - at 3:1, each state's base (dot, icon) on canvas and surface and on a
//   hovered, active or checked row, and on its tint over raised (AlertModal);
//   a tinted Alert's icons (state text, sub icon) on those tints; a filled
//   Alert's dismiss icon on its fill; the control edge, the focus outline and
//   the soft icon on every layer; the idle dot; each label color;
// - at 4.5:1, each label chip's text on its own tint (Folder, Tag and
//   protocol chips), over the rows and the raised layer;
// - at 4.5:1, a gray pill's text (the kit Badge's gray: sub text on the weak
//   fill) over every row it sits on, hovered, keyboard-active and checked.
//   Its dot is decoration (the word carries the state), so not here;
// - at 4.5:1, a row's gray text under the Live tint at its peak (the flash's
//   success tint, the slide-in's primary tint, over text and fill alike) on
//   every row state;
// - on the popover surface (a popover, menu or Select list; owner item 10,
//   lighter than the list tile in dark): strong and sub text at rest, hovered
//   and pressed, soft text at rest only (a hint steps up to the sub gray while
//   its row is the highlight), the primary text, each state's text and its
//   tint (also over a highlighted or pressed row), each state's base, each
//   label color, a label chip and a gray pill (also over a highlighted or
//   pressed row), the sub icon at rest, hovered and pressed, the control edge
//   and the soft icon at rest, the focus outline at rest and hovered; and the
//   dark popover is at least 0.04 OKLCH lighter than the list tile
//   (`popoverStepFailures`).
// Reads the kit tokens and the app's label palette. `npm run check:contrast`.
// Targets (overview section 2): text 4.5:1, indicators and focus 3:1.
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { contrast, oklchToSrgb, over, parseHex, srgbToOklch } from "../ui-kit/scripts/color-math.mjs";
import { declarations } from "../ui-kit/scripts/css-tokens.mjs";

/** The resolved hex of every runtime token for one theme and contrast mode. */
export function themeTokens(kitCss, appCss, theme, more = false) {
  const LIGHT = ":root", DARK = '[data-theme="dark"]';
  // The cascade of index.css, which imports tokens.css first: the static
  // @theme values (Tailwind's theme layer, under everything), then the kit's
  // light and dark blocks, then the app's. Same specificity, so source order
  // decides: an app :root value wins in dark too.
  const t = { ...declarations(kitCss, "@theme"), ...declarations(appCss, "@theme") };
  Object.assign(t, declarations(kitCss, LIGHT));
  if (theme === "dark") Object.assign(t, declarations(kitCss, DARK));
  Object.assign(t, declarations(appCss, LIGHT));
  if (theme === "dark") Object.assign(t, declarations(appCss, DARK));
  // The `prefers-contrast: more` blocks join last, kit only. Task 7 adds them
  // and sets their place in this order to match where they sit in the files.
  if (more) {
    Object.assign(t, declarations(kitCss, LIGHT, "prefers-contrast: more"));
    if (theme === "dark") Object.assign(t, declarations(kitCss, DARK, "prefers-contrast: more"));
  }
  return t;
}

const LABELS = ["blue", "violet", "magenta", "red", "orange", "yellow", "green", "sky"];
const STATES = ["error", "warning", "success", "information"];

const clip = (v) => Math.min(1, Math.max(0, v)) * 255;

/** `color-mix(in oklch, a <share>, b)` of two opaque colors, clipped to sRGB
 *  channel by channel, as the browser paints it. An achromatic color's hue
 *  is powerless, so the mix keeps the other color's (a label mixed toward
 *  black or white keeps its hue). */
export function mixOklch(a, b, share) {
  const A = srgbToOklch(a), B = srgbToOklch(b);
  const ha = A.C < 1e-4 ? B.H : A.H;
  const hb = B.C < 1e-4 ? ha : B.H;
  let turn = hb - ha;
  if (turn > 180) turn -= 360;
  else if (turn < -180) turn += 360;
  const mix = (x, y) => x * share + y * (1 - share);
  const [r, g, bl] = oklchToSrgb(mix(A.L, B.L), mix(A.C, B.C), ha + turn * (1 - share));
  return { r: clip(r), g: clip(g), b: clip(bl), a: 1 };
}

/** Every pair to measure: [name, foreground token or hex, layer, minimum]. */
export function pairs(t) {
  const c = (v) => {
    let value = v.startsWith("--") ? t[v] : v;
    // A token that points at another (`var(--x)`) reads that one, in this theme and mode.
    for (let i = 0; value?.startsWith("var(") && i < 8; i++) value = t[value.slice(4, -1).trim()];
    if (value === undefined) throw new Error(`${v} is not declared in tokens.css or index.css`);
    return parseHex(value);
  };
  const s = c("--bg-white-0"), cv = c("--bg-canvas"), r = c("--bg-raised"), pop = c("--bg-popover");
  const layers = {
    canvas: cv, surface: s, raised: r, sunken: c("--bg-sunken"),
    "hover/surface": over(c("--bg-hover"), s), "hover/raised": over(c("--bg-hover"), r), "hover/canvas": over(c("--bg-hover"), cv),
    "active/surface": over(c("--bg-active"), s), "active/raised": over(c("--bg-active"), r), "active/canvas": over(c("--bg-active"), cv),
    "selected/surface": over(c("--bg-selected"), s), "weak/surface": over(c("--bg-weak-50"), s), "weak/raised": over(c("--bg-weak-50"), r),
    // Borderless (owner, 2026-10-01) and its light flip: a tile (`--bg-tile`,
    // opaque: white on the ground in light, the weak fill over the panel in
    // dark); a hovered row on it takes the hover fill over it (the target and
    // a checked row lie over the panel: active/surface, selected/surface); a
    // field, a secondary button or a track on it (`--bg-on-tile`). The page
    // (`--bg-page`: the ground in light, the panel in dark), a control on it
    // (`--bg-on-page`) and a selected segment in that control.
    tile: c("--bg-tile"), "hover/tile": over(c("--bg-hover"), c("--bg-tile")), "on-tile": over(c("--bg-on-tile"), c("--bg-tile")),
    // A row pressed on a tile: one step darker than hover (active equals
    // hover, owner 2026-10-01; the pressed step is the active fill).
    "active/tile": over(c("--bg-active"), c("--bg-tile")),
    // A hovered row of a list tile inside another tile (the Traffic rules in
    // the editor's side panel, merge point 12): the hover fill over two
    // coats of the tile fill over the page (white on white in light, two
    // 4 % coats over the panel in dark).
    "hover/tile-in-tile": over(c("--bg-hover"), over(c("--bg-tile-fill"), over(c("--bg-tile-fill"), c("--bg-page")))),
    // A popover, menu or Select list, its highlighted row (hover equals the
    // keyboard highlight) and a pressed row.
    popover: pop, "hover/popover": over(c("--bg-hover"), pop), "active/popover": over(c("--bg-active"), pop),
    page: c("--bg-page"), "on-page": over(c("--bg-on-page"), c("--bg-page")),
    "selected/on-page": over(c("--bg-on-page-selected"), over(c("--bg-on-page"), c("--bg-page"))),
  };
  /** A percentage token (`14%`) as a 0-1 share. */
  const share = (v) => {
    const value = t[v];
    if (!/^\d+(?:\.\d+)?%$/.test(value ?? "")) throw new Error(`${v} is not a percentage in tokens.css or index.css`);
    return parseFloat(value) / 100;
  };
  const out = [];
  const on = (fg, names, min, label = fg) => { for (const n of names) out.push([`${label} on ${n}`, c(fg), layers[n], min]); };
  const lit = ["hover/popover", "active/popover"];
  const popovers = ["popover", ...lit];
  const all = Object.keys(layers).filter((n) => !popovers.includes(n));
  // On the popover: the highlight and the pressed row (`lit`) are measured for
  // strong and sub text, the sub icon and the primary text; soft text, the
  // control edge and the soft icon at rest only. On a highlighted row a hint
  // takes the sub gray, the proxy globe takes the sub icon gray
  // (ProxyFlag), a Folder or Tag chip a lighter text share
  // (--label-chip-text-highlight in index.css), and a box has its own dark
  // fill inside its edge. The focus outline is measured on both.
  on("--text-strong-950", [...all, ...popovers], 4.5);
  on("--text-sub-600", [...all, ...popovers], 4.5);
  on("--text-soft-400", ["popover"], 4.5);
  on("--stroke-control", ["popover"], 3);
  on("--icon-soft-400", ["popover"], 3);
  on("--icon-sub-600", popovers, 3);
  on("--focus", ["popover", "hover/popover"], 3);
  on("--primary-text", ["popover", "hover/popover"], 4.5);
  // The current nav item's count uses sub, not soft (NavItem): soft never sits on active/canvas.
  on("--text-soft-400", all.filter((n) => n !== "active/canvas"), 4.5);
  on("--primary-text", ["canvas", "surface", "raised", "hover/surface", "selected/surface"], 4.5);
  out.push(["--primary-text on primary tint", c("--primary-text"), over(c("--primary-tint"), s), 4.5]);
  // A badge, chip or danger hover sits on a row that may be hovered, the
  // keyboard target or checked, so its fill is laid over that row's fill.
  const rows = ["surface", "hover/surface", "active/surface", "selected/surface", "tile", "hover/tile"];
  for (const st of STATES) {
    on(`--${st}-text`, ["canvas", "surface", "raised", "popover"], 4.5);
    // A danger item's highlight is the state's tint over the popover.
    // A badge in an option row lies over the row's highlight; there its text
    // is --<state>-text-on-highlight (OptionBadgeMark).
    out.push([`--${st}-text on --${st}-tint over popover`, c(`--${st}-text`), over(c(`--${st}-tint`), pop), 4.5]);
    for (const n of lit) out.push([`--${st}-text-on-highlight on --${st}-tint over ${n}`, c(`--${st}-text-on-highlight`), over(c(`--${st}-tint`), layers[n]), 4.5]);
    for (const fill of ["tint", "tint-hover"]) {
      for (const n of rows) out.push([`--${st}-text on --${st}-${fill} over ${n}`, c(`--${st}-text`), over(c(`--${st}-${fill}`), layers[n]), 4.5]);
    }
    on(`--${st}-base`, ["canvas", ...rows, "popover"], 3);
    out.push([`--${st}-base on --${st}-tint over raised`, c(`--${st}-base`), over(c(`--${st}-tint`), r), 3]);
  }
  // The danger menu item's aimed fill is its own, lighter wash (--error-tint-menu)
  // over the popover, with its plain error text on it.
  out.push(["--error-text on --error-tint-menu over popover", c("--error-text"), over(c("--error-tint-menu"), pop), 4.5]);
  // A tinted Alert (light, lighter): title, body, status icon and dismiss
  // icon on each state's tint and tint-hover, over the layers it sits on.
  for (const st of [...STATES, "primary"]) {
    for (const fill of ["tint", "tint-hover"]) {
      for (const n of ["canvas", "surface", "raised"]) {
        const bg = over(c(`--${st}-${fill}`), layers[n]);
        for (const [fg, min] of [["--text-strong-950", 4.5], ["--text-sub-600", 4.5], ["--icon-sub-600", 3], [`--${st}-text`, 3]]) {
          out.push([`${fg} on --${st}-${fill} over ${n}`, c(fg), bg, min]);
        }
      }
    }
  }
  out.push(["--text-tooltip on --bg-tooltip", c("--text-tooltip"), c("--bg-tooltip"), 4.5]);
  out.push(["white on --color-primary-base", c("#ffffff"), c("--color-primary-base"), 4.5]);
  out.push(["white on --error-fill", c("#ffffff"), c("--error-fill"), 4.5]);
  out.push(["white on --error-fill-hover", c("#ffffff"), c("--error-fill-hover"), 4.5]);
  // The state fills with white text (a filled Alert in light): white title and body; an 80% white dismiss icon.
  for (const f of ["--warning-fill", "--success-fill", "--information-fill"]) out.push([`white on ${f}`, c("#ffffff"), c(f), 4.5]);
  for (const f of ["--color-primary-base", "--error-fill", "--warning-fill", "--success-fill", "--information-fill"]) {
    out.push([`80% white on ${f}`, over(c("#ffffffcc"), c(f)), c(f), 3]);
  }
  // A filled Alert on its own fill, over the layers it sits on: its title
  // and body (--on-alert) at 4.5, its status icon (--<state>-alert-icon) and
  // dismiss (--on-alert-soft) at 3. Solid with white in light; the state's
  // tint with the theme's text and the state's text color for the icon in
  // dark (owner, Task 14 fix round and its review).
  for (const st of [...STATES, "primary"]) {
    for (const n of ["canvas", "surface", "raised"]) {
      const bg = over(c(`--${st}-alert`), layers[n]);
      out.push([`--on-alert on --${st}-alert over ${n}`, c("--on-alert"), bg, 4.5]);
      out.push([`--${st}-alert-icon on --${st}-alert over ${n}`, c(`--${st}-alert-icon`), bg, 3]);
      out.push([`--on-alert-soft on --${st}-alert over ${n}`, over(c("--on-alert-soft"), bg), bg, 3]);
    }
  }
  // A gray pill (a last run, Never run, Not tested: Badge gray) on its row.
  for (const n of [...rows, "popover"]) out.push([`--text-sub-600 on --bg-weak-50 over ${n}`, c("--text-sub-600"), over(c("--bg-weak-50"), layers[n]), 4.5]);
  // On a highlighted or pressed popover row the pill's text is the strong gray
  // (OptionBadgeMark's gray badge; the uncolored FolderChip, index.css).
  for (const n of lit) out.push([`--text-strong-950 on --bg-weak-50 over ${n}`, c("--text-strong-950"), over(c("--bg-weak-50"), layers[n]), 4.5]);
  // A primary badge in an option row.
  out.push(["--primary-text on --primary-tint over popover", c("--primary-text"), over(c("--primary-tint"), pop), 4.5]);
  for (const n of lit) out.push([`--primary-text-on-highlight on --primary-tint over ${n}`, c("--primary-text-on-highlight"), over(c("--primary-tint"), layers[n]), 4.5]);
  // The Live tint at its peak (a started row's flash, a new row's slide-in):
  // one layer over the whole row, its gray text included, so text and fill
  // both take it. A tinted row's soft gray takes the sub gray while it lies
  // there (app.css), so the sub gray is the row's gray text then.
  for (const tint of ["--success-tint", "--primary-tint"]) {
    for (const n of rows) {
      out.push([`--text-sub-600 under ${tint} at its peak over ${n}`, over(c(tint), c("--text-sub-600")), over(c(tint), layers[n]), 4.5]);
    }
  }
  out.push(["--btn-neutral-fg on --btn-neutral-bg", c("--btn-neutral-fg"), c("--btn-neutral-bg"), 4.5]);
  out.push(["--btn-neutral-fg on --btn-neutral-bg-hover", c("--btn-neutral-fg"), c("--btn-neutral-bg-hover"), 4.5]);
  on("--stroke-control", all, 3);
  on("--focus", all, 3);
  on("--icon-soft-400", all, 3);
  on("--idle", ["canvas", "surface", "hover/surface", "active/surface", "selected/surface"], 3);
  // The current sidebar item is the active fill on the sidebar panel's white
  // (borderless, owner 2026-10-01; on the canvas before).
  for (const l of LABELS) on(`--label-${l}`, ["canvas", "surface", "hover/surface", "active/surface", "selected/surface", "weak/surface", "popover"], 3);
  // A label chip (Folder, Tag and protocol chips; `.label-chip` in
  // index.css): the hue at --label-chip-tint over the layer, under text mixed
  // from the hue toward --label-chip-ink, on a row or in Peek and menus.
  const ink = c("--label-chip-ink"), tint = share("--label-chip-tint"), text = share("--label-chip-text");
  // On a highlighted or pressed popover row the chip's text takes
  // --label-chip-text-highlight (index.css), so it holds 4.5:1 on the row's fill.
  const textLit = share("--label-chip-text-highlight");
  for (const l of LABELS) {
    const hue = c(`--label-${l}`);
    for (const n of [...rows, "raised", ...popovers]) {
      out.push([`label-chip ${l} text on its tint over ${n}`, mixOklch(hue, ink, lit.includes(n) ? textLit : text), over({ ...hue, a: tint }, layers[n]), 4.5]);
    }
  }
  return out;
}

/** Failing pairs for every theme and mode: [{ where, name, ratio, min }]. */
export function failures(kitCss, appCss) {
  const bad = [];
  for (const theme of ["light", "dark"]) {
    for (const more of [false, true]) {
      const t = themeTokens(kitCss, appCss, theme, more);
      for (const [name, fg, bg, min] of pairs(t)) {
        const ratio = contrast(fg, bg);
        if (ratio < min) bad.push({ where: `${theme}${more ? " (increase contrast)" : ""}`, name, ratio, min });
      }
    }
  }
  return bad;
}

/** The least OKLCH lightness a dark popover sits above the list tile (owner item 10). */
export const POPOVER_STEP = 0.04;

/** The popover's lightness step over the list tile in dark: [{ name, step, min }] when under POPOVER_STEP. */
export function popoverStepFailures(kitCss, appCss = "") {
  const t = themeTokens(kitCss, appCss, "dark");
  const lightness = (token) => {
    const v = t[token];
    if (v === undefined) throw new Error(`${token} is not declared in tokens.css`);
    return srgbToOklch(parseHex(v)).L;
  };
  const step = lightness("--bg-popover") - lightness("--bg-tile");
  return step >= POPOVER_STEP ? [] : [{ name: "--bg-popover over --bg-tile (dark)", step, min: POPOVER_STEP }];
}

// Run as a script (not imported): compared as real file URLs, so a path with
// spaces, a symlink or a Windows drive letter still matches. An argv[1] that
// is not a file (`node -e`, a test runner's name) means imported.
function isMain() {
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}
if (process.argv[1] && isMain()) {
  const root = new URL("..", import.meta.url);
  const kit = readFileSync(new URL("ui-kit/src/styles/tokens.css", root), "utf8");
  const app = readFileSync(new URL("src/app/styles/index.css", root), "utf8");
  const bad = failures(kit, app);
  for (const f of bad) console.log(`${f.where}: ${f.name} is ${f.ratio.toFixed(2)}:1, needs ${f.min}:1`);
  const steps = popoverStepFailures(kit, app);
  for (const f of steps) console.log(`${f.name} is ${f.step.toFixed(3)} OKLCH lighter, needs ${f.min}`);
  if (bad.length + steps.length > 0) {
    console.log(`\n${bad.length + steps.length} pair(s) below target`);
    process.exit(1);
  }
  const count = pairs(themeTokens(kit, app, "light")).length * 4;
  console.log(`contrast OK: ${count} pairs in light, dark and both "Increase contrast" variants`);
}
