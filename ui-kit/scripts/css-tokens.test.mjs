import { test } from "node:test";
import assert from "node:assert/strict";
import { declarations, setDeclaration } from "./css-tokens.mjs";

const CSS = `
@theme { --color-x: var(--x); }
/* light */
:root { --x: #111111; /* a comment { with a brace } */ --y: #222222; }
[data-theme="dark"] { --x: #333333; }
:root { --z: 1px; }
@media (prefers-contrast: more) {
  :root { --x: #000000; }
  [data-theme="dark"] { --x: #ffffff; }
}
`;

test("declarations merges the top-level blocks of one selector", () => {
  assert.deepEqual(declarations(CSS, ":root"), { "--x": "#111111", "--y": "#222222", "--z": "1px" });
  assert.deepEqual(declarations(CSS, '[data-theme="dark"]'), { "--x": "#333333" });
});

test("declarations reads a selector inside an @media block", () => {
  assert.deepEqual(declarations(CSS, ":root", "prefers-contrast: more"), { "--x": "#000000" });
  assert.deepEqual(declarations(CSS, '[data-theme="dark"]', "prefers-contrast: more"), { "--x": "#ffffff" });
});

test("setDeclaration changes one value in the right block and keeps comments", () => {
  const next = setDeclaration(CSS, '[data-theme="dark"]', "prefers-contrast: more", "--x", "#eeeeee");
  assert.equal(declarations(next, '[data-theme="dark"]', "prefers-contrast: more")["--x"], "#eeeeee");
  assert.equal(declarations(next, '[data-theme="dark"]')["--x"], "#333333");
  assert.ok(next.includes("/* a comment { with a brace } */"));
  assert.throws(() => setDeclaration(CSS, ":root", null, "--missing", "#000"), /--missing is not declared/);
});

test("a block after an @import or @custom-variant statement is still read", () => {
  const css = '@import "x.css";\n@custom-variant dark (&:where(.dark, .dark *));\n:root { --a: #ffffff; }\n@theme { --color-a: var(--a); }';
  assert.deepEqual(declarations(css, ":root"), { "--a": "#ffffff" });
  assert.deepEqual(declarations(css, "@theme"), { "--color-a": "var(--a)" });
});

test("a top-level comment with a brace in it does not shift the blocks", () => {
  const css = '/* not a block { or } */\n:root { --a: #ffffff; }\n/* } */\n[data-theme="dark"] { --a: #000000; }';
  assert.deepEqual(declarations(css, ":root"), { "--a": "#ffffff" });
  assert.deepEqual(declarations(css, '[data-theme="dark"]'), { "--a": "#000000" });
});

test("the last declaration of a block may leave out its semicolon", () => {
  const css = ":root { --a: #ffffff; --b: 0 0 0 1px #000000 /* edge */ }";
  assert.deepEqual(declarations(css, ":root"), { "--a": "#ffffff", "--b": "0 0 0 1px #000000" });
  const next = setDeclaration(css, ":root", null, "--b", "#111111");
  assert.deepEqual(declarations(next, ":root"), { "--a": "#ffffff", "--b": "#111111" });
  assert.ok(next.includes("/* edge */"));
});
