import { test } from "node:test";
import assert from "node:assert/strict";
import { contrast, oklchToHex, over, parseHex, srgbToOklch, toHex } from "./color-math.mjs";

const near = (a, b, d = 0.01) => assert.ok(Math.abs(a - b) <= d, `${a} is not within ${d} of ${b}`);

test("WCAG contrast matches the reference pairs", () => {
  near(contrast(parseHex("#000"), parseHex("#fff")), 21);
  near(contrast(parseHex("#777777"), parseHex("#ffffff")), 4.48);
  near(contrast(parseHex("#a3a3a3"), parseHex("#ffffff")), 2.52);
  near(contrast(parseHex("#ffffff"), parseHex("#fb3748")), 3.66);
});

test("alpha is composited over the layer under it", () => {
  assert.equal(toHex(over(parseHex("#0000000d"), parseHex("#ffffff"))), "#f2f2f2");
  assert.equal(toHex(over(parseHex("#ffffff17"), parseHex("#222222"))), "#363636");
});

test("OKLCH round-trips the brand and the neutrals", () => {
  assert.equal(oklchToHex(0.571, 0.232, 273.4), "#535efd");
  assert.equal(oklchToHex(0.976, 0, 0), "#f7f7f7");
  assert.equal(oklchToHex(0.76, 0.1228, 273.43), "#98abff");
  const o = srgbToOklch(parseHex("#4348e6"));
  near(o.L, 0.507, 0.001); near(o.C, 0.232, 0.001); near(o.H, 273.1, 0.1);
});

test("out-of-gamut chroma is reduced, not clipped per channel", () => {
  // L 0.9 at C 0.4 is far outside sRGB; the result keeps L and H.
  const hex = oklchToHex(0.9, 0.4, 150);
  const o = srgbToOklch(parseHex(hex));
  near(o.L, 0.9, 0.01); near(o.H, 150, 2);
});
