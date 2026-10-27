// node --test: what the one-time hand-over makes of the tags an older build
// kept in this window (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromLegacy, whole } from "./stored.ts";

const COLORS = ["blue", "violet", "green"];
const kept = (v: unknown) => JSON.stringify(v);

test("an older build's tags go over with the profiles that carry them", () => {
  const text = kept({
    version: 1,
    tags: [{ id: "t-vip", name: "VIP", color: "violet" }, { id: "t-warm", name: "Warm-up", color: "green" }],
    byProfile: { p1: ["t-vip", "t-warm"], p2: ["t-warm"] },
  });
  assert.deepEqual(fromLegacy(text, COLORS), {
    tags: [{ id: "t-vip", name: "VIP", color: "violet" }, { id: "t-warm", name: "Warm-up", color: "green" }],
    by_profile: { p1: ["t-vip", "t-warm"], p2: ["t-warm"] },
  });
});

test("a broken copy, or one of another version, hands over nothing", () => {
  const none = { tags: [], by_profile: {} };
  assert.deepEqual(fromLegacy(null, COLORS), none);
  assert.deepEqual(fromLegacy("{not json", COLORS), none);
  assert.deepEqual(fromLegacy(kept({ version: 2, tags: [{ id: "t-a", name: "A", color: "blue" }] }), COLORS), none);
  assert.deepEqual(fromLegacy(kept({ tags: [{ id: "t-a", name: "A", color: "blue" }] }), COLORS), none);
  assert.deepEqual(fromLegacy(kept({ version: 1, tags: "A" }), COLORS), none);
});

test("only whole tags of a palette or hex color, and only their ids on profiles, each once", () => {
  const got = whole(
    [{ id: "t-a", name: "A", color: "blue" }, { id: "t-b", name: "B", color: "not a color" }, { id: "t-c", name: "C", color: "#ff0000" }, { name: "No id", color: "blue" }, null],
    { p1: ["t-a", "t-b", "t-a", 7, "t-c"], p2: ["t-b"], p3: "t-a" },
    COLORS,
  );
  assert.deepEqual(got, {
    tags: [{ id: "t-a", name: "A", color: "blue" }, { id: "t-c", name: "C", color: "#ff0000" }],
    byProfile: { p1: ["t-a", "t-c"] },
  });
});
