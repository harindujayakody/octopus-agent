import { expect, type Locator, type Page } from "@playwright/test";

/** A Windows user agent: the app draws the caption buttons and reads Ctrl as Mod. */
export const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export type Box = { x: number; y: number; width: number; height: number };

/** The element's box, failing loudly when it is not rendered. */
export async function boxOf(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error(`no box: ${l}`);
  return b;
}

/** Square pixels two boxes share; 0 when they only touch or are apart. */
export function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Nothing of `a` sits over `b` (LAYOUT-02: floating layers never cover what they act beside). */
export async function expectApart(a: Locator, b: Locator) {
  expect(overlapArea(await boxOf(a), await boxOf(b)), `${a} overlaps ${b}`).toBe(0);
}

/** The text is cut (an ellipsis shows): its content is wider than its box. */
export function isTruncated(l: Locator): Promise<boolean> {
  return l.evaluate((el) => el.scrollWidth > el.clientWidth + 0.5);
}

/** Opens the next page load in the given UI language (before `openApp`, which keeps a stored one). */
export function withLang(page: Page, lang: "en" | "zh") {
  return page.addInitScript((l) => localStorage.setItem("shardx.lang", l), lang);
}
