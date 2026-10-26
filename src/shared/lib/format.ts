import { appLocale, translate, useLang, type Lang } from "../i18n";

// Numbers, money, sizes and durations in the interface language, in one
// module so every screen formats them alike (WIG-09, WRITE-11). Intl
// formatters are cached per locale and options: building one is not free,
// and lists call these for every row.

/** A no-break space: a number never wraps away from its unit. */
export const NBSP = " ";

const cache = new Map<string, Intl.NumberFormat>();
function nf(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const locale = appLocale();
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    cache.set(key, f);
  }
  return f;
}

/** "rows and sheet": a list in a sentence, the UI language's way. */
export function fmtList(items: readonly string[]): string {
  // Intl.ListFormat is newer than this project's lib setting.
  const ListFormat = (Intl as unknown as { ListFormat: new (locale: string, o: { style: string; type: string }) => { format(items: readonly string[]): string } }).ListFormat;
  return new ListFormat(appLocale(), { style: "long", type: "conjunction" }).format(items);
}

/** 1283 becomes "1,283", grouped the UI language's way. */
export const fmtCount = (n: number): string => nf().format(Number.isFinite(n) ? n : 0);

/** A count short enough for a narrow card: 12,400 becomes "12.4K" (万 in
 *  Chinese). */
export const fmtCompact = (n: number): string =>
  nf({ notation: "compact", maximumFractionDigits: 1 }).format(Number.isFinite(n) ? n : 0);

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

function scaled(bytes: number, unit?: number): { unit: number; text: string } {
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const i = unit ?? (n < 1024 ? 0 : Math.min(UNITS.length - 1, Math.floor(Math.log(n) / Math.log(1024))));
  const v = n / 1024 ** i;
  return { unit: i, text: nf({ maximumFractionDigits: v >= 100 || i === 0 ? 0 : 1 }).format(v) };
}

/** 20027801 becomes "19.1 MB". Base 1024, as a file manager shows it; our own
 *  unit letters, not Intl's unit style, which differs between WebKit and
 *  Chromium. */
export function fmtBytes(bytes: number): string {
  const s = scaled(bytes);
  return `${s.text}${NBSP}${UNITS[s.unit]}`;
}

/** A size as a stat draws it, the number and its unit apart ("19.1" and
 *  "MB", owner's stat rule: the unit sits small beside the number). Scaled
 *  and rounded as fmtBytes does. */
export function fmtBytesParts(bytes: number): { value: string; unit: string } {
  const s = scaled(bytes);
  return { value: s.text, unit: UNITS[s.unit] };
}

/** Two sizes in the larger one's unit: "4.8 of 19.1 MB". */
export function fmtBytesProgress(done: number, total: number): string {
  const all = scaled(total);
  const part = scaled(Math.min(Math.max(0, done), total), all.unit);
  const t = (key: string, vars: Record<string, string>) => translate(useLang.getState().lang, key, vars);
  return t("format.bytesProgress", { done: part.text, total: all.text, unit: UNITS[all.unit] });
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** 45 s, 14 min, 2 h 14 min, 8 d 20 h. Floors at every step, like the Status
 *  column. i18n templates, not Intl.DurationFormat, which not every WKWebView
 *  the app supports has. */
export function fmtDuration(ms: number, lang: Lang = useLang.getState().lang): string {
  const t = (key: string, vars: Record<string, number>) => translate(lang, key, vars);
  const n = Math.max(0, Number(ms) || 0);
  if (n < MINUTE) return t("format.durationSeconds", { s: Math.floor(n / 1000) });
  if (n < HOUR) return t("format.durationMinutes", { m: Math.floor(n / MINUTE) });
  if (n < 2 * DAY) return t("format.durationHoursMinutes", { h: Math.floor(n / HOUR), m: Math.floor((n % HOUR) / MINUTE) });
  return t("format.durationDaysHours", { d: Math.floor(n / DAY), h: Math.floor((n % DAY) / HOUR) });
}

/** A duration in its largest whole unit, never under a minute: "2 h",
 *  "27 min". For a tile with no room for fmtDuration's "2 h 14 min" (the
 *  Continue tiles' "Running, 2 h"). */
export function fmtDurationShort(ms: number, lang: Lang = useLang.getState().lang): string {
  const t = (key: string, vars: Record<string, number>) => translate(lang, key, vars);
  const n = Math.max(MINUTE, Number(ms) || 0);
  return n < HOUR ? t("format.durationMinutes", { m: Math.floor(n / MINUTE) }) : t("format.durationHours", { h: Math.floor(n / HOUR) });
}

const regionNames = new Map<string, Intl.DisplayNames>();

/** "DE" becomes "Germany" (德国 in Chinese). An unknown code comes back as it
 *  was; a malformed one too (Intl.DisplayNames throws on it). A11Y-09. */
export function fmtCountry(code: string): string {
  const locale = appLocale();
  try {
    let names = regionNames.get(locale);
    if (!names) {
      names = new Intl.DisplayNames([locale], { type: "region" });
      regionNames.set(locale, names);
    }
    return names.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
