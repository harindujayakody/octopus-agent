import type { Block } from "../model/types";

/// Canvas geometry the layout shares with the canvas widget (its CARD_H and
/// GRID). Steps sit 100 px apart so the arrow between two reads.
export const LAYOUT_X = 80;
export const LAYOUT_Y = 80;
export const LAYOUT_STEP = 100;
const CARD_H = 60;
const CARD_W = 210;

/** The flow's order: by column, then height. Must match the canvas and the runner. */
export function flowOrder(blocks: readonly Block[]): Block[] {
  return [...blocks].sort((a, b) => Math.round(a.x / 40) - Math.round(b.x / 40) || a.y - b.y);
}

/** True when no step has a position yet: a new or imported project stores every step at 0, 0. */
export function isUnplaced(blocks: readonly Block[]): boolean {
  return blocks.length > 1 && blocks.every((b) => !b.x && !b.y);
}

/** One column down the left, in flow order. `order` is used as given for ties (an unplaced project has only list order). */
export function tidyBlocks(blocks: readonly Block[]): Block[] {
  const at = new Map(flowOrder(blocks).map((b, i) => [b.id, i]));
  return blocks.map((b) => ({ ...b, x: LAYOUT_X, y: LAYOUT_Y + (at.get(b.id) ?? 0) * LAYOUT_STEP }));
}

const overlaps = (x: number, y: number, b: Block) =>
  x < b.x + CARD_W && x + CARD_W > b.x && y < b.y + CARD_H && y + CARD_H > b.y;

/** Where a new step goes: under the step that runs last, moved down past anything in the way. Never moves another step. */
export function freeSpot(blocks: readonly Block[]): { x: number; y: number } {
  if (blocks.length === 0) return { x: LAYOUT_X, y: LAYOUT_Y };
  const last = flowOrder(blocks)[blocks.length - 1];
  let y = last.y + LAYOUT_STEP;
  while (blocks.some((b) => overlaps(last.x, y, b))) y += 20;
  return { x: last.x, y };
}
