// Fails when a token-backed Tailwind class used in the app or the kit's
// components compiles to no CSS: a typo, or a token that does not exist.
// Run it with `npm run check:classes`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";
import { SPACING_STEP, compareAllow, isOffScaleSize, scanRules } from "./lib/class-rules.mjs";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: a URL keeps "%20" where the path has a
// space and keeps a leading slash before a drive letter, so a checkout
// under "My Project" or on Windows looked for files that are not there.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRY = join(ROOT, "src/app/styles/index.css");
const DIRS = [join(ROOT, "src"), join(ROOT, "ui-kit/src/components")];
const SKIP_DIRS = new Set([join(ROOT, "src/dev"), join(ROOT, "src/shared/i18n")]);

// Utility roots whose values come from design tokens: a wrong name there
// renders nothing and nobody notices.
const ROOTS = "bg|text|border|ring|shadow|rounded|fill|stroke|outline|divide|from|via|to|decoration|placeholder|accent|caret";
const CANDIDATE = new RegExp(`^(?:[^\\s:]+:)*!?-?(?:${ROOTS})-[\\w.\\-/[\\]()#%]+!?$`);

// Strings that match the pattern but are not class names.
const NOT_CLASSES = new Set([]);

// Plain CSS classes (the kit's type roles such as `text-ui`, app-level
// helpers) are not Tailwind utilities, so the design system cannot compile
// them; they count as defined when a stylesheet declares them.
const STYLESHEETS = [
  join(ROOT, "ui-kit/src/styles/tokens.css"),
  ...readdirSync(join(ROOT, "src/app/styles")).map((f) => join(ROOT, "src/app/styles", f)),
];
const cssClasses = new Set();
for (const sheet of STYLESHEETS) {
  for (const m of readFileSync(sheet, "utf8").matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) cssClasses.add(m[1]);
}
const baseName = (token) => token.replace(/^(?:[^\s:]+:)*!?/, "").replace(/!$/, "");
const hasVariant = (token) => /^(?:[^\s:]+:)+/.test(token);

// Custom properties declared anywhere a class or style can reach: the kit
// tokens, the app stylesheets, Tailwind's own theme, and inline definitions
// in source (`[--x:…]` classes, `"--x":` style keys). Tailwind's internal
// `--tw-*` variables are always fine.
const declared = new Set();
for (const sheet of [...STYLESHEETS, join(ROOT, "node_modules/tailwindcss/theme.css")]) {
  for (const m of readFileSync(sheet, "utf8").matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]);
}

const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP_DIRS.has(p)) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name)) files.push(p);
  }
}
DIRS.forEach(walk);

const uses = new Map();
const varUses = new Map();
// The app's spacing steps (`gap-2`, `mt-1.5`): each must come from the
// launcher's table in index.css, not from the kit's 4 px `--spacing`.
const stepUses = new Map();
// Size steps (`size-4`, `w-56`): the app writes px (`w-[196px]`), never the kit's 4n step.
const sizeUses = new Map();
// Colored stripes down one side of a card or row read as generated filler; the
// owner banned them outright. A 1 px neutral pane divider (`border-r
// border-stroke-soft-200`) is fine: side widths and side colors are not.
const stripes = [];
const SIDE_BORDER = /^(?:[^\s:]+:)*!?border-[lrse]-(?!stroke-)[\w[\]().#%-]+!?$/;
const SIDE_STYLE = /\bborder(?:Left|Right|InlineStart|InlineEnd)(?:Color|Width)?\s*:/;
const THIN_BAR = /\babsolute\b(?=[^"'`]*\b(?:h-full|inset-y-0)\b)(?=[^"'`]*\bw-(?:px|0\.5|1|1\.5|\[[1-6]px\])(?=[\s"'`]))(?=[^"'`]*\bbg-)/;
// The same accent laid along a card's top edge. Tab underlines sit at the bottom.
const TOP_BAR = /\babsolute\b(?=[^"'`]*\b(?:inset-x-0|left-0\s+right-0)\b)(?=[^"'`]*\btop-0\b)(?=[^"'`]*\bh-(?:px|0\.5|1|\[[1-6]px\])(?=[\s"'`]))/;
for (const file of files) {
  for (const m of readFileSync(file, "utf8").matchAll(/["'\[](--[\w-]+)["']?\s*:/g)) declared.add(m[1]);
}
for (const file of files) {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    // var(--x) anywhere, and the (--x) shorthand inside class names.
    for (const m of line.matchAll(/var\((--[\w-]+)|[\w\]]-\((--[\w-]+)\)/g)) {
      const name = m[1] ?? m[2];
      if (name.startsWith("--tw-")) continue;
      if (!varUses.has(name)) varUses.set(name, new Set());
      varUses.get(name).add(`${relative(ROOT, file)}:${i + 1}`);
    }
    if (SIDE_STYLE.test(line) || THIN_BAR.test(line) || TOP_BAR.test(line)) stripes.push(`${relative(ROOT, file)}:${i + 1}`);
    // Commas, `=` and `>` stay inside tokens: they occur in arbitrary values
    // and variants such as `data-[state=open]:` or `[&>svg]:`.
    // Comments do not draw: the size guard skips them (`//`, `/* */`, `*` lines).
    const code = line.replace(/\/\*.*?\*\//g, " ").replace(/^\s*(?:\*|\/\*).*$/, "").replace(/(^|\s)\/\/\s.*$/, "$1");
    const codeTokens = new Set(code.match(/[^\s"'`{}<;]+/g) ?? []);
    for (const token of line.match(/[^\s"'`{}<;]+/g) ?? []) {
      if (SIDE_BORDER.test(token)) stripes.push(`${relative(ROOT, file)}:${i + 1}  ${token}`);
      if (!file.startsWith(join(ROOT, "ui-kit")) && isOffScaleSize(baseName(token)) && codeTokens.has(token)) {
        if (!sizeUses.has(token)) sizeUses.set(token, new Set());
        sizeUses.get(token).add(`${relative(ROOT, file)}:${i + 1}`);
      }
      if (!file.startsWith(join(ROOT, "ui-kit")) && SPACING_STEP.test(baseName(token))) {
        if (!stepUses.has(token)) stepUses.set(token, new Set());
        stepUses.get(token).add(`${relative(ROOT, file)}:${i + 1}`);
      }
      if (!CANDIDATE.test(token) || NOT_CLASSES.has(token)) continue;
      // A plain CSS class works bare; with a variant (`md:text-page-title`) it
      // compiles to nothing, so only bare ones are skipped.
      if (cssClasses.has(baseName(token)) && !hasVariant(token)) continue;
      if (!uses.has(token)) uses.set(token, new Set());
      uses.get(token).add(`${relative(ROOT, file)}:${i + 1}`);
    }
  });
}

const design = await __unstable__loadDesignSystem(readFileSync(ENTRY, "utf8"), { base: dirname(ENTRY) });
const classes = [...uses.keys()];
const css = design.candidatesToCss(classes);
const broken = classes.filter((_, i) => css[i] === null).sort();
const undeclared = [...varUses.keys()].filter((v) => !declared.has(v)).sort();
const steps = [...stepUses.keys()];
const stepCss = design.candidatesToCss(steps);
const offScale = steps.filter((_, i) => stepCss[i]?.includes("var(--spacing)")).sort();
const sizeSteps = [...sizeUses.keys()].sort();
const where = (set) => {
  const at = [...set];
  return `${at.slice(0, 3).join(", ")}${at.length > 3 ? ` +${at.length - 3}` : ""}`;
};

// Phase B design-token rules (scripts/lib/class-rules.mjs). A file listed in
// scripts/check-classes.allow.json for a rule may still break that rule; the
// lists only shrink: a listed file that is already clean fails the check too.
const allow = JSON.parse(readFileSync(join(ROOT, "scripts/check-classes.allow.json"), "utf8"));
const ruleHits = scanRules(ROOT);
const { errors: ruleErrors, stale: staleAllow } = compareAllow(ruleHits, allow);

for (const c of broken) console.log(`${c}  ${where(uses.get(c))}`);
for (const v of undeclared) console.log(`var ${v} is never declared  ${where(varUses.get(v))}`);
for (const c of offScale) console.log(`${c} is not on the launcher's spacing scale: add its step to the table in src/app/styles/index.css  ${where(stepUses.get(c))}`);
for (const c of sizeSteps) console.log(`${c} is a numeric size step: it draws at 4n px here, not its pre-grid floor(3.5 n) size; write the px (w-[196px]), or size-3.5 for a 14 px icon  ${where(sizeUses.get(c))}`);
for (const s of stripes) console.log(`side stripe (banned: colored or thick one-side borders and bars)  ${s}`);
for (const h of ruleErrors) console.log(`${h.rule}: ${h.message}  ${h.file}:${h.line}  ${h.token}`);
for (const s of staleAllow) console.log(`remove from scripts/check-classes.allow.json (the file is clean now)  ${s}`);
const failures = broken.length + undeclared.length + offScale.length + sizeSteps.length + stripes.length + ruleErrors.length + staleAllow.length;
if (failures > 0) {
  console.log(`\n${broken.length} class name(s) compile to nothing, ${undeclared.length} custom propert(ies) undeclared, ${offScale.length} spacing step(s) off the launcher's scale, ${sizeSteps.length} numeric size step(s), ${stripes.length} side stripe(s), ${ruleErrors.length} token rule break(s), ${staleAllow.length} stale allowlist entr(ies)`);
  process.exit(1);
}
console.log(`classes OK — ${classes.length} token-backed class names compile; ${steps.length} spacing steps on the launcher's scale; all ${varUses.size} custom properties used are declared; ${ruleHits.length} allowlisted token rule break(s) left`);
