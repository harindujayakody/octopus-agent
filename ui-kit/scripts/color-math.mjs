// Color math for the contrast check (scripts/check-contrast.mjs), and for the
// token generator Audit Phase B Task 16 adds (gen-colors.mjs): hex and OKLCH
// conversion, alpha compositing and the WCAG 2 contrast ratio. No dependencies.

/** "#rgb", "#rrggbb" or "#rrggbbaa" to 0-255 channels and a 0-1 alpha. */
export function parseHex(hex) {
  const h = hex.trim().replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) throw new Error(`not a hex color: ${hex}`);
  const n = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
    a: n.length === 8 ? parseInt(n.slice(6, 8), 16) / 255 : 1,
  };
}

const byte = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
/** Channels (and an optional 0-1 alpha) to lowercase hex. */
export const toHex = ({ r, g, b }, a) => `#${byte(r)}${byte(g)}${byte(b)}${a === undefined || a >= 1 ? "" : byte(a * 255)}`;

/** `fg` (with its alpha) laid over an opaque `bg`. */
export function over(fg, bg) {
  const a = fg.a ?? 1;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

const toLinear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG 2 relative luminance of an opaque color. */
export const luminance = ({ r, g, b }) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/** WCAG 2 contrast ratio of two opaque colors (1 to 21). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** OKLCH to linear-free sRGB in 0-1 (may fall outside 0-1 when out of gamut). */
export function oklchToSrgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(fromLinear);
}

/** sRGB channels to OKLCH { L, C, H }. */
export function srgbToOklch({ r, g, b }) {
  const [R, G, B] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, Bb);
  const H = C < 1e-4 ? 0 : ((Math.atan2(Bb, A) * 180) / Math.PI + 360) % 360;
  return { L, C, H };
}

// Half a channel step: a value that rounds to 0 or 255 is still in gamut.
const IN = (v) => v >= -0.5 / 255 && v <= 1 + 0.5 / 255;

/** OKLCH to hex, reducing chroma (same L and H) until the color is inside sRGB. */
export function oklchToHex(L, C, H) {
  let c = C;
  let rgb = oklchToSrgb(L, c, H);
  while (!rgb.every(IN) && c > 0) { c = Math.max(0, c - 0.0005); rgb = oklchToSrgb(L, c, H); }
  return toHex({ r: rgb[0] * 255, g: rgb[1] * 255, b: rgb[2] * 255 });
}
