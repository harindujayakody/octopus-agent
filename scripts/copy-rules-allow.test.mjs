// The shipped allowlist is a ratchet: every line still breaks its rule, and a
// string it does not list fails (G1b, proves check:i18n's copy pass bites).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allowed, copyProblems, noteTexts, staleAllow } from "./lib/copy-rules.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const en = read("src/shared/i18n/locales/en.json");
const zh = read("src/shared/i18n/locales/zh.json");
const ru = read("src/shared/i18n/locales/ru.json");
const notes = noteTexts(read("src/widgets/WhatsNewDialog/patchlog.json"));
const allow = read("scripts/copy-rules.allow.json");

test("every shipped string passes or is allowlisted, and no allowlist line is stale", () => {
  const found = copyProblems({ en, zh, ru, notes });
  assert.deepEqual(found.filter((p) => !allowed(allow, p)), []);
  assert.deepEqual(staleAllow(allow, found), []);
});

test("a new violating string is not allowlisted", () => {
  const found = copyProblems({ en: { "x.new": "Pick a colour" }, zh: {}, notes: [] });
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, "us-spelling");
  assert.equal(allowed(allow, found[0]), false);
});
