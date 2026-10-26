import { clientScale } from "@proxyshard/shardx-ui-kit";
import type { CellText, FontRole, Measure } from "./tableColumns";

/// Text widths for a list that sizes its columns to their content (owner,
/// 2026-09-30). One offscreen canvas measures every row's text, each text
/// once per font: fast enough for 1,000 rows, and it ranks them. The canvas
/// applies Inter's optical sizing a little differently from the page (0 to
/// 2% narrower at 13 px in Chromium, by letter), so the few texts that
/// decide a width are then laid out by the page itself (`layoutWidths`).
/// Layout px throughout: the grid's tracks are layout px too.

/** A font as the canvas takes it, and the letter spacing it leaves out, px. */
export type TextFont = { font: string; letterSpacing: number };

/** The classes each role's cells carry (`FontRole`). */
const ROLE_CLASS: Record<FontRole, string> = {
  ui: "text-ui",
  secondary: "text-secondary",
  medium: "text-secondary font-medium",
  mono: "text-mono",
  tabular: "text-secondary tabular-nums",
};
/** A probe: in the list, so it takes the list's fonts, never seen, never in the way. */
const PROBE_STYLE = "position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;white-space:nowrap";

let ctx: CanvasRenderingContext2D | null | undefined;
let ctxFont = "";
const cache = new Map<string, Map<string, number>>();
/** Texts kept per font before that font's cache starts over. */
const LIMIT = 20_000;
/** Fonts whose web font has loaded: only their widths are kept. */
const loaded = new Set<string>();
/** Fonts already asked to load, so a face that never arrives asks once. */
const asked = new Set<string>();

function isLoaded(font: string): boolean {
  if (loaded.has(font)) return true;
  let ok = true;
  try { ok = document.fonts?.check(font) ?? true; } catch { /* a font the engine can't parse: nothing to wait for */ }
  if (ok) loaded.add(font);
  return ok;
}

function probeIn(host: HTMLElement): HTMLElement {
  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = PROBE_STYLE;
  host.append(probe);
  return probe;
}

/// Each role's font as `host` draws it (its language's font stack, the
/// theme's tracking), read from a probe that is gone before anything
/// paints. Read at each measuring, so a language or theme change counts.
export function readFonts(host: HTMLElement): Record<FontRole, TextFont> {
  const probe = probeIn(host);
  const out = {} as Record<FontRole, TextFont>;
  for (const role of Object.keys(ROLE_CLASS) as FontRole[]) {
    probe.className = ROLE_CLASS[role];
    const s = getComputedStyle(probe);
    const ls = Number.parseFloat(s.letterSpacing);
    out[role] = { font: `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`, letterSpacing: Number.isFinite(ls) ? ls : 0 };
  }
  probe.remove();
  return out;
}

/** `text`'s width in `f` by the canvas, px. A web font still loading measures in its fallback, and is not kept. */
export function textWidth(text: string, f: TextFont): number {
  if (!text) return 0;
  let byText = cache.get(f.font);
  let w = byText?.get(text);
  if (w === undefined) {
    ctx ??= document.createElement("canvas").getContext("2d");
    if (!ctx) return 0;
    if (ctxFont !== f.font) { ctx.font = f.font; ctxFont = f.font; }
    w = ctx.measureText(text).width;
    if (isLoaded(f.font)) {
      if (!byText) cache.set(f.font, (byText = new Map()));
      if (byText.size >= LIMIT) byText.clear();
      byText.set(text, w);
    }
  }
  return w + f.letterSpacing * text.length;
}

/** Measures by the canvas in `fonts` (`readFonts`), or in the fonts `host`
 *  draws with. The canvas takes no `tabular-nums`: a tabular digit is as
 *  wide as a 0, so each is measured as one (review M2). */
export function measurer(from: HTMLElement | Record<FontRole, TextFont>): Measure {
  const fonts = from instanceof HTMLElement ? readFonts(from) : from;
  return (text, role) => textWidth(role === "tabular" ? text.replace(/[0-9]/g, "0") : text, fonts[role]);
}

/// `texts`' widths as the page lays them out in `host`, px: exact, all in
/// one layout, so for the few texts that decide a width.
export function layoutWidths(host: HTMLElement, texts: readonly CellText[]): number[] {
  if (texts.length === 0) return [];
  const box = probeIn(host);
  for (const { text, role } of texts) {
    const line = document.createElement("span");
    line.className = ROLE_CLASS[role];
    line.style.cssText = "display:block;width:max-content";
    line.textContent = text;
    box.append(line);
  }
  const k = clientScale();
  const out = [...box.children].map((line) => line.getBoundingClientRect().width / k);
  box.remove();
  return out;
}

/// Settles once each of `fonts`' web fonts has loaded, when one had not:
/// the widths measured meanwhile used a fallback and are measured again.
/// Null when there is nothing to wait for (or it was asked for before).
export function fontsLoading(fonts: Record<FontRole, TextFont>): Promise<unknown> | null {
  const waiting = Object.values(fonts).map((f) => f.font).filter((font) => !isLoaded(font) && !asked.has(font));
  if (waiting.length === 0 || !document.fonts) return null;
  for (const font of waiting) asked.add(font);
  return Promise.all(waiting.map((font) => document.fonts.load(font))).catch(() => undefined);
}
