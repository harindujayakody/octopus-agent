import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { FILES, diffs, hexOf } from "./gen-colors.mjs";

const read = (f) => (existsSync(FILES[f]) ? readFileSync(FILES[f], "utf8") : null);

test("a source is OKLCH or a color at a percentage", () => {
  assert.equal(hexOf({ oklch: [0.976, 0, 0] }), "#f7f7f7");
  assert.equal(hexOf({ oklch: [0.76, 0.1228, 273.43] }), "#98abff");
  assert.equal(hexOf({ hex: "#000000", pct: 5 }), "#0000000d");
  assert.equal(hexOf({ hex: "#535efd", pct: 22 }), "#535efd38");
});

test("a source can be an overlay laid over an opaque color, as one opaque color", () => {
  // White 5% over the dark tile, and the dark checked row with the hover over it.
  assert.equal(hexOf({ over: [{ hex: "#ffffff", pct: 5 }, { oklch: [0.252, 0, 0] }] }), "#2d2d2d");
  assert.equal(hexOf({ over: [{ hex: "#ffffff", pct: 5 }, { over: [{ hex: "#535efd", pct: 22 }, { oklch: [0.213, 0, 0] }] }] }), "#313354");
});

test("a role that points at another role is written as var()", () => {
  assert.equal(hexOf({ ref: "--error-tint-hover" }), "var(--error-tint-hover)");
});

test("tokens.css and the label palette match their source", () => {
  assert.deepEqual(diffs(read), []);
});

test("a value edited by hand is reported with what the source says", () => {
  const edited = (f) => (f === "kit" ? read(f).replace("--text-soft-400: #696969;", "--text-soft-400: #a3a3a3;") : read(f));
  const found = diffs(edited);
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].token, found[0].have, found[0].want], ["--text-soft-400", "#a3a3a3", "#696969"]);
});
