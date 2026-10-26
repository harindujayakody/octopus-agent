// The design-token rules `npm run check:classes` enforces on top of "every
// class compiles" (audit Phase B): roles, not shades; one type role per
// element; radius roles; a real focus outline; named transitions, and none
// beside hover-lift, which carries its own. Pure functions over source
// text, so scripts/check-classes.test.mjs can test every rule without
// Tailwind.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Class-like tokens in one string. */
export const tokensOf = (s) => s.match(/[^\s"'`{}<;]+/g) ?? [];

// One variant and its colon. A colon inside brackets belongs to the variant
// (`[&:hover]:`) or to an arbitrary property (`[color:#fff]`, not a variant).
const VARIANT = String.raw`(?:[^\s:[\]]|\[[^\]]*\])+:`;
const VARIANTS = new RegExp(`^(?:${VARIANT})*`);
/** A token's variants without their colons (`hover`, `group-hover/cell`, `data-[state=open]`). */
export const variantsOf = (token) => [...token.match(VARIANTS)[0].matchAll(new RegExp(VARIANT, "g"))].map((m) => m[0].slice(0, -1));
/** A token without its variants (`hover:`, `data-[state=open]:`) and `!`. */
export const baseOf = (token) => token.slice(token.match(VARIANTS)[0].length).replace(/^!|!$/g, "");

const PALETTE = "black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOR_UTIL = "bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|fill|stroke|from|via|to|decoration|accent|caret|divide|placeholder|shadow|inset-shadow|inset-ring";
// A hex color or a color function. `_` joins words inside brackets
// (`0_1px_#fff_inset`), so the edges are letters, not word boundaries.
const RAW_COLOR = /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z])|(?<![a-z])(?:rgba?|hsla?|oklch|oklab)\(/;
const RAW_IN_BRACKETS = new RegExp(`(?:^|-)\\[[^\\]]*(?:${RAW_COLOR.source})`);
const PALETTE_CLASS = new RegExp(`^-?(?:${COLOR_UTIL})-(?:${PALETTE})(?:-\\d{2,3})?(?:\\/(?:\\d+|\\[[^\\]]+\\]))?$`);
// A pointer or keyboard highlight: hover, focus, a selected option, a menu's
// highlighted item, also through a (named) group or peer.
const HIGHLIGHT = /^(?:(?:group|peer)-)?(?:hover|focus|focus-visible|aria-selected)(?:\/[\w-]+)?$|^data-(?:highlighted|\[highlighted\])$/;
const DISABLED = /^(?:aria-disabled|data-disabled|disabled)$/;
const FOCUS = /^(?:(?:group|peer)-)?focus(?:-visible|-within)?(?:\/[\w-]+)?$/;

/** A numeric spacing step other than 0 (`px-2`, `-mt-1`, `gap-x-2.5`): the families the launcher maps to its own table. */
export const SPACING_STEP = /^-?(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|start|end)-(?!0$)\d+(?:\.\d+)?$/;

/**
 * A numeric size step other than 0 (`size-4`, `w-56`, `min-h-20`, `max-w-10`): the app draws
 * these at 4n px from the kit's `--spacing`, but its pre-grid size was floor(3.5 n), so an app
 * site writes the px (`w-[196px]`). `size-3.5` and `w-3.5` stay: that is the 14 px icon and
 * icon slot. Kit components are exempt (they own their sizes).
 */
export const SIZE_STEP = /^-?(?:(?:min-|max-)?(?:h|w|size))-(?!0$)\d+(?:\.\d+)?$/;
export const isOffScaleSize = (base) => SIZE_STEP.test(base) && !/^(?:size|w)-3\.5$/.test(base);

/** The type roles of tokens.css (typography.md 3.2). One per element. */
export const TYPE_ROLES = [
  "text-page-title", "text-panel-title", "text-section-title", "text-section-label", "text-ui", "text-body",
  "text-field-label", "text-secondary", "text-help", "text-micro", "text-mono", "text-stat", "text-stat-sm",
];

/** A positive tracking class: Tailwind's wide steps, or an arbitrary positive value. */
const POSITIVE_TRACKING_CLASS = /^(?:tracking-(?:wide|wider|widest)|tracking-\[\+?(?:\d*\.)?\d*[1-9][^\]]*\]|\[letter-spacing:\+?(?:\d*\.)?\d*[1-9][^\]]*\])$/;
/** A positive letter-spacing in CSS (a declaration or a tracking token) or a style object. */
const POSITIVE_TRACKING_CSS = /(?:letter-spacing|--tracking[\w-]*)\s*:\s*\+?(?:\d*\.)?\d*[1-9]/;
const POSITIVE_TRACKING_STYLE = /letterSpacing\s*:\s*["'`]?\+?(?:\d*\.)?\d*[1-9]/;
const TRACKING_MESSAGE = "owner rule (2026-10-01): never positive tracking on text; Latin text tracks -0.01em to -0.02em through its type role, Chinese and monospace stay at 0";
const TRACKING_RULE = { id: "positive-tracking", message: TRACKING_MESSAGE };

/** Rules over one class token (`token`) or one whole class string (`literal`). */
export const RULES = [
  {
    id: "hover-weak",
    message: "hover and keyboard highlights use bg-bg-hover / bg-bg-active, not the weak fill (COLOR-01)",
    // A disabled control's hover that puts its resting weak fill back is no
    // highlight (the kit Button's `aria-disabled:hover:` twins, Pair 15).
    token: (t) => baseOf(t) === "bg-bg-weak-50" && variantsOf(t).some((v) => HIGHLIGHT.test(v)) && !variantsOf(t).some((v) => DISABLED.test(v)),
  },
  {
    id: "raw-color",
    message: "raw colors bypass the tokens: use a token class (COLOR-14)",
    token: (t) => RAW_IN_BRACKETS.test(baseOf(t)),
  },
  {
    id: "palette-color",
    message: "Tailwind's palette is not a theme token: use a kit token (COLOR-14)",
    token: (t) => PALETTE_CLASS.test(baseOf(t)),
  },
  {
    id: "text-size",
    message: "sizes come from the type roles, not text-[<n>px] or Tailwind's text-sm scale (TYPE-01, FEEL-11)",
    token: (t) => /^text-(?:\[\d|(?:xs|sm|base|lg|[2-9]?xl)(?:\/\S+)?$)/.test(baseOf(t)),
  },
  {
    id: "old-type",
    message: "the old type classes are gone: use a type role (typography.md 3.2)",
    token: (t) => /^text-(?:title-h[1-6]|label-(?:xl|lg|md|sm|xs)|paragraph-(?:xl|lg|md|sm|xs)|subheading-(?:md|sm|xs|2xs))$/.test(baseOf(t)),
  },
  {
    id: "two-roles",
    message: "one type role per element: two roles resolve by source order (TYPE-09)",
    literal: (s) => tokensOf(s).map(baseOf).filter((b) => TYPE_ROLES.includes(b)).length > 1,
  },
  {
    id: "radius",
    appOnly: true,
    message: "radii come from the roles: rounded-control, -surface, -dialog, -chip, -chip-sm, or rounded-full (UI-07)",
    token: (t) => /^rounded(?:-(?:[trblse]|t[lr]|b[lr]|s[se]|e[se]))?(?:-\[.*\]|-(?:xs|sm|md|lg|xl|2xl|3xl|4xl|4|6|8|10|12))?$/.test(baseOf(t)),
  },
  {
    id: "outline-none",
    message: "outline-none also hides focus in Windows contrast themes: use outline-hidden (A11Y-03)",
    token: (t) => baseOf(t) === "outline-none",
  },
  {
    id: "shadow-focus",
    message: "focus is the focus-ring outline, not a box-shadow ring (ruling 7, UI-04)",
    // `ring-*` draws a box-shadow too. `shadow-none` and `ring-0` take a
    // shadow away, and `ring-offset-*` draws nothing without a ring.
    token: (t) =>
      (variantsOf(t).some((v) => FOCUS.test(v)) && /^(?:shadow|ring)(?:-|$)/.test(baseOf(t)) && !/^(?:shadow-none|ring-0|ring-offset-)/.test(baseOf(t))) ||
      /--ring-(?:primary|error|neutral)-focus/.test(t),
  },
  {
    id: "kit-spacing-step",
    kitOnly: true,
    message: "kit components write spacing in px (px-[8px]), never as a step: the launcher draws p-, m-, gap-, space- and inset- steps on its own pre-grid scale (src/app/styles/index.css), so a step would differ between the two apps",
    token: (t) => SPACING_STEP.test(baseOf(t)),
  },
  {
    id: "transition",
    message: "name what moves: transition-hover, transition-opacity, transition-transform or transition-[…], never transition, transition-all or transition-colors (PERF-06, ruling 7)",
    token: (t) => /^(?:transition|transition-all|transition-colors)$/.test(baseOf(t)),
  },
  {
    id: "positive-tracking",
    message: TRACKING_MESSAGE,
    token: (t) => POSITIVE_TRACKING_CLASS.test(baseOf(t)),
  },
  {
    id: "lift-transition",
    message: "hover-lift carries its own transition (the fills, the lift and the shadow): drop the transition-* beside it, which Tailwind prints later and which would make the lift snap (Live layer)",
    literal: (s) => {
      const bases = tokensOf(s).map(baseOf);
      return bases.includes("hover-lift") && bases.some((b) => /^transition(?:-|$)/.test(b));
    },
  },
];

/** Rules for the app's stylesheets, over each line of a declaration (see declarationLines). */
export const CSS_RULES = [
  {
    id: "raw-color",
    message: "raw colors bypass the tokens: use var(--token) (COLOR-14)",
    line: (l) => RAW_COLOR.test(l),
  },
];

// The source lines a stylesheet's declarations cover, continuation lines of a
// multi-line value (`box-shadow:` then one shadow per line) included. Comments
// are blanked, keeping line numbers; a chunk that ends at `{` is a selector or
// an at-rule; a custom property (`--x:`) defines a token and is skipped.
function declarationLines(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const out = [];
  let start = 0;
  let line = 0;
  for (let i = 0; i <= src.length; i++) {
    if (i < src.length && !";{}".includes(src[i])) continue;
    const chunk = src.slice(start, i);
    if (src[i] !== "{" && /^\s*[\w-]+\s*:/.test(chunk) && !/^\s*--/.test(chunk)) {
      chunk.split("\n").forEach((t, k) => out.push({ line: line + k, text: t }));
    }
    line += (chunk.match(/\n/g) ?? []).length;
    start = i + 1;
  }
  return out;
}

/** Violations in one file's text: [{ rule, message, line, token }]. */
export function violationsIn(text, { css = false, kit = false, trackingOnly = false } = {}) {
  const out = [];
  const push = (r, i, token) => out.push({ rule: r.id, message: r.message, line: i + 1, token });
  const lines = text.split("\n");
  if (css) {
    if (!trackingOnly) for (const d of declarationLines(text)) for (const r of CSS_RULES) if (r.line(d.text)) push(r, d.line, lines[d.line].trim());
    // Every line, custom properties included (a `--tracking-*` token), comments blanked.
    text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).split("\n").forEach((l, i) => {
      if (POSITIVE_TRACKING_CSS.test(l)) push(TRACKING_RULE, i, lines[i].trim());
    });
    return out;
  }
  lines.forEach((line, i) => {
    if (POSITIVE_TRACKING_STYLE.test(line)) push(TRACKING_RULE, i, line.trim());
    // Class names only live in string literals (className="…", cn("…"), maps
    // of looks): comments and code around them are not checked. A template
    // literal that runs on to the next line counts up to the line's end.
    const literals = [...line.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    if ((line.match(/`/g) ?? []).length % 2 === 1) literals.push(line.slice(line.lastIndexOf("`") + 1));
    for (const s of literals) {
      for (const r of RULES) {
        if (kit && r.appOnly) continue;
        if (!kit && r.kitOnly) continue;
        if (r.literal?.(s)) push(r, i, s);
        if (r.token) for (const token of tokensOf(s)) if (r.token(token)) push(r, i, token);
      }
    }
  });
  return out;
}

const SOURCE_DIRS = ["src", "ui-kit/src/components", "ui-kit/src/lib", "ui-kit/src/theme"];
const SKIP = [/^src\/dev\//, /^src\/shared\/i18n\//, /\.test\.[jt]sx?$/];

/** Every violation in the app, the kit components and the app stylesheets: [{ file, rule, message, line, token }]. */
export function scanRules(root) {
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const rel = relative(root, p);
      if (SKIP.some((re) => re.test(rel))) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(name)) {
        for (const v of violationsIn(readFileSync(p, "utf8"), { kit: rel.startsWith("ui-kit/") })) hits.push({ file: rel, ...v });
      }
    }
  };
  for (const d of SOURCE_DIRS) walk(join(root, d));
  const styles = join(root, "src/app/styles");
  for (const name of readdirSync(styles)) {
    if (!name.endsWith(".css")) continue;
    for (const v of violationsIn(readFileSync(join(styles, name), "utf8"), { css: true })) hits.push({ file: `src/app/styles/${name}`, ...v });
  }
  // The kit's stylesheets: the tracking rule only (their tokens are hex by design).
  const kitStyles = join(root, "ui-kit/src/styles");
  for (const name of readdirSync(kitStyles)) {
    if (!name.endsWith(".css")) continue;
    for (const v of violationsIn(readFileSync(join(kitStyles, name), "utf8"), { css: true, trackingOnly: true })) hits.push({ file: `ui-kit/src/styles/${name}`, ...v });
  }
  return hits;
}

/**
 * Checks hits against scripts/check-classes.allow.json (`{ "<rule id>": [file, …] }`,
 * `_`-keys are notes): `errors` are hits in files not listed for their rule;
 * `stale` are listed files that no longer break the rule, since the lists only shrink.
 */
export function compareAllow(hits, allow) {
  const offending = new Map();
  for (const h of hits) {
    if (!offending.has(h.rule)) offending.set(h.rule, new Set());
    offending.get(h.rule).add(h.file);
  }
  const errors = hits.filter((h) => !(allow[h.rule] ?? []).includes(h.file));
  const stale = Object.entries(allow)
    .filter(([rule]) => !rule.startsWith("_"))
    .flatMap(([rule, list]) => list.filter((f) => !offending.get(rule)?.has(f)).map((f) => `${rule}: ${f}`));
  return { errors, stale };
}
