// node --test: the order and the failure path of a store's backend writes
// (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeQueue } from "./writeQueue.ts";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test("writes wait for the first read and go in the order they were made", async () => {
  const done: string[] = [];
  let loaded!: () => void;
  const write = writeQueue(new Promise<void>((r) => { loaded = r; }), () => {}, async () => {});
  void write(async () => { await tick(20); done.push("a"); });
  const last = write(async () => { done.push("b"); });
  await tick(5);
  assert.deepEqual(done, []);
  loaded();
  await last;
  assert.deepEqual(done, ["a", "b"]);
});

test("a failed write is reported and the state is read again once the rest went", async () => {
  const seen: string[] = [];
  const write = writeQueue(Promise.resolve(), (e) => seen.push(`failed: ${String(e)}`), async () => { seen.push("reread"); });
  void write(() => Promise.reject("disk full"));
  const last = write(async () => { seen.push("next"); });
  await last;
  assert.deepEqual(seen, ["failed: disk full", "next", "reread"]);
  // Nothing failed since: no second read.
  await write(async () => { seen.push("later"); });
  assert.deepEqual(seen, ["failed: disk full", "next", "reread", "later"]);
});

test("a first read that failed still lets the writes go", async () => {
  const done: string[] = [];
  const write = writeQueue(Promise.reject(new Error("offline")), () => {}, async () => {});
  await write(async () => { done.push("a"); });
  assert.deepEqual(done, ["a"]);
});

test("a read shown while changes waited is read again once they went", async () => {
  const seen: string[] = [];
  let loaded!: () => void;
  const write = writeQueue(new Promise<void>((r) => { loaded = r; }), () => {}, async () => { seen.push("reread"); });
  const last = write(async () => { seen.push("a"); });
  // The first read comes back before the change it lacks is sent.
  write.shown();
  loaded();
  await last;
  assert.deepEqual(seen, ["a", "reread"]);
  // A read shown with nothing waiting is not read again.
  write.shown();
  await write(async () => { seen.push("b"); });
  assert.deepEqual(seen, ["a", "reread", "b"]);
});


test("a queued write carries the space it was made in, not the one in use when it goes", async () => {
  const { epochForWrite, setSpaceEpoch } = await import("../api/edition.ts");
  setSpaceEpoch(7);
  const sent: (number | undefined)[] = [];
  let loaded!: () => void;
  const write = writeQueue(new Promise<void>((r) => { loaded = r; }), () => {}, async () => {});
  void write(async () => { sent.push(epochForWrite()); });
  const last = write(async () => { sent.push(epochForWrite()); });
  // The launcher moved on before the queue went: each still names space 7.
  setSpaceEpoch(8);
  const later = write(async () => { sent.push(epochForWrite()); });
  loaded();
  await last;
  await later;
  assert.deepEqual(sent, [7, 7, 8]);
  // Outside a queued write, the space in use.
  assert.equal(epochForWrite(), 8);
});
