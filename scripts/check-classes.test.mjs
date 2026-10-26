import { test } from "node:test";
import assert from "node:assert/strict";
import { compareAllow, isOffScaleSize, violationsIn } from "./lib/class-rules.mjs";

const rules = (src, opts) => violationsIn(src, opts).map((v) => v.rule);

test("hover-weak: a hover or keyboard highlight on the weak fill", () => {
  assert.deepEqual(rules(`<li className="hover:bg-bg-weak-50" />`), ["hover-weak"]);
  assert.deepEqual(rules(`cn("focus-visible:bg-bg-weak-50")`), ["hover-weak"]);
  assert.deepEqual(rules(`<span className="bg-bg-weak-50 hover:bg-bg-hover" />`), []);
  // A disabled button's hover that keeps its resting weak fill is not a highlight.
  assert.deepEqual(rules(`"bg-bg-weak-50 hover:bg-bg-active aria-disabled:hover:bg-bg-weak-50 data-disabled:hover:bg-bg-weak-50"`), []);
});

test("hover-weak: through named groups, peers, stacked variants and a highlighted item", () => {
  assert.deepEqual(rules(`"group-hover/cell:bg-bg-weak-50 peer-hover:bg-bg-weak-50 hover:dark:bg-bg-weak-50"`), ["hover-weak", "hover-weak", "hover-weak"]);
  assert.deepEqual(rules(`"data-[highlighted]:bg-bg-weak-50 data-highlighted:bg-bg-weak-50"`), ["hover-weak", "hover-weak"]);
  assert.deepEqual(rules(`"dark:bg-bg-weak-50 data-[state=open]:bg-bg-weak-50 group-hover/cell:to-bg-weak-50"`), []);
});

test("raw-color: hex, rgb, hsl and oklch inside a class", () => {
  assert.deepEqual(rules(`"bg-[#FF990029]"`), ["raw-color"]);
  assert.deepEqual(rules(`"shadow-[inset_0_0_0_1px_#00000033]"`), ["raw-color"]);
  assert.deepEqual(rules(`"dark:bg-[rgb(0,0,0)]"`), ["raw-color"]);
  assert.deepEqual(rules(`"text-[oklch(0.5_0.1_20)]"`), ["raw-color"]);
  assert.deepEqual(rules(`"shadow-[var(--shadow-md)] bg-[var(--btn-neutral-bg)]"`), []);
});

test("raw-color: a color after `_`, and an arbitrary property", () => {
  assert.deepEqual(rules(`"shadow-[0_1px_2px_rgba(0,0,0,0.1)] shadow-[0_0_0_1px_#fff_inset]"`), ["raw-color", "raw-color"]);
  assert.deepEqual(rules(`"[color:#fff] hover:[background:hsl(0_0%_100%)]"`), ["raw-color", "raw-color"]);
  assert.deepEqual(rules(`"[mask-image:linear-gradient(black,transparent)] data-[state=open]:bg-bg-hover"`), []);
});

test("raw-color in a stylesheet: only outside custom properties", () => {
  assert.deepEqual(rules("  color: #fff;", { css: true }), ["raw-color"]);
  assert.deepEqual(rules("  --label-blue: #1783dc;", { css: true }), []);
  assert.deepEqual(rules("  background: var(--scrollbar-thumb);", { css: true }), []);
});

test("raw-color in a stylesheet: rgba, hsl, oklch and oklab", () => {
  assert.deepEqual(rules("  background: rgba(0, 0, 0, 0.5);", { css: true }), ["raw-color"]);
  assert.deepEqual(rules("  color: hsl(0 0% 100%);", { css: true }), ["raw-color"]);
  assert.deepEqual(rules("  color: oklch(0.5 0.1 20);\n  fill: oklab(0.5 0.1 0.1);", { css: true }), ["raw-color", "raw-color"]);
});

test("raw-color in a stylesheet: continuation lines of a declaration, not of a custom property or a comment", () => {
  const css = "a {\n  box-shadow:\n    0 0 0 1px var(--x),\n    0 1px 2px rgba(0, 0, 0, 0.1);\n}";
  assert.deepEqual(violationsIn(css, { css: true }).map((v) => [v.rule, v.line]), [["raw-color", 4]]);
  assert.deepEqual(rules(":root {\n  --shadow: 0 0 1px #fff,\n    0 1px 2px rgba(0, 0, 0, 0.1);\n}", { css: true }), []);
  assert.deepEqual(rules("/* was color: #fff,\n   then rgba(0, 0, 0, 0.1) */\na:hover,\nb {\n  color: var(--x);\n}", { css: true }), []);
});

test("palette-color: Tailwind's palette, not the kit's tokens", () => {
  assert.deepEqual(rules(`"hover:bg-red-600"`), ["palette-color"]);
  assert.deepEqual(rules(`"ring-black/10"`), ["palette-color"]);
  assert.deepEqual(rules(`"dark:text-neutral-700"`), ["palette-color"]);
  assert.deepEqual(rules(`"bg-bg-white-0 text-text-white-0 bg-transparent bg-current ring-stroke-soft-200"`), []);
  assert.deepEqual(rules(`"bg-black/[.08]"`), ["palette-color"]);
});

test("text-size and old-type", () => {
  assert.deepEqual(rules(`"text-[11px] leading-4"`), ["text-size"]);
  assert.deepEqual(rules(`"max-sm:text-[16px] text-sm text-2xl"`), ["text-size", "text-size", "text-size"]);
  assert.deepEqual(rules(`"text-sm/5"`), ["text-size"]);
  assert.deepEqual(rules(`"text-label-sm text-paragraph-xs text-subheading-2xs text-title-h6"`), ["old-type", "old-type", "old-type", "old-type"]);
  assert.deepEqual(rules(`"text-ui text-text-sub-600 text-[var(--x)] text-center"`), []);
});

test("two-roles: two type roles in one class string", () => {
  assert.deepEqual(rules(`<p className="text-ui text-secondary" />`), ["two-roles"]);
  assert.deepEqual(rules(`cn("text-ui", cond ? "text-secondary" : "")`), []);
  assert.deepEqual(rules(`<p className="text-help measure text-text-sub-600" />`), []);
});

test("radius: roles or rounded-full only, and only outside the kit", () => {
  assert.deepEqual(rules(`"rounded-lg rounded-[10px] rounded rounded-12 rounded-t-md"`), ["radius", "radius", "radius", "radius", "radius"]);
  assert.deepEqual(rules(`"rounded-control rounded-surface rounded-dialog rounded-chip rounded-chip-sm rounded-full rounded-none rounded-t-surface"`), []);
  assert.deepEqual(rules(`"rounded-lg"`, { kit: true }), []);
});

test("kit-spacing-step: kit components write spacing in px, the app writes steps", () => {
  assert.deepEqual(rules(`"px-2 -mt-1 gap-x-2.5 space-y-0.5 inset-x-1 top-0.5 hover:p-4"`, { kit: true }), Array(7).fill("kit-spacing-step"));
  assert.deepEqual(rules(`"px-[8px] -mt-[4px] p-0 inset-0 px-inset-side gap-stack-sm h-2 size-3.5 w-10 translate-y-2"`, { kit: true }), []);
  assert.deepEqual(rules(`"px-2 gap-1.5"`), []);
});

test("kit: true skips only radius", () => {
  const all = `"hover:bg-bg-weak-50 bg-[#fff] bg-red-500 text-sm text-label-sm rounded-lg outline-none focus-visible:ring-2 transition"`;
  assert.deepEqual(rules(all), ["hover-weak", "raw-color", "palette-color", "text-size", "old-type", "radius", "outline-none", "shadow-focus", "transition"]);
  assert.deepEqual(rules(all, { kit: true }), ["hover-weak", "raw-color", "palette-color", "text-size", "old-type", "outline-none", "shadow-focus", "transition"]);
  assert.deepEqual(rules(`<p className="text-ui text-secondary" />`, { kit: true }), ["two-roles"]);
});

test("outline-none, shadow-focus and transition", () => {
  assert.deepEqual(rules(`"outline-none focus-visible:outline-none"`), ["outline-none", "outline-none"]);
  assert.deepEqual(rules(`"focus-visible:shadow-[var(--ring-primary-focus)]"`), ["shadow-focus"]);
  assert.deepEqual(rules(`"transition duration-200 transition-all transition-colors"`), ["transition", "transition", "transition"]);
  assert.deepEqual(rules(`"outline-hidden focus-ring transition-hover transition-opacity transition-[opacity,scale]"`), []);
});

test("lift-transition: hover-lift carries its own transition, so no transition-* beside it", () => {
  assert.deepEqual(rules(`<div className="hover-lift transition-hover rounded-surface" />`), ["lift-transition"]);
  assert.deepEqual(rules(`"hover-lift hover:transition-[background-color]"`), ["lift-transition"]);
  assert.deepEqual(rules(`"hover-lift rounded-surface ring-1 duration-200"`), []);
  assert.deepEqual(rules(`cn("hover-lift", open && "transition-opacity")`), []);
});

test("shadow-focus: a Tailwind ring on focus is a box-shadow ring too", () => {
  assert.deepEqual(rules(`"outline-hidden focus-visible:ring-2 focus-visible:ring-primary-base"`), ["shadow-focus", "shadow-focus"]);
  assert.deepEqual(rules(`"focus-within:ring-error-base group-focus-visible/row:ring-2 peer-focus:ring focus:shadow"`), ["shadow-focus", "shadow-focus", "shadow-focus", "shadow-focus"]);
  assert.deepEqual(rules(`"focus:ring-0 focus-visible:ring-offset-2 focus:shadow-none ring-2 hover:ring-stroke-sub-300"`), []);
});

test("comments and code outside string literals are not class names", () => {
  assert.deepEqual(rules(`// a transition with outline-none and rounded-lg, text-[11px]`), []);
  assert.deepEqual(rules(`const transition = outline; // hover:bg-bg-weak-50`), []);
});

test("a template literal that runs on to the next line is checked up to the line's end", () => {
  assert.deepEqual(rules("className={`mt-1 text-title-h6 rounded-lg ${"), ["old-type", "radius"]);
});

const hit = { file: "src/a.tsx", rule: "radius", message: "", line: 1, token: "rounded-lg" };

test("compareAllow: a break in a file not listed for its rule fails", () => {
  assert.deepEqual(compareAllow([hit], { _comment: "", radius: ["src/a.tsx"] }), { errors: [], stale: [] });
  assert.deepEqual(compareAllow([hit], { _comment: "", radius: [], "outline-none": [] }), { errors: [hit], stale: [] });
  assert.deepEqual(compareAllow([hit], { "outline-none": ["src/a.tsx"] }).errors, [hit]);
});

test("compareAllow: a listed file that no longer breaks its rule fails", () => {
  assert.deepEqual(compareAllow([], { _comment: "", radius: ["src/a.tsx"] }), { errors: [], stale: ["radius: src/a.tsx"] });
  assert.deepEqual(compareAllow([hit], { radius: ["src/a.tsx", "src/b.tsx"] }).stale, ["radius: src/b.tsx"]);
});

test("size steps: a numeric h-, w-, size-, min- or max- step is off the pre-grid scale; px and the 14 px icon are not", () => {
  for (const c of ["size-4", "w-56", "h-10", "min-h-20", "max-w-10", "max-h-2.5", "size-1.5"]) assert.equal(isOffScaleSize(c), true, c);
  for (const c of ["size-3.5", "w-3.5", "w-[196px]", "size-[14px]", "h-px", "w-full", "min-h-0", "min-w-0", "size-0", "h-screen"]) assert.equal(isOffScaleSize(c), false, c);
});

test("positive-tracking: the owner's rule, never positive tracking, in classes, styles and stylesheets", () => {
  for (const c of ["tracking-wide", "tracking-wider", "tracking-widest", "tracking-[0.5px]", "tracking-[.05em]", "[letter-spacing:0.55px]", "md:tracking-wide"]) {
    assert.deepEqual(rules(`<span className="${c}" />`), ["positive-tracking"], c);
  }
  for (const c of ["tracking-tight", "tracking-normal", "tracking-[-0.01em]", "[letter-spacing:-0.02em]", "[letter-spacing:inherit]"]) {
    assert.deepEqual(rules(`<span className="${c}" />`), [], c);
  }
  assert.deepEqual(rules(`<span style={{ letterSpacing: "0.5px" }} />`), ["positive-tracking"]);
  assert.deepEqual(rules(`<span style={{ letterSpacing: 0 }} />`), []);
  assert.deepEqual(rules(`.x { letter-spacing: 0.55px; }`, { css: true }), ["positive-tracking"]);
  assert.deepEqual(rules(`:root { --tracking-small: 0.01em; }`, { css: true, trackingOnly: true }), ["positive-tracking"]);
  assert.deepEqual(rules(`.x { letter-spacing: -0.01em; } .y { letter-spacing: 0; } :root { --tracking-small: -0.01em; }`, { css: true }), []);
});
