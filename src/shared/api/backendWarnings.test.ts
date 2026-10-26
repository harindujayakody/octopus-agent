// node --test: the backend's warnings about team and synced profiles are worded as the Rust
// sources word them, each reads back, and the app says each one in its own words (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEAM_WARNINGS, UNNAMED_TEAM, warningRe } from "./backendWarnings.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
// A Rust string's line continuation (a backslash, the line break, the next line's indent) is nothing.
const rust = (path: string) => read(join("src-tauri/src", path)).replace(/\\\n\s*/g, "");

test("each warning is the backend's own format", () => {
  const src = ["space/open.rs", "space/live.rs", "space/admin.rs", "space/items.rs", "space/sync/cycle.rs", "space/sync/cycle/extension.rs", "lib.rs", "reset.rs"].map(rust).join("\n");
  // Each formatter, given the Rust format's own placeholders, is that format.
  const formats: Record<keyof typeof TEAM_WARNINGS, string> = {
    stale: TEAM_WARNINGS.stale("{}"),
    notSaved: TEAM_WARNINGS.notSaved("{}", "{why}"),
    // The Unsent reason's own format; notSaved wraps it.
    unsent: TEAM_WARNINGS.unsent("{}", "{why}").slice(TEAM_WARNINGS.notSaved("{}", "").length),
    resending: TEAM_WARNINGS.resending("{}", "{why}"),
    clockAhead: TEAM_WARNINGS.clockAhead("{}", "{}"),
    extensionsMissing: TEAM_WARNINGS.extensionsMissing("{name}", "{left}"),
    quitting: TEAM_WARNINGS.quitting,
    withdrew: TEAM_WARNINGS.withdrew("{name}"),
    replaced: TEAM_WARNINGS.replaced("{name}"),
    permission: TEAM_WARNINGS.permission("{why}"),
    anotherTeam: TEAM_WARNINGS.anotherTeam("{}", "{}"),
    closesSoon: TEAM_WARNINGS.closesSoon("{}", "{}"),
    lostLease: TEAM_WARNINGS.lostLease("{}", "{e}"),
    tooBig: TEAM_WARNINGS.tooBig("{}", "{}"),
    localInvite: TEAM_WARNINGS.localInvite("{host}"),
    profileConflict: TEAM_WARNINGS.profileConflict("{name}"),
    projectConflict: TEAM_WARNINGS.projectConflict("{name}"),
    proxySetDifferently: TEAM_WARNINGS.proxySetDifferently("{id}"),
    proxyChanged: TEAM_WARNINGS.proxyChanged("{}"),
    itemSetDifferently: TEAM_WARNINGS.itemSetDifferently("{key}"),
    itemChanged: TEAM_WARNINGS.itemChanged("{name}"),
    teamLinksKept: TEAM_WARNINGS.teamLinksKept("{e:#}"),
    extensionIdKept: TEAM_WARNINGS.extensionIdKept("{name}"),
    extensionOlderKept: TEAM_WARNINGS.extensionOlderKept("{name}"),
    extensionNewerKept: TEAM_WARNINGS.extensionNewerKept("{name}", "{mine}", "{there}"),
  };
  for (const [key, words] of Object.entries(formats)) assert.ok(src.includes(`"${words}"`), `${key} moved: ${words}`);
  assert.ok(rust("space/live.rs").includes(`"${UNNAMED_TEAM}".into()`), "the unnamed team's name moved");
});

test("each warning reads back, its arguments in order", () => {
  assert.deepEqual(warningRe(TEAM_WARNINGS.notSaved).exec(TEAM_WARNINGS.notSaved("Shop: main", "the team server did not answer: timed out"))?.slice(1),
    ["Shop: main", "the team server did not answer: timed out"]);
  assert.deepEqual(warningRe(TEAM_WARNINGS.closesSoon).exec(TEAM_WARNINGS.closesSoon("Shop 1", 4))?.slice(1), ["Shop 1", "4"]);
  assert.deepEqual(warningRe(TEAM_WARNINGS.anotherTeam).exec(TEAM_WARNINGS.anotherTeam("Ads", "http://a:8787"))?.slice(1), ["Ads", "http://a:8787"]);
  assert.equal(warningRe(TEAM_WARNINGS.quitting).test(TEAM_WARNINGS.quitting), true);
  // A profile's conflict copy and a project's take each other's words for nothing.
  const profile = TEAM_WARNINGS.profileConflict("Shop 1");
  const project = TEAM_WARNINGS.projectConflict("Warm-up");
  assert.equal(warningRe(TEAM_WARNINGS.profileConflict).exec(profile)?.[1], "Shop 1");
  assert.equal(warningRe(TEAM_WARNINGS.projectConflict).exec(project)?.[1], "Warm-up");
  assert.equal(warningRe(TEAM_WARNINGS.profileConflict).test(project), false);
  assert.equal(warningRe(TEAM_WARNINGS.projectConflict).test(profile), false);
  // An unsent one kept for the next start is read before a plain not-saved one, which it also matches.
  const unsent = TEAM_WARNINGS.unsent("Shop 1", "the team server did not answer: timed out");
  assert.deepEqual(warningRe(TEAM_WARNINGS.unsent).exec(unsent)?.slice(1), ["Shop 1", "the team server did not answer: timed out"]);
  assert.equal(warningRe(TEAM_WARNINGS.unsent).test(TEAM_WARNINGS.notSaved("Shop 1", "timed out")), false);
  const app = read("src/shared/hooks/useLauncherWarning.ts");
  assert.ok(app.indexOf("warningRe(TEAM_WARNINGS.unsent)") < app.indexOf("warningRe(TEAM_WARNINGS.notSaved)"), "unsent is read first");
  assert.deepEqual(warningRe(TEAM_WARNINGS.clockAhead).exec(TEAM_WARNINGS.clockAhead(4, "Shop 1"))?.slice(1), ["4", "Shop 1"]);
  assert.deepEqual(warningRe(TEAM_WARNINGS.extensionsMissing).exec(TEAM_WARNINGS.extensionsMissing("Shop 1", 2))?.slice(1), ["Shop 1", "2"]);
  // A proxy's change is not an item's.
  assert.equal(warningRe(TEAM_WARNINGS.itemChanged).test(TEAM_WARNINGS.proxyChanged("US 1")), false);
});

test("the app says every warning in its own words", () => {
  const app = read("src/shared/hooks/useLauncherWarning.ts");
  for (const key of Object.keys(TEAM_WARNINGS)) assert.ok(app.includes(`warningRe(TEAM_WARNINGS.${key})`), `${key} is shown raw`);
});
