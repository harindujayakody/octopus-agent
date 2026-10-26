// node --test: a team's refusals are worded as the backend words them, and the mock judges
// every door the backend enforces in a team (`npm run test:unit`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSION_TOO_BIG_RE, FORBIDDEN_RE, TEAM_REFUSALS } from "./teamRefusals.ts";
import { SYNC_STOPS } from "../../entities/sync/model/types.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const rust = (path: string) => read(join("src-tauri/src", path));

/** A `pub const NAME: &str = "…";` of a Rust source. */
function rustConst(src: string, name: string): string {
  const m = new RegExp(`pub const ${name}: &str = "([^"]*)";`).exec(src);
  assert.ok(m, `${name} not found`);
  return m[1];
}

test("the plain refusals are the backend's constants", () => {
  const mod = rust("space/mod.rs");
  assert.equal(TEAM_REFUSALS.notInTeam, rustConst(mod, "NOT_IN_TEAM"));
  assert.equal(TEAM_REFUSALS.teamNotYet, rustConst(mod, "TEAM_NOT_YET"));
  assert.equal(TEAM_REFUSALS.personalOnly, rustConst(mod, "PERSONAL_ONLY"));
});

test("the worded refusals follow the backend's formats, and read back", () => {
  const error = rust("space/error.rs");
  assert.ok(error.includes(`"not allowed in this team: needs {} on the {}", n.right.replace('_', " "), n.on`), "Forbidden's format moved");
  assert.ok(error.includes(`"this profile is open on {device}: close it there first"`), "Leased's format moved");
  assert.ok(rust("space/doors.rs").includes(`format!("no profile {id} in this team")`), "Missing's format moved");
  assert.ok(rust("space/items.rs").includes(`"this extension is {} MB packed; a team keeps extensions up to {} MB"`), "the size refusal moved");
  assert.ok(rust("space/admin.rs").includes(`bail!("a tag named {} already exists", t.name)`), "the trash's tag refusal moved");
  const server = read("team-server/src/api.rs");
  for (const w of [TEAM_REFUSALS.trashGone, TEAM_REFUSALS.trashNotAllowed]) assert.ok(server.includes(`"${w}")`), `the server's "${w}" moved`);

  assert.equal(TEAM_REFUSALS.forbidden("take_out", "team"), "not allowed in this team: needs take out on the team");
  assert.deepEqual(FORBIDDEN_RE.exec(TEAM_REFUSALS.forbidden("cookies", "profile"))?.slice(1), ["cookies", "profile"]);
  assert.deepEqual(FORBIDDEN_RE.exec(TEAM_REFUSALS.forbidden("take_out", "proxy"))?.slice(1), ["take out", "proxy"]);
  assert.deepEqual(EXTENSION_TOO_BIG_RE.exec(TEAM_REFUSALS.extensionTooBig(80))?.slice(1), ["80", "64"]);
  assert.equal(TEAM_REFUSALS.leased("Lee’s laptop"), "this profile is open on Lee’s laptop: close it there first");
});

test("the mock judges every door the backend enforces in a team", () => {
  const doors = rust("space/doors.rs");
  const list = /pub const ENFORCED: &\[&str\] = &\[([\s\S]*?)\];/.exec(doors);
  assert.ok(list, "ENFORCED not found");
  // The Tauri commands, not the local API's routes ("POST /profiles").
  const commands = [...list[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(commands.length > 20, "too few doors read");
  const mock = read("src/dev/mock/teamRights.ts");
  const judged = new Set([...mock.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]));
  assert.deepEqual(commands.filter((c) => !judged.has(c)), []);
  // The admin's own doors are the admin's in the mock too.
  const admin = [...doors.matchAll(/\("([a-z_]+)", (?:ADMIN|FOLDER_DELETE)\)/g)].map((m) => m[1]).filter((c) => !c.startsWith("team_admin_"));
  assert.deepEqual(admin.sort(), ["folder_add", "folder_delete", "folder_meta_set", "folder_rename"]);
});

test("the refusals of steps 5 to 10 are the backend's words, and the app says each in its own", () => {
  const mod = rust("space/mod.rs");
  const open = rust("space/open.rs");
  assert.equal(TEAM_REFUSALS.switchWhileStarting, rustConst(mod, "SWITCH_WHILE_STARTING"));
  assert.equal(TEAM_REFUSALS.switchWhileMoving, rustConst(mod, "SWITCH_WHILE_MOVING"));
  assert.equal(TEAM_REFUSALS.launchWhileSwitching, rustConst(mod, "LAUNCH_WHILE_SWITCHING"));
  assert.equal(TEAM_REFUSALS.busy, rustConst(open, "BUSY"));
  assert.equal(TEAM_REFUSALS.stillOpen, rustConst(open, "STILL_OPEN"));
  assert.ok(open.includes(`"${TEAM_REFUSALS.guardFailed("{e}")}"`), "the guard's refusal moved");
  const error = rust("space/error.rs");
  for (const part of [`"This {what} changed after you opened it"`, `" (rev {now}, you have {had})"`, `" — someone else saved it. Reopen it and apply your changes to the current version."`]) {
    assert.ok(error.includes(part), `Stale's format moved: ${part}`);
  }
  assert.equal(TEAM_REFUSALS.stale("project", 3, 2), "This project changed after you opened it (rev 3, you have 2) — someone else saved it. Reopen it and apply your changes to the current version.");
  // Each is one translated sentence in errors.ts, not the backend's words.
  const app = read("src/shared/lib/errors.ts");
  for (const key of ["switchWhileStarting", "switchWhileMoving", "launchWhileSwitching", "stillOpen"]) {
    assert.ok(app.includes(`phrase(TEAM_REFUSALS.${key})`), `${key} is shown raw`);
  }
  for (const words of ["still opening or being saved here", "the profile's guard process did not start", "changed after you opened it"]) {
    assert.ok(app.includes(words), `"${words}" is shown raw`);
  }
});

test("a sync's stops are the backend's words, and the app says each in its own", () => {
  const cycle = read("src-tauri/src/space/sync/cycle.rs").replace(/\\\n\s*/g, "");
  const vanished = /const VANISHED: &str = "([^"]*)";/.exec(cycle);
  assert.equal(vanished?.[1], SYNC_STOPS.vanished);
  assert.ok(cycle.includes(`"${SYNC_STOPS.unread("{what}", "{e:#}")}"`), "the unread stop moved");
  const app = read("src/entities/sync/lib/errors.ts");
  assert.ok(app.includes("none of the synced profiles is on this computer any more") && app.includes("on this computer could not be read"));
});

test("the team server's own refusals the app reads are its words", () => {
  const api = read("team-server/src/api.rs");
  assert.ok(api.includes(`"${TEAM_REFUSALS.folderInTrash}"`), "the folder-in-trash refusal moved");
  assert.ok(api.includes(`"${TEAM_REFUSALS.badProxy}"`), "the bad-proxy refusal moved");
  assert.ok(rust("space/mod.rs").includes(`"${TEAM_REFUSALS.teamExtensionsNotYet}"`), "the extension updates refusal moved");
  const app = read("src/shared/lib/errors.ts");
  for (const key of ["folderInTrash", "badProxy", "teamExtensionsNotYet"]) assert.ok(app.includes(`phrase(TEAM_REFUSALS.${key})`), `${key} is shown raw`);
});
