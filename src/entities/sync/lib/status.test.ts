// node --test: the Sync tab's status line and a profile's sync (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { profileSyncOf, syncLine } from "./status.ts";

const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}:${Object.values(vars).join(",")}` : key);
const date = (s: number) => `d${s}`;
const NOW = 1_000_000;

test("idle reads how long ago it synced, then a date", () => {
  assert.equal(syncLine({ state: "idle", pending: 0, last_sync_at: NOW - 10 }, NOW, t, date).title, "sync.syncedJustNow");
  assert.equal(syncLine({ state: "idle", pending: 0, last_sync_at: NOW - 125 }, NOW, t, date).title, "sync.syncedMinutes:2");
  assert.equal(syncLine({ state: "idle", pending: 0, last_sync_at: NOW - 7300 }, NOW, t, date).title, "sync.syncedHours:2");
  assert.equal(syncLine({ state: "idle", pending: 0, last_sync_at: NOW - 90_000 }, NOW, t, date).title, `sync.syncedOn:d${NOW - 90_000}`);
  assert.deepEqual(syncLine({ state: "idle", pending: 0 }, NOW, t, date), { tone: "ok", title: "sync.statusNever", detail: undefined });
});

test("offline counts what waits, one and many", () => {
  assert.deepEqual(syncLine({ state: "offline", pending: 0 }, NOW, t, date), { tone: "offline", title: "sync.statusOffline", detail: "sync.offlineNothing" });
  assert.deepEqual(syncLine({ state: "offline", pending: 1 }, NOW, t, date), { tone: "offline", title: "sync.offlineOne", detail: "sync.offlineLater" });
  assert.equal(syncLine({ state: "offline", pending: 3 }, NOW, t, date).title, "sync.offlineMany:3");
  assert.equal(syncLine({ state: "idle", pending: 3, last_sync_at: NOW }, NOW, t, date).detail, "sync.waitingMany:3");
});

test("syncing and error say so by word", () => {
  assert.equal(syncLine({ state: "syncing", pending: 0 }, NOW, t, date).tone, "busy");
  assert.deepEqual(syncLine({ state: "error", pending: 2, error: "x" }, NOW, t, date), { tone: "error", title: "sync.statusError" });
});

test("a lease or a conflict counts only on a synced profile", () => {
  assert.deepEqual(profileSyncOf(undefined), { on: false, openOn: null, conflict: false });
  assert.deepEqual(profileSyncOf({ on: true, open_on: "Work-PC" }), { on: true, openOn: "Work-PC", conflict: false });
  assert.deepEqual(profileSyncOf({ on: false, open_on: "Work-PC", conflict: true }), { on: false, openOn: null, conflict: false });
  assert.deepEqual(profileSyncOf({ on: true, conflict: true }), { on: true, openOn: null, conflict: true });
});
