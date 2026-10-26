// node --test: the edition-carrying writes are exactly the backend's, worded refusals match the
// backend's, and every call of one goes through the wrapper (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EPOCH_WRITES, SPACE_REFUSALS } from "./epochWrites.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const rust = (path: string) => readFileSync(join(ROOT, "src-tauri/src", path), "utf8");

/** Each `#[tauri::command]` in the backend's sources whose parameters name `epoch: Option<u64>`. */
function commandsTakingEpoch(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!name.endsWith(".rs")) continue;
      for (const part of readFileSync(p, "utf8").split("#[tauri::command]").slice(1)) {
        const sig = part.slice(0, part.indexOf("{"));
        const fn = /\bfn\s+([a-z_0-9]+)/.exec(sig)?.[1];
        if (fn && /\bepoch\s*:\s*Option<u64>/.test(sig)) out.push(fn);
      }
    }
  };
  walk(join(ROOT, "src-tauri/src"));
  return out.sort();
}

test("the list is every backend command that takes epoch, and no other", () => {
  const backend = commandsTakingEpoch();
  // The parse must see the real list, or an empty one would pass.
  assert.ok(backend.length > 20 && backend.includes("profile_save") && backend.includes("tag_save"), String(backend));
  assert.deepEqual([...EPOCH_WRITES].sort(), backend);
});

test("the refusals are the backend's own words", () => {
  assert.ok(rust("space/mod.rs").includes(`"${SPACE_REFUSALS.noEpoch}"`));
  assert.ok(rust("space/error.rs").includes(`"${SPACE_REFUSALS.spaceChanged}"`));
});

test("every call of a write that carries the edition goes through the wrapper", () => {
  const SRC = join(ROOT, "src");
  const files: string[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      // The mock backend answers these calls; it never makes them.
      if (statSync(p).isDirectory()) { if (p !== join(SRC, "dev")) walk(p); }
      else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) files.push(p);
    }
  })(SRC);
  const call = /\binvoke\s*(?:<[^()]*>)?\s*\(\s*["']([a-z_]+)["']/g;
  const viaWrapper = /import\s*\{[^}]*\binvoke\b[^}]*\}\s*from\s*["'][./]*\/?(?:shared\/)?api\/invoke["']/;
  const stray: string[] = [];
  let seen = 0;
  for (const file of files) {
    if (file.endsWith(join("shared", "api", "invoke.ts"))) continue;
    const src = readFileSync(file, "utf8");
    const writes = [...src.matchAll(call)].map((m) => m[1]).filter((c) => EPOCH_WRITES.has(c));
    seen += writes.length;
    if (writes.length && !viaWrapper.test(src)) stray.push(`${file.slice(SRC.length + 1)}: ${writes.join(", ")}`);
  }
  assert.ok(seen > 20, `found only ${seen} calls: the scan is broken`);
  assert.deepEqual(stray, []);
});
