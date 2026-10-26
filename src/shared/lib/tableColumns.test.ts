// node --test: how a list's columns share the room left over (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSet, layoutColumns, measureColumns, setShown, type ColumnDef, type LayoutOptions } from "./tableColumns.ts";

type Id = "name" | "status" | "tags" | "notes" | "created";
const col = (id: Id, over: Partial<ColumnDef<Id>>): ColumnDef<Id> =>
  ({ id, title: () => id, need: 100, min: 64, max: 640, shown: true, hideable: true, movable: true, ...over });
const DEFS: readonly ColumnDef<Id>[] = [
  col("name", { need: 150, min: 120, max: 640, hideable: false, movable: false }),
  // A pill: 24 px past its content at most.
  col("status", { need: 92, min: 92, max: 240, hideable: false, grow: 24 }),
  col("tags", { need: 96, min: 64, max: 480 }),
  col("notes", { need: 100, min: 64, max: 640, fill: true }),
  col("created", { need: 96, min: 72, max: 240, shown: false }),
];
const SET = defaultSet(DEFS);
const NO_NOTES = setShown(DEFS, SET, "notes", false);
const FOUR = setShown(DEFS, NO_NOTES, "created", true);
// 28 + 10 lead, 108 tail, 10 per column and 24 padding: 210 px around four columns.
const ROW = { lead: 28, tail: 108, gap: 10, padding: 24 };
const at = (available: number | null, widths = {}, set = SET, more: Partial<LayoutOptions<Id>> = {}) =>
  layoutColumns(DEFS, set, widths, { ...ROW, available, ...more });
const sum = (w: Partial<Record<Id, number>>) => Object.values(w).reduce((s, n) => s + (n ?? 0), 0);
const near = (a: number, b: number, d = 0.02) => assert.ok(Math.abs(a - b) <= d, `${a} vs ${b}`);

test("room left: the same px to every column, a pill only 24 past its content; the row is full", () => {
  const l = at(1000);
  assert.equal(l.minWidth, 648);
  assert.equal(l.stretched, true);
  // 352 px over 438: Status takes 24, the other three 109.33 each.
  assert.equal(l.template, "28px var(--col-name,minmax(150px,259.33fr)) var(--col-status,minmax(92px,116fr)) var(--col-tags,minmax(96px,205.33fr)) var(--col-notes,minmax(100px,209.33fr)) 108px");
  near(sum(l.drawn), 790);
  assert.equal(l.tracks.status, "minmax(92px,116fr)");
});

test("past every other column's cap Notes takes the rest", () => {
  const wide = at(3000);
  assert.deepEqual({ name: wide.drawn.name, status: wide.drawn.status, tags: wide.drawn.tags }, { name: 640, status: 116, tags: 480 });
  near(wide.drawn.notes!, 2790 - 640 - 116 - 480);
});

test("without Notes, every column but the last the same px past its content; the last keeps its own, so the data ends at the actions", () => {
  // 1462 px over Name and Status: 731 to each, a pill as much as Name; Tags stays at its content.
  const plain = at(2000, {}, NO_NOTES);
  assert.equal(plain.minWidth, 538);
  near(plain.drawn.name!, 881);
  near(plain.drawn.status!, 823);
  assert.equal(plain.drawn.tags, 96);
  near(sum(plain.drawn), 1800);
  assert.ok(plain.template.endsWith(" 108px"), plain.template);
  // Narrower too: the same steps, not Name first while the pill waits at 24.
  const mid = at(1000, {}, NO_NOTES);
  near(mid.drawn.name! - 150, 231);
  near(mid.drawn.status! - 92, 231);
  assert.equal(mid.drawn.tags, 96);
  // Two columns: Name takes the room, the pill keeps its own at the actions.
  const two = at(1000, {}, setShown(DEFS, NO_NOTES, "tags", false));
  near(two.drawn.name!, 810 - 92);
  assert.equal(two.drawn.status, 92);
});

test("without Notes, a cut column grows toward whole from half its gap of room, never at one px; past that, the same share", () => {
  // 432 px to spare, Name 720 px from whole: 144 toward whole (2 × 432 − 720), then 144 to Name and Status each.
  const cut = at(1000, {}, NO_NOTES, { auto: { name: 180 }, full: { name: 900 } });
  near(cut.drawn.name!, 468);
  near(cut.drawn.status!, 236);
  assert.equal(cut.drawn.tags, 96);
  // Far from whole (gap past twice the room): nothing first, the even share only.
  const far = at(1000, {}, NO_NOTES, { auto: { name: 180 }, full: { name: 1200 } });
  near(far.drawn.name! - 180, far.drawn.status! - 92);
  // Whole with room to spare: the rest evenly past its whole width.
  const whole = at(2000, {}, NO_NOTES, { auto: { name: 180 }, full: { name: 300 } });
  near(whole.drawn.name! - 300, whole.drawn.status! - 92);
  assert.equal(whole.drawn.tags, 96);
});

test("one px more room moves no column more than 2 px: no column jumps whole", () => {
  for (const [set, full] of [[NO_NOTES, { name: 480 }], [NO_NOTES, { tags: 2000 }], [SET, { name: 420, tags: 300, notes: 700 }]] as const) {
    let prev = at(600, {}, set, { auto: { name: 180 }, full });
    for (let a = 601; a <= 3000; a++) {
      const l = at(a, {}, set, { auto: { name: 180 }, full });
      if (l.stretched && prev.stretched) for (const id of l.shown) assert.ok(Math.abs(l.drawn[id]! - prev.drawn[id]!) <= 2.01, `${id} at ${a}: ${prev.drawn[id]} -> ${l.drawn[id]}`);
      prev = l;
    }
  }
});

test("a width a person set is drawn as set; what it takes or leaves comes out of the next column", () => {
  const wider = at(1000, { status: 140 });
  assert.equal(wider.tracks.status, "140px");
  near(wider.drawn.tags!, 205.33 - 24);
  near(wider.drawn.name!, 259.33);
  near(wider.drawn.notes!, 209.33);
  const narrower = at(1000, { tags: 150 });
  near(narrower.drawn.notes!, 209.33 + 55.33);
  near(narrower.drawn.status!, 116);
  near(sum(narrower.drawn), 790);
});

test("the room first makes a cut column whole, then Notes toward whole, then the rest", () => {
  // 100 px to spare: Name (80 from whole) first, Notes (40 from whole) the 20 left.
  const l = at(778, {}, SET, { auto: { name: 180 }, full: { name: 260, notes: 140 } });
  assert.equal(l.drawn.name, 260);
  assert.equal(l.drawn.notes, 120);
  // A long URL past the column's max shows whole when the row has room for it.
  const url = at(1500, {}, SET, { full: { tags: 749 } });
  assert.ok(url.drawn.tags! >= 749, String(url.drawn.tags));
});

test("not enough room: as before, the columns give way and nothing stretches", () => {
  const tight = at(600);
  assert.equal(tight.stretched, false);
  assert.equal(tight.template, "28px var(--col-name,150px) var(--col-status,92px) var(--col-tags,84px) var(--col-notes,minmax(64px,1fr)) 108px");
  // Exactly full: nothing to share either.
  const full = at(648);
  assert.equal(full.stretched, false);
  assert.equal(full.template, "28px var(--col-name,150px) var(--col-status,92px) var(--col-tags,96px) var(--col-notes,minmax(100px,1fr)) 108px");
  // Not measured yet: the template the list had before stretching.
  assert.equal(at(null).stretched, false);
});

test("a dragged edge: the column takes the px from the next one, the columns before it hold, and the stored width is the drawn one", () => {
  const l = at(1000);
  const r = l.resize("status", l.drawn.status! + 40);
  assert.deepEqual(r.widths, { status: 156 });
  near(r.layout.drawn.tags!, l.drawn.tags! - 40);
  near(r.layout.drawn.name!, l.drawn.name!);
  // Past what the next column can give (down to its content), the one after it gives.
  const far = l.resize("status", 240);
  assert.equal(far.layout.drawn.tags, 96);
  near(far.layout.drawn.notes!, 790 - 259.33 - 240 - 96);
  near(far.layout.drawn.name!, l.drawn.name!);
  // Name's edge stops where the row would have to scroll.
  const name = l.resize("name", 640);
  assert.equal(name.widths.name, 501);
  assert.equal(name.layout.stretched, true);
  // Without room to spare, as before: the column takes it and the list grows.
  const tight = at(648).resize("tags", 130);
  assert.deepEqual(tight.widths, { tags: 130 });
  assert.equal(tight.layout.drawn.tags, 130);
});

test("an empty neighbour (its title's width) neither stretches nor pays: the next column that stretches does, and nothing else is stored", () => {
  const l = at(1000, {}, SET, { auto: { tags: 40 } });
  assert.equal(l.drawn.tags, 40);
  near(sum(l.drawn), 790);
  const r = l.resize("status", l.drawn.status! + 40);
  assert.deepEqual(r.widths, { status: 156 });
  assert.equal(r.layout.drawn.tags, 40);
  near(r.layout.drawn.notes!, l.drawn.notes! - 40);
  near(r.layout.drawn.name!, l.drawn.name!);
});

test("a neighbour a person sized gives the px itself, and is kept; the rest hold", () => {
  const l = at(1000, { tags: 200 });
  const r = l.resize("status", l.drawn.status! + 30);
  assert.deepEqual(r.widths, { tags: 170, status: 146 });
  near(r.layout.drawn.notes!, l.drawn.notes!);
  near(r.layout.drawn.name!, l.drawn.name!);
});

test("the last column's edge is the row's end: its keys move the border before it", () => {
  const l = at(1000);
  const r = l.resize("notes", l.drawn.notes! + 8);
  assert.deepEqual(r.widths, { notes: 217 });
  near(r.layout.drawn.tags!, l.drawn.tags! - 7.67);
  near(r.layout.drawn.status!, l.drawn.status!);
  near(r.layout.drawn.name!, l.drawn.name!);
});

test("a column a wide row drew past its max narrows from there, never jumps to the max; it widens while the next column gives", () => {
  // 1462 + 1000 px over Name and Status: Name 1381, past its 640.
  const l = at(3000, {}, NO_NOTES);
  near(l.drawn.name!, 1381);
  const r = l.resize("name", 1300);
  assert.deepEqual(r.widths, { name: 1300 });
  near(r.layout.drawn.status!, l.drawn.status! + 81);
  assert.equal(r.layout.drawn.tags, 96);
  // Status (max 240, drawn 1323) widens too, Tags having nothing to give: Name, before it, holds.
  const w = at(1600, {}, FOUR);
  for (const id of ["name", "status"] as const) {
    const g = w.resize(id, w.drawn[id]! + 40);
    near(g.layout.drawn[id]!, w.drawn[id]! + 40, 0.5);
  }
  // Tags, before the last column: the last sits at its content and gives nothing, so the edge holds.
  const t = w.resize("tags", w.drawn.tags! + 40);
  assert.deepEqual(t.widths, {});
  // The last column's own keys move the border before it.
  const c = w.resize("created", w.drawn.created! + 40);
  near(c.layout.drawn.tags!, w.drawn.tags! - 40, 0.5);
});

test("a width kept from a wide row gives way first in a narrow one, and never leaves the row tighter than no width", () => {
  const o = { auto: { name: 180, status: 92, tags: 120 } };
  const wide = at(2200, {}, NO_NOTES, o);
  for (const id of ["name", "status"] as const) {
    const kept = wide.resize(id, wide.drawn[id]! - 8).widths;
    assert.ok(kept[id]! > DEFS.find((d) => d.id === id)!.max, JSON.stringify(kept));
    for (const a of [760, 640, 560]) {
      const plain = at(a, {}, NO_NOTES, o);
      const sized = at(a, kept, NO_NOTES, o);
      assert.ok(sized.minWidth <= Math.max(a, plain.minWidth) + 0.5, `${id} at ${a}: ${sized.minWidth} vs ${plain.minWidth}`);
      assert.ok(sized.drawn.name! >= Math.min(plain.drawn.name!, 180) - 0.5, `${id} at ${a}: Name ${sized.drawn.name}`);
    }
  }
  // Within its max a person's width holds, as before.
  const held = at(560, { tags: 200 }, NO_NOTES, o);
  assert.equal(held.drawn.tags, 200);
});

test("without Notes, a dragged edge still trades with the next column and the columns before it hold", () => {
  const l = at(1600, {}, NO_NOTES);
  const r = l.resize("status", l.drawn.status! - 60);
  near(r.layout.drawn.tags!, l.drawn.tags! + 60);
  near(r.layout.drawn.name!, l.drawn.name!);
  near(sum(r.layout.drawn), sum(l.drawn));
  // The last column's keys move the border before it.
  const last = l.resize("tags", l.drawn.tags! + 10);
  near(last.layout.drawn.status!, l.drawn.status! - 10);
  near(last.layout.drawn.name!, l.drawn.name!);
});

test("an empty Notes stays at its width and counts as none: the same px past every other column's content, Tags kept at its own", () => {
  const quiet = at(3000, {}, SET, { full: { notes: 45 } });
  assert.equal(quiet.drawn.notes, 100);
  assert.equal(quiet.drawn.tags, 96);
  near(quiet.drawn.name! - 150, quiet.drawn.status! - 92);
});

test("a little room goes to Notes' cut text first; past whole, the same px to each", () => {
  // 152 px to spare, Notes 300 px from whole: all of it to Notes.
  const little = at(800, {}, SET, { auto: { notes: 380 }, full: { notes: 400 } });
  near(little.drawn.notes!, 252);
  near(little.drawn.name!, 150);
  const wide = at(1500, {}, SET, { auto: { notes: 380 }, full: { notes: 400 } });
  near(wide.drawn.notes! - 400, wide.drawn.name! - 150);
  near(wide.drawn.status!, 116);
});

test("the width every row fits in can pass the column's max; the nine-in-ten width cannot", () => {
  const out = measureColumns(DEFS, [100, 120, 900], { tags: (r: number) => r }, () => 0, () => 30);
  assert.deepEqual(out, { fit: { tags: 121 }, full: { tags: 901 } });
});
