// node --test: the backend refusals the app translates (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SYNC_REFUSALS } from "../model/types.ts";
import { refusal } from "./refusals.ts";

test("a refusal's own words match, with the device or host as the first group", () => {
  const leased = refusal(SYNC_REFUSALS.leased);
  assert.equal(leased.exec(SYNC_REFUSALS.leased("Work-PC"))?.[1], "Work-PC");
  assert.equal(leased.exec(`launch refused: ${SYNC_REFUSALS.leased("DESKTOP 7 (old)")}`)?.[1], "DESKTOP 7 (old)");
  assert.equal(refusal(SYNC_REFUSALS.leasedStop).exec(SYNC_REFUSALS.leasedStop("Work-PC"))?.[1], "Work-PC");
  assert.equal(refusal(SYNC_REFUSALS.noAnswer).exec(SYNC_REFUSALS.noAnswer("sync.example.net:8787"))?.[1], "sync.example.net:8787");
  // Lease and stop refusals do not take each other's words.
  assert.equal(leased.test(SYNC_REFUSALS.leasedStop("Work-PC")), false);
});

test("a fixed refusal matches as a phrase, its dots and colons taken literally", () => {
  assert.equal(refusal(SYNC_REFUSALS.alreadyConnected).test(`Error: ${SYNC_REFUSALS.alreadyConnected}`), true);
  assert.equal(refusal(SYNC_REFUSALS.notConnected).test("sync is not connectedness"), false);
  assert.equal(refusal(SYNC_REFUSALS.removed).test(SYNC_REFUSALS.removed.toUpperCase()), true);
});
