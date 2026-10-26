// node --test: the rights rule, case for case with team-model's own tests (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPreset, decide, idle, mergeGrants, nextCell, presetOf, pressCell, PRESETS, sameGrants, sortGrants, summarize, toCells, type Target,
} from "./decide.ts";
import type { Grant, GrantScope, TeamAction } from "../model/types.ts";

const allow = (scope: GrantScope, action: TeamAction): Grant => ({ scope, action, allow: true });
const refuse = (scope: GrantScope, action: TeamAction): Grant => ({ scope, action, allow: false });
const team: GrantScope = { kind: "team" };
const folder = (name: string): GrantScope => ({ kind: "folder", name });
const profile = (id: string): GrantScope => ({ kind: "profile", id });
const inFolder = (id: string, f: string): Target => ({ profileId: id, folder: f });
const allowed = (g: Grant[], a: TeamAction, t: Target) => decide(g, a, t).kind === "allowed";

test("a member starts with nothing", () => {
  assert.deepEqual(decide([], "see", inFolder("p1", "Ads")), { kind: "none" });
});

test("a folder grant covers its profiles and says nothing about another action", () => {
  const g = [allow(folder("Ads"), "start")];
  assert.ok(allowed(g, "start", inFolder("p1", "Ads")));
  assert.ok(!allowed(g, "start", inFolder("p2", "Shops")));
  assert.deepEqual(decide(g, "edit", inFolder("p1", "Ads")), { kind: "none" });
});

test("one profile can be taken out of a folder grant", () => {
  const g = [allow(folder("Ads"), "start"), refuse(profile("p9"), "start")];
  assert.ok(allowed(g, "start", inFolder("p1", "Ads")));
  assert.deepEqual(decide(g, "start", inFolder("p9", "Ads")), { kind: "refused", by: profile("p9") });
});

test("a profile grant beats a team refusal", () => {
  const g = [refuse(team, "cookies"), allow(profile("p3"), "cookies")];
  assert.ok(allowed(g, "cookies", inFolder("p3", "Ads")));
  assert.ok(!allowed(g, "cookies", inFolder("p4", "Ads")));
});

test("two rules of the same width resolve to the refusal, in either order", () => {
  const g = [allow(folder("Ads"), "delete"), refuse(folder("Ads"), "delete")];
  assert.deepEqual(decide(g, "delete", inFolder("p1", "Ads")), { kind: "refused", by: folder("Ads") });
  assert.deepEqual(decide([...g].reverse(), "delete", inFolder("p1", "Ads")), { kind: "refused", by: folder("Ads") });
});

test("creating is about the team or a folder, never a profile", () => {
  assert.ok(allowed([allow(team, "create")], "create", {}));
  assert.ok(allowed([allow(team, "create")], "create", { folder: "Ads" }));
  const f = [allow(folder("Ads"), "create")];
  assert.ok(allowed(f, "create", { folder: "Ads" }));
  assert.ok(!allowed(f, "create", { folder: "Shops" }));
  assert.deepEqual(decide(f, "create", {}), { kind: "none" });
  const p = [allow(profile("p1"), "create")];
  assert.deepEqual(decide(p, "create", {}), { kind: "none" });
  assert.deepEqual(decide(p, "create", inFolder("p1", "Ads")), { kind: "none" });
});

test("taking a profile out is its own right", () => {
  const g = (["see", "start", "edit", "cookies"] as const).map((a) => allow(team, a));
  assert.ok(allowed(g, "cookies", inFolder("p1", "Ads")));
  assert.deepEqual(decide(g, "take_out", inFolder("p1", "Ads")), { kind: "none" });
});

test("a grant on the no-folder name does not leak to a profile in a folder", () => {
  const g = [allow(folder(""), "see")];
  assert.ok(allowed(g, "see", inFolder("p1", "")));
  assert.ok(!allowed(g, "see", inFolder("p2", "Ads")));
});

test("the grid's cells: a cell with both rules reads as refused, and a press cycles three states", () => {
  const cells = toCells([allow(team, "see"), allow(folder("Ads"), "edit"), refuse(folder("Ads"), "edit")]);
  assert.equal(cells.get("team|see"), "allow");
  assert.equal(cells.get("folder:Ads|edit"), "refuse");
  assert.equal(cells.get("team|start"), undefined);
  assert.equal(nextCell(null), "allow");
  assert.equal(nextCell("allow"), "refuse");
  assert.equal(nextCell("refuse"), null);
});

test("grant lists compare whatever their order, and sort team first", () => {
  const a = [allow(profile("p1"), "see"), allow(team, "start"), refuse(folder("Ads"), "see")];
  assert.ok(sameGrants(a, [...a].reverse()));
  assert.ok(!sameGrants(a, a.slice(1)));
  assert.deepEqual(sortGrants(a, ["see", "start"]).map((g) => g.scope.kind), ["team", "folder", "profile"]);
});

test("the presets never give Take out", () => {
  for (const actions of Object.values(PRESETS)) assert.ok(!actions.includes("take_out"));
  assert.deepEqual([...PRESETS.run], ["see", "start"]);
  assert.deepEqual([...PRESETS.none], []);
});

const ALL = ["see", "start", "edit", "create", "delete", "cookies", "take_out"] as const;

test("allowing Start where nothing allows See turns See on in that row too", () => {
  const ads = folder("Ads");
  const r = pressCell([], ads, { folder: "Ads" }, "start", "allow");
  assert.ok(r.addedSee);
  assert.ok(allowed(r.grants, "see", inFolder("p1", "Ads")));
  assert.ok(allowed(r.grants, "start", inFolder("p1", "Ads")));
  // See already allowed by the whole team: nothing more is added.
  const t = pressCell([allow(team, "see")], ads, { folder: "Ads" }, "start", "allow");
  assert.ok(!t.addedSee);
  assert.equal(t.grants.length, 2);
  // Create needs no See, and a refusal is never widened into one.
  assert.ok(!pressCell([], ads, { folder: "Ads" }, "create", "allow").addedSee);
  assert.ok(!pressCell([], ads, { folder: "Ads" }, "start", "refuse").addedSee);
});

test("a See refused on the row itself stays refused, and the allowance there is idle", () => {
  const ads = folder("Ads");
  const r = pressCell([refuse(ads, "see")], ads, { folder: "Ads" }, "start", "allow");
  assert.ok(!r.addedSee);
  assert.ok(idle(r.grants, "start", { folder: "Ads" }));
  assert.ok(!idle(r.grants, "see", { folder: "Ads" }));
  // See taken away from the whole team: Start there does nothing any more.
  const g = [allow(team, "start")];
  assert.ok(idle(g, "start", {}));
  assert.ok(!idle([...g, allow(team, "see")], "start", {}));
  assert.ok(!idle([allow(team, "create")], "create", {}));
});

test("a preset sets one row exactly, and is read back from it", () => {
  const ads = folder("Ads");
  const g = [allow(team, "see"), refuse(ads, "cookies"), allow(profile("p1"), "edit")];
  const run = applyPreset(g, ads, "run");
  assert.equal(presetOf(run, ads), "run");
  assert.equal(presetOf(run, team), "view");
  // The other rows keep theirs, and the row's refusal is gone.
  assert.ok(run.some((x) => x.scope.kind === "profile"));
  assert.ok(!run.some((x) => x.scope.kind === "folder" && !x.allow));
  assert.equal(presetOf(applyPreset(run, ads, "none"), ads), "none");
  assert.equal(presetOf([refuse(ads, "see")], ads), null);
  assert.equal(presetOf([allow(ads, "see"), allow(ads, "cookies")], ads), null);
  // A profile row never takes Create, and still reads as the preset.
  const p = applyPreset([], profile("p1"), "edit");
  assert.deepEqual(p.map((x) => x.action), ["see", "start", "edit"]);
  assert.equal(presetOf(p, profile("p1")), "edit");
});

test("duplicate rules merge as the server stores them: the refusal stays", () => {
  const m = mergeGrants([allow(team, "see"), refuse(team, "see"), allow(team, "see"), allow(folder("Ads"), "edit")]);
  assert.equal(m.length, 2);
  assert.deepEqual(m[0], refuse(team, "see"));
});

test("the summary lists what each place allows, in the grid's order", () => {
  const g = [allow(folder("Shops"), "cookies"), allow(team, "start"), allow(team, "see"), allow(folder("Shops"), "edit"), refuse(profile("p9"), "start")];
  const s = summarize(g, ALL);
  assert.deepEqual(s.map((x) => [x.scope.kind, x.actions, x.preset]), [
    ["team", ["see", "start"], "run"],
    ["folder", ["edit", "cookies"], null],
  ]);
  assert.deepEqual(summarize([refuse(team, "see")], ALL), []);
});
