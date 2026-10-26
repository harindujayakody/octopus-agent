import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PALETTE } from "../src/entities/automation/model/palette";

// The picker shows one line per step: a title and a short description. A
// title that repeats another step's is a choice nobody can make, and a zh
// description longer than one line at 1280 px is cut off.
const load = (lang: string) => JSON.parse(readFileSync(new URL(`../src/shared/i18n/locales/${lang}.json`, import.meta.url), "utf8")) as Record<string, string>;
const blocks = PALETTE.flatMap((c) => c.blocks);

for (const lang of ["en", "zh", "ru"]) {
  test(`every step title is unique in ${lang}`, () => {
    const t = load(lang);
    const titles = blocks.map((b) => t[b.label]);
    expect(titles.filter((x) => !x)).toEqual([]);
    const dupes = titles.filter((x, i) => titles.indexOf(x) !== i);
    expect(dupes).toEqual([]);
  });
}

test("zh step descriptions stay one line (24 characters or fewer)", () => {
  const zh = load("zh");
  const long = blocks.map((b) => zh[b.about]).filter((s) => s && [...s].length > 24);
  expect(long).toEqual([]);
});

test("no step title or description holds an em dash or a middot", () => {
  const bad: string[] = [];
  for (const lang of ["en", "zh", "ru"]) {
    const t = load(lang);
    for (const b of blocks) for (const k of [b.label, b.about]) if (/[\u2014\u00b7]/.test(t[k] ?? "")) bad.push(`${lang} ${k}`);
  }
  expect(bad).toEqual([]);
});
