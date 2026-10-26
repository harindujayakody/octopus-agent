/** WCAG relative luminance. `c` is 0-255 sRGB. */
export function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two sRGB colors. */
export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** OKLab/OKLCH -> linear sRGB -> sRGB (Björn Ottosson's matrices, CSS Color 4). */
export function oklchToSrgb255(L: number, C: number, H: number): [number, number, number] {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad), b = C * Math.sin(hRad);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const toSrgb = (c: number) => { const cc = Math.min(Math.max(c, 0), 1); return cc <= 0.0031308 ? 12.92 * cc : 1.055 * Math.pow(cc, 1 / 2.4) - 0.055; };
  return [toSrgb(r) * 255, toSrgb(g) * 255, toSrgb(bl) * 255];
}

/** Chromium serializes a `color-mix(in oklch, ...)` computed value as an
 *  `oklch(L C H / A)` function, not `rgb()`: parse whichever form the
 *  browser hands back into 0-255 sRGB + alpha. */
export function parseColor(s: string): [number, number, number, number] {
  const oklch = s.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
  if (oklch) {
    const [L, C, H] = [parseFloat(oklch[1]), parseFloat(oklch[2]), parseFloat(oklch[3])];
    const a = oklch[4] !== undefined ? parseFloat(oklch[4]) : 1;
    return [...oklchToSrgb255(L, C, H), a];
  }
  const m = s.match(/[\d.]+/g)!.map(Number);
  return [m[0], m[1], m[2], m[3] ?? 1];
}

/** Composites `fg` (possibly translucent) over an opaque `bg`. */
export function composite(fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] {
  const [r, g, b, a] = fg;
  return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
}
