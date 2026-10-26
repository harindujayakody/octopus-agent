// node --test: the guide's command lines (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { binaryCommand, dockerCommand } from "./commands.ts";

test("a name goes in as one word in either shell, and a blank one is left to the server", () => {
  assert.match(dockerCommand("Ads crew"), /-e SHARDBROWSER_TEAM_NAME='Ads crew' -e SHARDBROWSER_TEAM_BIND=0\.0\.0\.0:8787/);
  assert.match(dockerCommand("Bob's"), /SHARDBROWSER_TEAM_NAME='Bob'\\''s'/);
  assert.doesNotMatch(dockerCommand("  "), /SHARDBROWSER_TEAM_NAME/);
  assert.match(binaryCommand("Bob's", "windows"), /^\$env:SHARDBROWSER_TEAM_NAME='Bob''s'; \$env:SHARDBROWSER_TEAM_BIND='0\.0\.0\.0:8787';/);
  assert.match(binaryCommand("", "windows"), /\.\\octopus-agent-team-server\.exe$/);
  assert.match(binaryCommand("Ads", "unix"), /^chmod \+x \.\/octopus-agent-team-server && SHARDBROWSER_TEAM_NAME='Ads' SHARDBROWSER_TEAM_BIND=/);
});
