/** Digits grouped by a mark, three at a time: "1,234", "1.234.567". */
const groupedBy = (mark: string) => new RegExp(`^[-+]?\\d{1,3}(\\${mark}\\d{3})+$`);
const COMMA_GROUPS = groupedBy(",");
/** Digits grouped by spaces (a thin or no-break one too), with a fraction or not. */
const SPACE_GROUPS = /^[-+]?\d{1,3}(\s\d{3})+([.,]\d*)?$/;
/** A plain number: digits with one optional point, and a sign. */
const PLAIN = /^[-+]?(\d+\.?\d*|\.\d+)$/;

/// The number a number field's draft reads as, or null (F11 fix round 2).
/// - What a Chinese or Japanese input method types by default reads the
///   same: full-width digits, signs and commas (NFKC folds them), 。 as the
///   point, and a pasted minus sign (U+2212).
/// - Spaces only ever group digits: "12 345".
/// - With both "," and ".", the last one is the point and the other groups:
///   "1,234.5" and "1.234,5" are both 1234.5.
/// - A lone comma is the point in a field with decimals ("48,857" is
///   48.857, a numpad's point on some layouts) and groups thousands in a
///   whole-number one ("1,234" is 1234; "80,80" is not a number there).
export function parseNumber(text: string, decimals: number): number | null {
  let v = text.normalize("NFKC").replace(/。/g, ".").replace(/−/g, "-").trim();
  if (SPACE_GROUPS.test(v)) v = v.replace(/\s/g, "");
  const comma = v.lastIndexOf(",");
  const dot = v.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const at = Math.max(comma, dot);
    const mark = comma > dot ? "." : ",";
    const whole = v.slice(0, at);
    if (!groupedBy(mark).test(whole)) return null;
    v = `${whole.split(mark).join("")}.${v.slice(at + 1)}`;
  } else if (comma >= 0) {
    if (decimals > 0 && /^[-+]?\d*,\d*$/.test(v)) v = v.replace(",", ".");
    else if (decimals === 0 && COMMA_GROUPS.test(v)) v = v.replace(/,/g, "");
    else return null;
  }
  if (!PLAIN.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
