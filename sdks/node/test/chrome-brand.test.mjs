// Phone profiles without a brand list Chrome's, as Chrome on Android does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyChromeBrand } from "../dist/profile.js";

test("a profile without a brand gets Chrome's, and a named one stays", () => {
  const bare = { client_hints: { mobile: true, brand_version: "156" } };
  applyChromeBrand(bare);
  assert.equal(bare.client_hints.brand, "Google Chrome");
  const empty = { client_hints: { brand: "" } };
  applyChromeBrand(empty);
  assert.equal(empty.client_hints.brand, "Google Chrome");
  const named = { client_hints: { brand: "Microsoft Edge" } };
  applyChromeBrand(named);
  assert.equal(named.client_hints.brand, "Microsoft Edge");
});
