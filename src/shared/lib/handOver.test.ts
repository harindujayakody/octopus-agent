// node --test: the one-time move of tags and folders from this window's
// storage into the backend (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { handOver, type KeyStore } from "./handOver.ts";

/** A window's storage. */
function storage(seed: Record<string, string>): KeyStore & { keys: () => string[] } {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => m.get(k) ?? null,
    removeItem: (k) => { m.delete(k); },
    keys: () => [...m.keys()],
  };
}

/** A backend that records each send. Whether it takes one is its own rule
 *  (tags.rs and folders.rs `import_at`), so it answers `taken` as told. */
function backend(taken = true) {
  const sent: Record<string, string | null>[] = [];
  return {
    send: async (raw: Record<string, string | null>) => { sent.push(raw); return taken; },
    sent,
  };
}

const TAGS = JSON.stringify({ version: 1, tags: [{ id: "t-vip", name: "VIP", color: "violet" }], byProfile: {} });

test("what an older build kept goes over once, and its key is gone", async () => {
  const s = storage({ "shardx.tags": TAGS, "shardx.lang": "en" });
  const b = backend();
  assert.equal(await handOver(s, ["shardx.tags"], b.send), true);
  assert.deepEqual(b.sent, [{ "shardx.tags": TAGS }]);
  assert.deepEqual(s.keys(), ["shardx.lang"]);
  // The next start finds nothing to send.
  assert.equal(await handOver(s, ["shardx.tags"], b.send), false);
  assert.equal(b.sent.length, 1);
});

test("a key found again is sent again and goes, even when the backend had its copy already", async () => {
  // Another window, or an older build run since: the backend answers false
  // and keeps what it had; this window still drops the key.
  const again = storage({ "shardx.tags": JSON.stringify({ version: 1, tags: [], byProfile: {} }) });
  const b = backend(false);
  assert.equal(await handOver(again, ["shardx.tags"], b.send), true);
  assert.equal(b.sent.length, 1);
  assert.deepEqual(again.keys(), []);
});

test("keys that go together go in one send, a missing one as null", async () => {
  const s = storage({ "shardx-folders": "[\"Empty1\"]" });
  const b = backend();
  assert.equal(await handOver(s, ["shardx-folders", "shardx.folderMeta"], b.send), true);
  assert.deepEqual(b.sent, [{ "shardx-folders": "[\"Empty1\"]", "shardx.folderMeta": null }]);
  assert.deepEqual(s.keys(), []);
});

test("a send that fails keeps the keys for the next start", async () => {
  const s = storage({ "shardx.tags": TAGS });
  await assert.rejects(handOver(s, ["shardx.tags"], () => Promise.reject(new Error("disk full"))));
  assert.deepEqual(s.keys(), ["shardx.tags"]);
  const b = backend();
  assert.equal(await handOver(s, ["shardx.tags"], b.send), true);
  assert.deepEqual(b.sent, [{ "shardx.tags": TAGS }]);
});

test("nothing kept, or storage blocked: nothing is sent", async () => {
  const b = backend();
  assert.equal(await handOver(storage({ "shardx.lang": "en" }), ["shardx.tags"], b.send), false);
  assert.equal(await handOver(null, ["shardx.tags"], b.send), false);
  const blocked: KeyStore = { getItem: () => { throw new Error("SecurityError"); }, removeItem: () => {} };
  assert.equal(await handOver(blocked, ["shardx.tags"], b.send), false);
  assert.equal(b.sent.length, 0);
});
