// node --test: the refusal to add an extension twice reads back as the backend writes it
// (extensions.rs already_in_library), and the update helpers count what they should.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canUpdate, conflictFromSync, goneFromStore, hoursSince, parseAlreadyInLibrary, percentOf, updatableCount, versionAtLeast } from "./updates.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

test("already_in_library reads back from the URL import and from a file's", () => {
  const one = 'already_in_library {"entry_id":"a1b2","installed":"13.46.1","separate":true}';
  assert.deepEqual(parseAlreadyInLibrary(one), { entry_id: "a1b2", installed: "13.46.1", separate: true });
  const file = `/Users/you/Downloads/x.crx: ${one.replace("true", "false")}`;
  assert.deepEqual(parseAlreadyInLibrary(file), { entry_id: "a1b2", installed: "13.46.1", separate: false });
  assert.equal(parseAlreadyInLibrary("the Web Store has no extension with that id"), null);
  assert.equal(parseAlreadyInLibrary("already_in_library {not json"), null);
});

test("the refusal's code is the backend's", () => {
  const rust = readFileSync(join(ROOT, "src-tauri/src/space/local/extensions.rs"), "utf8");
  assert.ok(rust.includes('const ALREADY_IN_LIBRARY: &str = "already_in_library";'));
  assert.ok(rust.includes('"entry_id": entry_id, "installed": installed, "separate": separate'));
});

test("only an available or ready version with no flag counts", () => {
  const u = (state: string, flags: string[] = []) => ({ state, flags }) as unknown as Parameters<typeof canUpdate>[0];
  assert.equal(canUpdate(u("available")), true);
  assert.equal(canUpdate(u("ready")), true);
  assert.equal(canUpdate(u("available", ["malware"])), false);
  for (const s of ["waiting", "confirm", "failed", "current", "unlinked"]) assert.equal(canUpdate(u(s)), false, s);
  // The sidebar also counts one that asks first, never a flagged one.
  assert.equal(updatableCount({ a: u("available")!, b: u("ready")!, c: u("waiting")!, d: u("confirm")!, e: u("confirm", ["malware"])! } as never), 3);
});

test("engine versions compare part by part", () => {
  assert.equal(versionAtLeast("152.0.7977.65", "152.0.7977.65"), true);
  assert.equal(versionAtLeast("160.0.8000.0", "152.0.7977.65"), true);
  assert.equal(versionAtLeast("152.0.7977.65", "160.0.8000.0"), false);
  assert.equal(versionAtLeast("152.1", "152.0.9999.9"), true);
  assert.equal(versionAtLeast("x", "1"), false);
});

test("a taken-down item and a synced ID conflict read back from updates.rs and swap.rs", () => {
  const updates = readFileSync(join(ROOT, "src-tauri/src/space/local/extensions/updates.rs"), "utf8");
  const swap = readFileSync(join(ROOT, "src-tauri/src/space/local/extensions/swap.rs"), "utf8");
  assert.ok(updates.includes('"the Web Store does not know this extension ({s})"'));
  assert.equal(goneFromStore({ state: "failed", error: "the Web Store does not know this extension (noupdate)" }), true);
  assert.equal(goneFromStore({ state: "failed", error: "the download does not match the Web Store's hash" }), false);
  assert.ok(swap.includes("the version from the other computer would change this extension's ID here"));
  assert.equal(conflictFromSync({ error: "the version from the other computer would change this extension's ID here, so it was not applied" }), true);
  assert.equal(conflictFromSync({ error: "the update would change the extension's ID, so it was not applied" }), false);
});

test("progress and age", () => {
  assert.equal(percentOf({ phase: "download", received: 50, total: 200 }), 25);
  assert.equal(percentOf({ phase: "download", received: 50, total: 0 }), null);
  assert.equal(hoursSince(1_000_000, (1_000_000 + 3 * 3600 + 59) * 1000), 3);
});
