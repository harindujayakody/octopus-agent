import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";

// The column model the Profiles and Proxies lists share (owner feature
// 2026-09-26), run as the app itself loads it from the dev server.
type Mod = typeof import("../src/shared/lib/tableColumns");
type Text = typeof import("../src/shared/lib/textWidth");
type Win = { __cols: Mod; __text: Text; __defs: Parameters<Mod["defaultSet"]>[0] };

async function load(page: Page) {
  await openApp(page);
  await appModule(page, "/src/shared/lib/tableColumns.ts", "__cols");
  await page.evaluate(() => {
    const col = (id: string, over: Record<string, unknown>) =>
      ({ id, title: () => id, shown: true, hideable: true, movable: true, ...over });
    (window as unknown as { __defs: unknown[] }).__defs = [
      col("name", { need: 150, min: 120, max: 640, hideable: false, movable: false }),
      col("status", { need: 92, min: 92, max: 240, hideable: false }),
      col("tags", { need: 96, min: 64, max: 480 }),
      col("notes", { need: 100, min: 64, max: 640, fill: true }),
      col("created", { need: 96, min: 72, max: 240, shown: false }),
    ];
  });
}
const DEFAULT = { order: ["name", "status", "tags", "notes", "created"], hidden: ["created"] };
const ROW = { lead: 28, tail: 108, gap: 10, padding: 24 };

test("a fresh set is the definitions' order, with the default-hidden columns hidden", async ({ page }) => {
  await load(page);
  expect(await page.evaluate(() => { const w = window as unknown as Win; return w.__cols.defaultSet(w.__defs); })).toEqual(DEFAULT);
});

test("a stored set from anywhere is made whole: junk, unknown and repeated ids, a moved or hidden Name (Review Focus 1)", async ({ page }) => {
  await load(page);
  const out = await page.evaluate(() => {
    const { __cols: m, __defs: d } = window as unknown as Win;
    return {
      junk: [null, "x", 7, { order: 7 }, { order: [] }].map((raw) => m.normalizeSet(d, raw)),
      mixed: m.normalizeSet(d, { order: ["notes", "bogus", "tags", "notes", "name"], hidden: ["tags", "name", "status", "bogus"] }),
    };
  });
  for (const s of out.junk) expect(s).toEqual(DEFAULT);
  // Name leads whatever was saved and can't hide; Status (never listed)
  // joins where the definitions put it and can't hide; Created (new to this
  // set) joins after the column before it and starts hidden.
  expect(out.mixed).toEqual({ order: ["name", "status", "notes", "created", "tags"], hidden: ["tags", "created"] });
});

// A wide row can draw a column past its max, and a person keep it there:
// up to four times the max (owner, 2026-10-23).
test("widths are clamped to each column's range, up to four times its max; junk is dropped (Review Focus 1)", async ({ page }) => {
  await load(page);
  const out = await page.evaluate(() => {
    const { __cols: m, __defs: d } = window as unknown as Win;
    return {
      mixed: m.normalizeWidths(d, { tags: 10, notes: 9999, status: "x", bogus: 50, name: Number.NaN, created: 100.4 }),
      junk: m.normalizeWidths(d, "x"),
    };
  });
  expect(out.mixed).toEqual({ tags: 64, notes: 2560, created: 100 });
  expect(out.junk).toEqual({});
});

test("show, hide and move keep Name first and never hide Name or Status", async ({ page }) => {
  await load(page);
  const out = await page.evaluate(() => {
    const { __cols: m, __defs: d } = window as unknown as Win;
    const s = m.defaultSet(d);
    const shown = ["name", "status", "tags", "notes"];
    return {
      hideName: m.setShown(d, s, "name", false),
      hideTags: m.setShown(d, s, "tags", false),
      showCreated: m.setShown(d, s, "created", true),
      tagsBeforeStatus: m.placeBefore(d, s, "tags", "status"),
      beforeName: m.placeBefore(d, s, "status", "name"),
      moveName: m.placeBefore(d, s, "name", null),
      notesToEnd: m.placeBefore(d, s, "notes", null),
      tagsLeft: m.moveBy(d, s, "tags", -1, shown),
      tagsRight: m.moveBy(d, s, "tags", 1, shown),
      statusLeft: m.moveBy(d, s, "status", -1, shown),
      notesRight: m.moveBy(d, s, "notes", 1, shown),
      same: m.sameSet(s, { order: [...s.order], hidden: [...s.hidden] }),
      isDefault: m.isDefaultSet(d, m.setShown(d, s, "tags", false)),
    };
  });
  expect(out.hideName).toEqual(DEFAULT);
  expect(out.hideTags).toEqual({ order: DEFAULT.order, hidden: ["created", "tags"] });
  expect(out.showCreated).toEqual({ order: DEFAULT.order, hidden: [] });
  expect(out.tagsBeforeStatus.order).toEqual(["name", "tags", "status", "notes", "created"]);
  expect(out.beforeName).toEqual(DEFAULT);
  expect(out.moveName).toEqual(DEFAULT);
  expect(out.notesToEnd.order).toEqual(["name", "status", "tags", "created", "notes"]);
  expect(out.tagsLeft?.order).toEqual(["name", "tags", "status", "notes", "created"]);
  // Right past Notes, the last one on screen: after it, and past the hidden Created too.
  expect(out.tagsRight?.order).toEqual(["name", "status", "notes", "created", "tags"]);
  expect(out.statusLeft).toBeNull();
  expect(out.notesRight).toBeNull();
  expect(out.same).toBe(true);
  expect(out.isDefault).toBe(false);
});

test("the grid template and the list's minimum width: every chosen column kept, sized columns, the last column's floor, when Name stays pinned (Review Focus 5)", async ({ page }) => {
  await load(page);
  const out = await page.evaluate((row) => {
    const { __cols: m, __defs: d } = window as unknown as Win;
    const s = m.defaultSet(d);
    const all = m.setShown(d, s, "created", true);
    return {
      plain: m.layoutColumns(d, s, {}, { ...row, available: null }),
      narrow: m.layoutColumns(d, all, {}, { ...row, available: 600 }),
      sized: m.layoutColumns(d, all, { notes: 400 }, { ...row, available: 700 }),
      floor: m.layoutColumns(d, s, {}, { ...row, available: null, lastFloor: (_last: string, prev?: string) => (prev === "tags" ? 140.2 : 0) }),
      fixed: m.layoutColumns(d, s, { name: 200, tags: 120, notes: 90 }, { ...row, available: null }),
      folder: m.layoutColumns(d, s, {}, { ...row, available: null, exclude: ["tags"] }),
      tiny: m.layoutColumns(d, m.setShown(d, s, "tags", false), {}, { ...row, available: 100 }),
      wideName: m.layoutColumns(d, s, { name: 400 }, { ...row, available: 700 }),
      noLead: m.layoutColumns(d, s, {}, { ...row, lead: 0, available: null }),
    };
  }, ROW);
  // Not measured yet: Notes (the fill column) takes any room. Once the list's
  // width is known, every column stretches (tableColumns.test.ts).
  expect(out.plain.template).toBe("28px var(--col-name,150px) var(--col-status,92px) var(--col-tags,96px) var(--col-notes,minmax(100px,1fr)) 108px");
  expect(out.plain).toMatchObject({ minWidth: 648, pinFirst: true });
  // Narrower than the columns: every chosen one stays; they give way to
  // their minimums first (controller ruling, 2026-09-30), Name last and only
  // when that ends the sideways scroll (Pair 31): here it can't, so Name
  // keeps its width, and the widths are the list's minimum (it scrolls
  // sideways inside its card).
  expect(out.narrow).toMatchObject({ shown: ["name", "status", "tags", "notes", "created"], minWidth: 662, pinFirst: true });
  expect(out.narrow.template).toBe("28px var(--col-name,150px) var(--col-status,92px) var(--col-tags,64px) var(--col-notes,minmax(64px,1fr)) var(--col-created,72px) 108px");
  // A column the person sized keeps its width, and the minimum grows with
  // it. Too wide for the list, nothing stretches; the row actions' track
  // keeps them at the card's right edge (Pair 24 fix round, I3).
  expect(out.sized).toMatchObject({ shown: ["name", "status", "tags", "notes", "created"], minWidth: 998 });
  expect(out.sized.template).toBe("28px var(--col-name,150px) var(--col-status,92px) var(--col-tags,64px) var(--col-notes,400px) var(--col-created,72px) minmax(108px,1fr)");
  expect(out.floor.template).toContain("var(--col-notes,minmax(141px,1fr))");
  expect(out.floor.minWidth).toBe(689);
  expect(out.fixed.template).toBe("28px var(--col-name,200px) var(--col-status,92px) var(--col-tags,120px) var(--col-notes,90px) minmax(108px,1fr)");
  expect(out.folder).toMatchObject({ shown: ["name", "status", "notes"], excluded: ["tags"] });
  // Name stays pinned unless the pinned parts (12 + 28 + 10 + Name + 10 at
  // the left, 108 + 12 at the right) would leave the scrolling columns under 160 px.
  expect(out.tiny).toMatchObject({ shown: ["name", "status", "notes"], minWidth: 506, pinFirst: false });
  expect(out.wideName).toMatchObject({ minWidth: 830, pinFirst: false });
  // What those pinned parts cover, for a focused control to stay clear of
  // (merge point 1): Name and its gap only while Name pins, at its width.
  expect(out.plain).toMatchObject({ pinStart: 210, pinEnd: 120 });
  expect(out.fixed).toMatchObject({ pinStart: 260, pinEnd: 120 });
  expect(out.tiny).toMatchObject({ pinStart: 50, pinEnd: 120 });
  // A list that selects nothing (a kit DataList without a select box, F23):
  // no lead track and no gap after it.
  expect(out.noLead.template).toBe("var(--col-name,150px) var(--col-status,92px) var(--col-tags,96px) var(--col-notes,minmax(100px,1fr)) 108px");
  expect(out.noLead).toMatchObject({ minWidth: 610, pinStart: 172 });
});

// Controller ruling (2026-09-30): at 1280 the Profiles columns were 1017 px
// against a 996 px list (Proxy fits a 316 px address), so it scrolled
// sideways. The columns no one sized give way first: Notes (the fill column)
// first (merge point 4), then the one furthest over its need, then the next
// with it, never under a minimum, never a sized one; Name last, and only
// when that ends the sideways scroll (Pair 31 ruling).
test("too wide for the list, the columns no one sized give way before it scrolls: Notes first, then the widest over its need, Name last, never under a minimum or a sized width", async ({ page }) => {
  await load(page);
  const out = await page.evaluate((row) => {
    const { __cols: m, __defs: d } = window as unknown as Win;
    const s = m.defaultSet(d);
    // Name 30 px over its need, Tags 104 px over: 782 px in all.
    const auto = { name: 180, tags: 200 };
    const at = (available: number, widths = {}) => m.layoutColumns(d, s, widths, { ...row, available, auto });
    return { room: at(800), tagsOnly: at(732), both: at(682), sized: at(682, { tags: 200 }), ended: at(700, { tags: 200 }) };
  }, ROW);
  // Room for all: each at its content's width, and the 18 px left over the
  // same to each (owner, 2026-10-23).
  expect(out.room).toMatchObject({ minWidth: 782, stretched: true });
  expect(out.room.template).toBe("28px var(--col-name,minmax(180px,184.5fr)) var(--col-status,minmax(92px,96.5fr)) var(--col-tags,minmax(200px,204.5fr)) var(--col-notes,minmax(100px,104.5fr)) 108px");
  // 50 px over: Notes gives its 36 px down to its minimum first, then Tags
  // (104 px over its need, Name 30) the 14 px left.
  expect(out.tagsOnly).toMatchObject({ minWidth: 732 });
  expect(out.tagsOnly.template).toBe("28px var(--col-name,180px) var(--col-status,92px) var(--col-tags,186px) var(--col-notes,minmax(64px,1fr)) 108px");
  // 100 px over: Notes its 36, and Name gives way last, so Tags gives the other 64.
  expect(out.both).toMatchObject({ minWidth: 682 });
  expect(out.both.template).toBe("28px var(--col-name,180px) var(--col-status,92px) var(--col-tags,136px) var(--col-notes,minmax(64px,1fr)) 108px");
  // Tags sized by hand keeps its 200 px; Notes goes to its 64 px minimum
  // (Status is at its own), and Name's 60 px can't cover the 64 px left, so
  // Name keeps its 180 px and the list scrolls sideways.
  expect(out.sized).toMatchObject({ minWidth: 746 });
  expect(out.sized.template).toBe("28px var(--col-name,180px) var(--col-status,92px) var(--col-tags,200px) var(--col-notes,minmax(64px,1fr)) 108px");
  // 82 px over: Notes gives its 36 px down to its minimum first, then Name
  // the 46 px left, which ends the scroll.
  expect(out.ended).toMatchObject({ minWidth: 700 });
  expect(out.ended.template).toBe("28px var(--col-name,134px) var(--col-status,92px) var(--col-tags,200px) var(--col-notes,minmax(64px,1fr)) 108px");
});

// Controller ruling (merge point 4): a column that folds gives way no
// further than its folded form (Tags: one chip and "+N", EMIL-15); Name
// after it, and the list scrolls only once the others sit at their floors.
test("a folding column gives way no further than its folded form; Name gives the rest, and only then does the list scroll", async ({ page }) => {
  await load(page);
  const out = await page.evaluate((row) => {
    const { __cols: m, __defs: d } = window as unknown as Win;
    const s = m.defaultSet(d);
    // Name 180, Status 92, Tags 200, Notes 100 and a 210 px frame: 782 px.
    const auto = { name: 180, tags: 200 };
    const at = (available: number, floor: Record<string, number>) => m.layoutColumns(d, s, {}, { ...row, available, auto, floor });
    return { free: at(600, {}), folded: at(600, { tags: 90 }), over: at(600, { tags: 250 }), scrolls: at(500, { tags: 90 }) };
  }, ROW);
  // 182 px over, no floor: Notes to its 64 px minimum, Tags to 64, Name the 10 px left.
  expect(out.free.template).toBe("28px var(--col-name,170px) var(--col-status,92px) var(--col-tags,64px) var(--col-notes,minmax(64px,1fr)) 108px");
  // Tags stops at its 90 px fold, so Name gives 36 px.
  expect(out.folded).toMatchObject({ minWidth: 600 });
  expect(out.folded.template).toBe("28px var(--col-name,144px) var(--col-status,92px) var(--col-tags,90px) var(--col-notes,minmax(64px,1fr)) 108px");
  // A fold wider than the column's own width: the column keeps its width.
  expect(out.over.template).toContain("var(--col-tags,200px)");
  // 282 px over: Name's 60 px can't end the scroll, so it keeps its width
  // and the list scrolls with every other column at its floor.
  expect(out.scrolls).toMatchObject({ minWidth: 636 });
  expect(out.scrolls.template).toBe("28px var(--col-name,180px) var(--col-status,92px) var(--col-tags,90px) var(--col-notes,minmax(64px,1fr)) 108px");
});

// Controller ruling (merge point 3): short of room, the part of a column
// that gives way first (the Proxies Test result's IP) moves into its
// tooltip, whole, before any column is cut; a column a person made too
// narrow for it does the same. And the room left over first makes whole only
// a cut column it can, the nearest first: a long name that stays cut anyway
// stretches from the short names' width ("OK 56 ms 2…" and a Name grown past
// its fit were both read at merge point 3).
test("short of room, a column's part that gives way goes whole before any column is cut; the room left over first makes whole only a column it can", async ({ page }) => {
  await load(page);
  const out = await page.evaluate((row) => {
    const { __cols: m, __defs: d } = window as unknown as Win;
    // Name, Status, Tags, Created: 150 + 92 + 200 + 96 and a 210 px frame, 748 px.
    const s = m.setShown(d, m.setShown(d, m.defaultSet(d), "notes", false), "created", true);
    const auto = { tags: 200 };
    const short = { tags: 110 };
    const at = (available: number | null, widths = {}) => m.layoutColumns(d, s, widths, { ...row, available, auto, short });
    const grown = (available: number | null) =>
      m.layoutColumns(d, s, {}, { ...row, available, auto: { name: 160 }, full: { name: 420, created: 130 } });
    return {
      room: at(800), tight: at(740), tighter: at(600), sized: at(null, { tags: 150 }), sizedWide: at(null, { tags: 220 }),
      nearest: grown(800), both: grown(1000),
    };
  }, ROW);
  // Room for all: the part stays in the column.
  expect(out.room).toMatchObject({ shortened: [], minWidth: 748 });
  // 8 px over: it goes, whole, and nothing is cut.
  expect(out.tight).toMatchObject({ shortened: ["tags"], minWidth: 658 });
  expect(out.tight.template).toBe("28px var(--col-name,150px) var(--col-status,92px) var(--col-tags,110px) var(--col-created,96px) minmax(108px,1fr)");
  // Still over once it has gone: then the columns give way as before.
  expect(out.tighter).toMatchObject({ shortened: ["tags"], minWidth: 600 });
  // A width a person set stays theirs; under the content's, the part goes.
  expect(out.sized.shortened).toEqual(["tags"]);
  expect(out.sized.template).toContain("var(--col-tags,150px)");
  expect(out.sizedWide.shortened).toEqual([]);
  // 146 px to spare: Created (34 px from whole) grows, Name (260, past twice
  // the 112 px left) does not; the 112 px over every column but the last,
  // which keeps its own at the actions (owner, 2026-10-23).
  expect(out.nearest.drawn).toEqual({ name: 197.33, status: 129.33, tags: 133.33, created: 130 });
  // 346 px: both, and 17.33 to each but the last.
  expect(out.both.drawn).toEqual({ name: 437.33, status: 109.33, tags: 113.33, created: 130 });
  expect(out.both.template).toBe("28px var(--col-name,minmax(160px,437.33fr)) var(--col-status,minmax(92px,109.33fr)) var(--col-tags,minmax(96px,113.33fr)) var(--col-created,minmax(96px,130fr)) 108px");
});

test("a column's width from its content: nine rows in ten fit and a near miss too, a lone long one never sets it, the header label is a floor, inside its range (owner, 2026-09-30)", async ({ page }) => {
  await load(page);
  const out = await page.evaluate(() => {
    const { __cols: m, __defs: d } = window as unknown as Win;
    const short = [80, 90, 95, 100, 102, 104, 106, 108, 110];
    return {
      p90: {
        none: m.p90([]),
        one: m.p90([5]),
        // Under ten rows the one widest is left out too: many short, one long.
        few: m.p90([400, 10, 20, 30]),
        ten: m.p90([...short, 600]),
        twenty: m.p90([...Array(18).fill(100), 500, 600]),
        more: m.p90([...Array(19).fill(100), 500, 600]),
      },
      widths: {
        // Nine short and one long: the ninth, and 1 px so it never shows an ellipsis.
        name: m.fitWidth(d[0], { cells: [...short.map((x) => x + 60), 900], header: 40 }),
        // Under its minimum.
        tags: m.fitWidth(d[2], { cells: [10, 12], header: 30 }),
        // Its header label is wider than every cell.
        created: m.fitWidth(d[4], { cells: [20, 20, 20], header: 80.2 }),
        // Over its maximum.
        notes: m.fitWidth(d[3], { cells: [2000, 2000], header: 10 }),
        // A near miss, up to a third wider than nine in ten, fits too; past that it truncates.
        nearMiss: m.fitWidth(d[0], { cells: [...Array(8).fill(200), 260], header: 0 }),
        pastIt: m.fitWidth(d[0], { cells: [...Array(8).fill(200), 280], header: 0 }),
        // An empty cell is not a short one (autofit review C1): seven rows
        // with no tags and one with 80 px of them size to that one.
        sparse: m.fitWidth(d[2], { cells: [0, 0, 0, 0, 0, 0, 0, 80], header: 30 }),
        // Nothing in any row: the header label alone, under the minimum too
        // (owner, 2026-10-07, item 9: an empty column is no wider than its title).
        empty: m.fitWidth(d[2], { cells: [0, 0, 0], header: 30 }),
      },
    };
  });
  expect(out.p90).toEqual({ none: 0, one: 5, few: 30, ten: 110, twenty: 100, more: 100 });
  expect(out.widths).toEqual({ name: 171, tags: 64, created: 82, notes: 640, nearMiss: 261, pastIt: 201, sparse: 81, empty: 31 });
});

test("measured widths feed the grid: a column's own width wins over its content's; before the list is measured the spare room lets a cut column show whole, then goes to Notes or the row actions' track (owner, 2026-09-30)", async ({ page }) => {
  await load(page);
  const out = await page.evaluate((row) => {
    const { __cols: m, __defs: d } = window as unknown as Win;
    const s = m.defaultSet(d);
    const auto = { name: 180, tags: 70, created: 90 };
    const all = m.setShown(d, s, "created", true);
    const measured = m.measureColumns(d, [{ n: "aaa" }, { n: "aaaa" }, { n: "aaaaaaaaaa" }], { name: (r: { n: string }) => r.n.length * 50 }, (t: string) => t.length, () => 0);
    // A fast measure ranks every row; the exact one measures again only the
    // rows at the rank and just under it, and the widest of those wins: here
    // "w…" reads 98 fast (under the rank's "b…", 100) but 128 exact.
    const laidOut: string[] = [];
    const names = [..."aaaaaa"].map(() => "a").concat(["aaaa", "aaaaa", "wwwwwwwwwv", "bbbbbbbbbb", "zzzzzzzzzzzzzzzzzzzz"]);
    const fast = (t: string) => (t.startsWith("w") ? 98 : t.length * 10);
    const exact = (texts: { text: string }[]) => texts.map(({ text: t }) => { laidOut.push(t); return t.startsWith("w") ? 128 : t.length * 10; });
    const ranked = m.measureColumns(d, names.map((n) => ({ n })), { name: (r: { n: string }, mm: (t: string) => number) => mm(r.n) }, fast, () => 0, exact);
    return {
      auto: m.layoutColumns(d, s, {}, { ...row, available: null, auto }),
      mine: m.layoutColumns(d, s, { name: 300 }, { ...row, available: null, auto }),
      noNotes: m.layoutColumns(d, m.setShown(d, all, "notes", false), {}, { ...row, available: null, auto }),
      // Name and Tags cut some rows (their whole content is wider); Created
      // shows all of its. A sized Name never grows.
      grow: m.layoutColumns(d, s, {}, { ...row, available: null, auto, full: { name: 260, tags: 70, created: 90 } }),
      growNoNotes: m.layoutColumns(d, m.setShown(d, all, "notes", false), { name: 200 }, { ...row, available: null, auto, full: { name: 260, tags: 90 } }),
      measured,
      ranked,
      laidOut,
      same: [m.sameWidths({ a: 1 }, { a: 1 }), m.sameWidths({ a: 1 }, { a: 2 }), m.sameWidths({ a: 1 }, { a: 1, b: 2 })],
    };
  }, ROW);
  expect(out.auto.template).toBe("28px var(--col-name,180px) var(--col-status,92px) var(--col-tags,70px) var(--col-notes,minmax(100px,1fr)) 108px");
  expect(out.auto.minWidth).toBe(648 - 150 + 180 - 96 + 70);
  expect(out.mine.template).toContain("var(--col-name,300px)");
  // Not measured yet, Notes hidden: the row actions' track takes any room
  // until the list's width is known.
  expect(out.noNotes.template).toBe("28px var(--col-name,180px) var(--col-status,92px) var(--col-tags,70px) var(--col-created,90px) minmax(108px,1fr)");
  // The room left over: first a cut column up to its whole content, then Notes.
  expect(out.grow.template).toBe("28px var(--col-name,minmax(180px,260px)) var(--col-status,92px) var(--col-tags,70px) var(--col-notes,minmax(100px,1fr)) 108px");
  expect(out.grow.minWidth).toBe(out.auto.minWidth);
  expect(out.growNoNotes.template).toBe("28px var(--col-name,200px) var(--col-status,92px) var(--col-tags,minmax(70px,90px)) var(--col-created,90px) minmax(108px,1fr)");
  // Only the columns with a fit are measured, over every row: 150, 200 and
  // 500 px (under ten rows, the one widest is left out); all of them fit in 501.
  expect(out.measured).toEqual({ fit: { name: 201 }, full: { name: 501 } });
  // The exact pass also lays out the widest row, for the whole width.
  expect(out.ranked).toEqual({ fit: { name: 129 }, full: { name: 201 } });
  expect(out.laidOut.sort()).toEqual(["bbbbbbbbbb", "wwwwwwwwwv", "zzzzzzzzzzzzzzzzzzzz"]);
  expect(out.same).toEqual([true, false, false]);
});

test("1,000 profiles measure fast (5 to 9 ms alone), each text once, in the cell's own font (owner, 2026-09-30)", async ({ page }) => {
  await load(page);
  await appModule(page, "/src/shared/lib/textWidth.ts", "__text");
  await appModule(page, "/src/widgets/ProfileTable/profileFits.ts", "__fits");
  await appModule(page, "/src/entities/profile/index.ts", "__profiles");
  const out = await page.evaluate(() => {
    type Fits = typeof import("../src/widgets/ProfileTable/profileFits");
    type Profiles = typeof import("../src/entities/profile");
    const w = window as unknown as Win & { __fits: Fits; __profiles: Profiles };
    const { __cols: m, __text: tw } = w;
    const host = document.querySelector<HTMLElement>("[role='treegrid']")!;
    // As the list measures: every row's own name, a few Folders, proxies and
    // times. Three lists of new names, so each first measuring is a cold one.
    const list = (set: string) => Array.from({ length: 1000 }, (_, i) => ({
      id: `p${i}`, name: `Profile ${set}${i}-${"x".repeat(i % 37)}`, pinned: i % 9 === 0, folder: i % 3 ? `Folder ${i % 12}` : "",
      proxy_id: i % 4 ? `px-${i % 20}` : null, last_launched_at: `@${1_756_000_000 - (i % 40) * 3600}`, created_at: `@${1_750_000_000 - (i % 90) * 86_400}`,
      total_runtime_ms: (i % 50) * 3_600_000, mobile: i % 5 === 0, extensions: [], notes: "",
    })) as unknown as import("../src/entities/profile").ProfileMeta[];
    const [rows, again, third] = [list("A"), list("B"), list("C")];
    const proxies = new Map(Array.from({ length: 20 }, (_, k) => [`px-${k}`, { id: `px-${k}`, name: "", kind: "socks5", host: `10.0.0.${k}`, port: 1080, country: "US" }]));
    const fits = w.__fits.profileFits({ proxyOf: (id) => proxies.get(id) as never, tagsOf: () => [], lang: "en", now: Date.now() });
    const defs = w.__profiles.PROFILE_COLUMNS;
    // As the list measures (useAutoWidths): the columns on screen, every row
    // by the canvas, then the few that decide each width laid out by the page.
    const run = (ids: string[], these = rows) => {
      const measure = tw.measurer(host);
      const onScreen = Object.fromEntries(ids.filter((id) => id in fits).map((id) => [id, fits[id as keyof typeof fits]]));
      const laidOut = tw.layoutWidths(host, ids.map((x) => ({ text: x, role: "medium" as const })));
      const titles = new Map(ids.map((id, i) => [id, laidOut[i]]));
      return m.measureColumns(defs, these, onScreen, measure, (id) => titles.get(id) ?? 0, (texts) => tw.layoutWidths(host, texts));
    };
    // Playwright's clock rounds performance.now() up to a whole ms. The
    // median of three runs, so a busy machine's one slow moment (other lanes,
    // the owner's own work) doesn't count (review M8).
    const time = (f: () => unknown) => { const t = performance.now(); f(); return performance.now() - t; };
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[1];
    const DEFAULT_SHOWN = ["name", "status", "folder", "tags", "proxy", "notes"];
    let widths!: ReturnType<typeof run>;
    const cold = median([time(() => { widths = run(DEFAULT_SHOWN); }), time(() => run(DEFAULT_SHOWN, again)), time(() => run(DEFAULT_SHOWN, third))]);
    // Every column turned on: their texts are new, the names already known.
    // It happens once, so one run, with a looser bound for the same reason.
    let all!: ReturnType<typeof run>;
    const showAll = time(() => { all = run(defs.map((x) => x.id)); });
    const warm = median([0, 1, 2].map(() => time(() => run(defs.map((x) => x.id)))));
    // The canvas agrees with the page's own layout of the same text.
    const measure = tw.measurer(host);
    const probe = document.createElement("span");
    probe.className = "text-ui";
    probe.style.cssText = "position:absolute;white-space:nowrap;visibility:hidden";
    probe.textContent = rows[998].name;
    host.append(probe);
    const laidOut = probe.getBoundingClientRect().width;
    probe.remove();
    return { cold, showAll, warm, widths, all, laidOut, measured: measure(rows[998].name, "ui"), mono: tw.readFonts(host).mono.font };
  });
  expect(out.cold).toBeGreaterThan(0);
  // Alone it takes 5 to 9 ms; the bounds leave room for a machine that is
  // busy with other lanes' tests and the owner's own work (review M8).
  expect(out.cold).toBeLessThan(20);
  expect(out.showAll).toBeLessThan(25);
  expect(out.warm).toBeLessThanOrEqual(out.cold);
  // Every column with text, Notes too (the fill keeps its width; its text
  // only feeds the room left over: owner, 2026-10-23). Status sizes to its
  // widest pill, which in English is under its 96 px minimum.
  expect(Object.keys(out.widths.fit).sort()).toEqual(["folder", "name", "notes", "proxy", "status", "tags"]);
  expect(Object.keys(out.all.fit).sort()).toEqual(["created", "device", "extensions", "folder", "lastRun", "name", "notes", "proxy", "runTime", "status", "tags"]);
  expect(out.widths.fit.status).toBe(96);
  // The canvas ranks within a few percent of the page's layout (the rows
  // that decide a width are laid out by the page itself: useAutoWidths).
  expect(Math.abs(out.measured / out.laidOut - 1)).toBeLessThan(0.03);
  expect(out.mono).toContain("JetBrains Mono");
});

test("only a version 2 value reads as stored, and it comes back as saved (Review Focus 1)", async ({ page }) => {
  await load(page);
  const out = await page.evaluate(() => {
    const { __cols: m, __defs: d } = window as unknown as Win;
    const s = m.placeBefore(d, m.defaultSet(d), "notes", "status");
    const stored = m.toStored(s, { tags: 70 });
    return {
      stored,
      back: m.fromStored(d, JSON.parse(JSON.stringify(stored))),
      v1: m.fromStored(d, { folder: true, tags: false }),
      v3: m.fromStored(d, { v: 3, order: [], hidden: [] }),
      junk: m.fromStored(d, "{"),
    };
  });
  expect(out.stored).toEqual({ v: 2, order: ["name", "notes", "status", "tags", "created"], hidden: ["created"], widths: { tags: 70 } });
  expect(out.back).toEqual({ set: { order: ["name", "notes", "status", "tags", "created"], hidden: ["created"] }, widths: { tags: 70 } });
  expect(out.v1).toBeNull();
  expect(out.v3).toBeNull();
  expect(out.junk).toBeNull();
});

test("the list both menus show: every column in order, and why a chosen one is left out or can't be hidden", async ({ page }) => {
  await load(page);
  const out = await page.evaluate(() => {
    const { __cols: m, __defs: d } = window as unknown as Win;
    return m.columnChoices(d, m.defaultSet(d), { excluded: ["tags"] }, (k: string) => k, "inFolder");
  });
  expect(out).toEqual([
    { id: "name", title: "name", checked: true, disabled: true, note: "tableColumns.alwaysShown" },
    { id: "status", title: "status", checked: true, disabled: true, note: "tableColumns.alwaysShown" },
    { id: "tags", title: "tags", checked: true, disabled: false, note: "inFolder" },
    { id: "notes", title: "notes", checked: true, disabled: false, note: undefined },
    { id: "created", title: "created", checked: false, disabled: false, note: undefined },
  ]);
});
