import { expect, test } from "@playwright/test";
import { PALETTE, blockIcon, categoryIcon } from "../src/entities/automation/model/palette";

// Pure logic, no page: runs with the e2e project.

test.describe("blockIcon", () => {
  test("gives every category and every step a glyph, no two alike in one category", () => {
    for (const c of PALETTE) {
      expect(c.icon, c.id).toBeTruthy();
      const seen = new Set<unknown>();
      for (const b of c.blocks) {
        expect(b.icon, b.kind).toBeTruthy();
        expect(seen.has(b.icon), `${c.id}: ${b.kind} repeats a glyph`).toBe(false);
        seen.add(b.icon);
        expect(blockIcon(b.kind)).toBe(b.icon);
      }
    }
  });
  test("falls back: module step, then the category, then one generic glyph", () => {
    const generic = blockIcon("no.such.kind");
    expect(generic).toBeTruthy();
    expect(blockIcon("module:x:y")).not.toBe(generic);
    expect(blockIcon("no.such.kind", "pointer")).toBe(PALETTE.find((c) => c.id === "pointer")!.icon);
    expect(categoryIcon("pointer")).toBe(PALETTE.find((c) => c.id === "pointer")!.icon);
    expect(categoryIcon("group:custom")).toBe(blockIcon("module:x:y"));
  });
});
