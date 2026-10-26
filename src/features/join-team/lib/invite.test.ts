// node --test: reading a pasted invite and a bare address (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitInvite, withScheme } from "./invite.ts";

test("an invite splits at the token, whichever kind it is", () => {
  assert.deepEqual(splitInvite(" http://203.0.113.5:8787#stm_abc "), { server: "http://203.0.113.5:8787", token: "stm_abc" });
  assert.deepEqual(splitInvite("https://team.example.com#eyJhbGc.x.y"), { server: "https://team.example.com", token: "eyJhbGc.x.y" });
  assert.equal(splitInvite("http://203.0.113.5:8787"), null);
  assert.equal(splitInvite("stm_abc"), null);
});

test("a bare address gets http, and one with a scheme keeps it", () => {
  assert.equal(withScheme("203.0.113.5:8787"), "http://203.0.113.5:8787");
  assert.equal(withScheme("https://team.example.com"), "https://team.example.com");
  assert.equal(withScheme("  "), "");
});
