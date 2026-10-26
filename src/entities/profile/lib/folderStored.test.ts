// node --test: what the one-time hand-over makes of the folders and looks an
// older build kept in this window (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fromLegacy, LEGACY_META, LEGACY_REGISTRY, looks } from "./folderStored.ts";

const KNOWN = { colors: ["blue", "green", "violet"], icons: ["folder", "cart", "briefcase"] };
const keys = (registry: unknown, meta: unknown) => ({
  [LEGACY_REGISTRY]: registry === undefined ? null : JSON.stringify(registry),
  [LEGACY_META]: meta === undefined ? null : JSON.stringify(meta),
});

test("an older build's empty folders and looks go over; the first build's hex colors map onto the palette", () => {
  const got = fromLegacy(keys(["Empty1", "Empty2"], {
    Shops: { color: "#12B76A", icon: "cart" },
    Ads: { color: "violet", icon: "briefcase" },
  }), KNOWN);
  assert.deepEqual(got, {
    registry: ["Empty1", "Empty2"],
    meta: { Shops: { color: "green", icon: "cart" }, Ads: { color: "violet", icon: "briefcase" } },
  });
});

test("an unknown color or icon falls back to none and the folder; unnamed folders are dropped", () => {
  const got = fromLegacy(keys(["A", "", "  ", 3, null], {
    A: { color: "#123456", icon: "rocket" },
    B: { color: 5, icon: "toString" },
    C: "red",
  }), KNOWN);
  assert.deepEqual(got.registry, ["A"]);
  assert.deepEqual(got.meta, {
    A: { color: null, icon: "folder" },
    B: { color: null, icon: "folder" },
    C: { color: null, icon: "folder" },
  });
});

test("a missing or broken key hands over nothing of its own", () => {
  assert.deepEqual(fromLegacy(keys(undefined, undefined), KNOWN), { registry: [], meta: {} });
  const broken = { [LEGACY_REGISTRY]: "{not json", [LEGACY_META]: "[1,2]" };
  assert.deepEqual(fromLegacy(broken, KNOWN), { registry: [], meta: {} });
  assert.deepEqual(fromLegacy(keys({ A: 1 }, { A: { color: "blue", icon: "cart" } }), KNOWN), {
    registry: [],
    meta: { A: { color: "blue", icon: "cart" } },
  });
  assert.deepEqual(looks(null, KNOWN), {});
});
