import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle } from "./support/app";
import { ADMIN_INVITE, MEMBER_INVITE, joinTeam, menu, space, toast } from "./support/team";

// A team's member and admin against the backend as the Rust and the team server judge them
// (team review, phase D): what the mock now refuses, and what the app says before it is asked.

type Scope = { kind: "team" } | { kind: "folder"; name: string } | { kind: "profile"; id: string };
type Grant = { scope: Scope; action: string; allow: boolean };
type M = {
  __shardxMock: {
    state: Record<string, any>;
    log: { cmd: string; args: Record<string, unknown> }[];
    epoch: number;
    emit: (event: string, payload?: unknown) => void;
    teamGrants: (g: Grant[]) => void;
    teamOpenOn: (id: string, on: { device_name: string; member_name: string } | null) => void;
    teamStatus: (s: Record<string, unknown>) => void;
    teamWithdraw: (kind: "revoked" | "replaced") => void;
  };
  __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
};

const TEAM: Scope = { kind: "team" };
const SHOPS: Scope = { kind: "folder", name: "Shops" };
const allow = (scope: Scope, ...actions: string[]): Grant[] => actions.map((action) => ({ scope, action, allow: true }));

const row = (page: Page, id: string) => page.locator(`[role='row'][data-profile-id='${id}']`);
const peek = (page: Page) => page.locator("aside[data-peek]");
const item = (page: Page, name: string | RegExp) => menu(page).getByRole("menuitem", { name });
const callsOf = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as unknown as M).__shardxMock.log.filter((x) => x.cmd === c).map((x) => x.args), cmd);
const raw = (page: Page, cmd: string, args: Record<string, unknown>) =>
  page.evaluate(([c, a]) => {
    const w = window as unknown as M;
    return w.__TAURI_INTERNALS__.invoke(c as string, { ...(a as object), epoch: w.__shardxMock.epoch }).then((v) => v, (e) => String(e));
  }, [cmd, args] as const);

async function asMember(page: Page, grants: Grant[]) {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, MEMBER_INVITE);
  await expect(space(page)).toHaveText("Shops team");
  await expect(row(page, "tp-shop-1")).toBeVisible();
  await page.evaluate((g) => (window as unknown as M).__shardxMock.teamGrants(g), grants);
  await waitForIdle(page);
}

/** A proxy of the team's, `bound` to some of its profiles; the lists are read again. */
async function teamProxy(page: Page, bound: string[]) {
  await page.evaluate((ids) => {
    const m = (window as unknown as M).__shardxMock;
    m.state.proxies.push({ id: "px-team-1", name: "Team DC", kind: "socks5", host: "203.0.113.50", port: 1080, username: "t", password: "p", country: "US", notes: "" });
    for (const id of ids) m.state.profiles[id]._meta.proxy_id = "px-team-1";
    m.emit("store-changed", "proxies");
    m.emit("store-changed", "profiles");
  }, bound);
  await waitForIdle(page);
}

test("a team profile on a proxy the member can't see reads Hidden proxy, and starts", async ({ page }) => {
  await asMember(page, allow(SHOPS, "see", "start", "edit", "create"));
  await teamProxy(page, ["tp-shop-1"]);
  const etsy = row(page, "tp-shop-1");
  await expect(etsy.locator("[data-cell='proxy']")).toHaveText("Hidden proxy");
  await expect(etsy.locator("[data-cell='status']")).not.toContainText("Proxy missing");
  // Its copy would be bound to a proxy this member may not see: refused before anything shows.
  await etsy.click({ button: "right" });
  await expect(item(page, /^Clone/)).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, /^Clone/)).toContainText("Needs See on this proxy. Ask the team’s admin.");
  await page.keyboard.press("Escape");
  expect(await raw(page, "profile_clone", { id: "tp-shop-1" })).toBe("not allowed in this team: needs see on the proxy");
  // Start: no "its proxy was deleted"; the proxy comes with the session.
  await etsy.hover();
  await etsy.getByRole("button", { name: "Start" }).click();
  await expect.poll(async () => (await callsOf(page, "launch")).map((a) => a.profileId)).toEqual(["tp-shop-1"]);
  await expect(etsy.locator("[data-cell='status']")).toContainText("Running");
  await expect(toast(page, "won’t start")).toHaveCount(0);
});

test("a team folder deleted with its profiles stays while they wait in the team's trash, and says so", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await expect(row(page, "tp-ads-1")).toBeVisible();
  await page.locator("aside [data-folder='Ads']").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  await page.getByRole("alertdialog", { name: "Delete folder “Ads”?" }).getByRole("button", { name: "Delete profiles too" }).click();
  await expect(toast(page, "Deleted 3 profiles from “Ads”. The folder stays while the team keeps them in its trash.")).toBeVisible();
  await expect(toast(page, "Couldn’t delete")).toHaveCount(0);
  for (const id of ["tp-ads-1", "tp-ads-2", "tp-ads-3"]) await expect(row(page, id)).toHaveCount(0);
  // Deleting it alone now: the server keeps it, in words.
  expect(await raw(page, "folder_delete", { folder: "Ads", deleteProfiles: false })).toBe("the folder's deleted profiles wait in the trash");
  await page.locator("aside [data-folder='Ads']").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /Delete folder/ }).last().click();
  await expect(toast(page, "Couldn’t delete")).toContainText("Profiles deleted from it are kept in the team’s trash, so the team server keeps the folder too.");
});

test("Create without Edit makes the profile in one write, on its proxy, with nothing left half done", async ({ page }) => {
  await asMember(page, [...allow(TEAM, "see"), ...allow(SHOPS, "create")]);
  await page.locator("main header").getByRole("button", { name: "New profile" }).click();
  const form = page.getByRole("dialog", { name: "New profile" });
  await form.locator("[data-property='folder'] button").click();
  await page.getByRole("option", { name: "Shops" }).click();
  await form.getByRole("button", { name: "Create profile" }).click();
  await expect(form).toHaveCount(0);
  // Only the write that makes it: no second save over it, which would need Edit.
  const saves = await callsOf(page, "profile_save");
  expect(saves).toHaveLength(1);
  expect((saves[0] as { payload: { _meta: { id: string; folder: string } } }).payload._meta).toMatchObject({ id: "", folder: "Shops" });
  await expect(page.locator("[data-toast]").filter({ hasText: /Couldn’t|needs edit/i })).toHaveCount(0);
  // The backend takes a new one with extensions only with Cookies there.
  const payload = { _meta: { id: "", folder: "Shops", extensions: ["ext-1"] }, name: "With extensions" };
  expect(await raw(page, "profile_save", { payload })).toBe("not allowed in this team: needs cookies on the profile");
});

test("with See alone a profile's settings are not shown, nor made up", async ({ page }) => {
  await asMember(page, allow(TEAM, "see"));
  // The server sends no settings for See alone: the mock answers as remote.rs does.
  const got = await raw(page, "profile_get", { id: "tp-ads-1" }) as Record<string, unknown>;
  expect(got.name).toBe("FB Ads 01");
  expect(got.navigator).toBeUndefined();
  await row(page, "tp-ads-1").locator("[data-cell='status']").click();
  const hidden = "The team shows this profile’s settings only with “Start”, “Edit”, “Cookies” or “Take out” on it. Ask the team’s admin.";
  await expect(peek(page).locator("[data-section='fingerprint'] [data-settings-hidden], [data-settings-hidden]").first()).toHaveText(hidden);
  await expect(peek(page).locator("[data-section-edit='fingerprint']")).toHaveCount(0);
  // The form shows the row's own fields, and says why the rest is not there.
  await peek(page).locator("[data-peek-edit]").click();
  const form = page.getByRole("dialog", { name: "View FB Ads 01" });
  await form.getByRole("tab", { name: "Fingerprint" }).click();
  await expect(form.locator("[data-settings-hidden]")).toHaveText(hidden);
});

test("the read-only form's dropdowns change nothing", async ({ page }) => {
  await asMember(page, allow(TEAM, "see", "start"));
  await row(page, "tp-misc-1").locator("[data-cell='status']").click();
  await peek(page).locator("[data-peek-edit]").click();
  const form = page.getByRole("dialog", { name: "View Shared sandbox" });
  await form.getByRole("tab", { name: "Fingerprint" }).click();
  const boxes = form.getByRole("combobox");
  await expect(boxes.first()).toBeVisible();
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await expect(boxes.nth(i)).toHaveAttribute("aria-disabled", "true");
  await boxes.first().click({ force: true });
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(form.getByText("Changed")).toHaveCount(0);
  await form.locator("form").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(form).toHaveCount(0);
});

test("New folder, Import and Add proxies say why they are off for a member", async ({ page }) => {
  await asMember(page, []);
  // The page's … menu: New folder is the admin's.
  await page.locator("main header").getByRole("button", { name: "More actions" }).click();
  await expect(item(page, /^New folder/)).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, /^New folder/)).toContainText("Only the team’s admin can add, rename or delete folders.");
  await page.keyboard.press("Escape");
  // Nothing shown: the empty list says whose call that is, and its buttons say why they are off.
  const empty = page.locator("main");
  await expect(empty).toContainText("No profiles here for you");
  await expect(empty).toContainText("The team’s admin decides which of its profiles you see.");
  const imp = empty.getByRole("button", { name: "Import from clipboard" });
  await expect(imp).toHaveAttribute("aria-disabled", "true");
  await expect(imp).toHaveAttribute("aria-description", /Needs Create/);
  await page.locator("aside [data-nav='proxies']").click();
  const add = page.locator("main [data-empty-action]");
  await expect(add).toHaveAttribute("aria-disabled", "true");
  await expect(add).toHaveAttribute("aria-description", "Needs Create in this team. Ask the team’s admin.");
  await add.click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("without Create in the team, nothing offers a new proxy or a new tag", async ({ page }) => {
  await asMember(page, [...allow(TEAM, "see"), ...allow(SHOPS, "edit", "start")]);
  const etsy = row(page, "tp-shop-1");
  await etsy.click({ button: "right" });
  await item(page, /^Change proxy/).click();
  await expect(page.getByRole("button", { name: "Add a new proxy" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await etsy.click({ button: "right" });
  await item(page, /^Edit tags/).click();
  const find = page.getByRole("combobox", { name: "Find or create a tag…" }).or(page.getByPlaceholder("Find a tag…"));
  await expect(page.getByPlaceholder("Find a tag…")).toBeVisible();
  await expect(page.getByText("No tags yet. Making one needs “Create” in this team.")).toBeVisible();
  await find.first().fill("vip");
  await page.keyboard.press("Enter");
  expect(await callsOf(page, "tag_save")).toEqual([]);
});

test("a team's tags and proxies: their buttons say why without Edit or Delete", async ({ page }) => {
  await asMember(page, allow(TEAM, "see", "start"));
  await page.evaluate(() => {
    const m = (window as unknown as M).__shardxMock;
    m.state.tags = { tags: [{ id: "t-vip", name: "VIP", color: "red" }], by_profile: {} };
    m.emit("store-changed", "tags");
  });
  await teamProxy(page, []);
  await page.locator("aside [data-nav='proxies']").click();
  const px = page.locator("[role='row'][data-proxy-id='px-team-1']");
  await px.hover();
  const del = px.locator("[data-command='proxy.delete']");
  await expect(del).toHaveAttribute("aria-disabled", "true");
  await expect(del).toHaveAccessibleName(/Needs Delete on this proxy/);
  await page.locator("aside [data-nav='settings']").click();
  await page.getByRole("tab", { name: "Tags" }).click();
  const vip = page.locator("[data-tag-row='t-vip']");
  await expect(vip.getByRole("textbox")).toBeDisabled();
  await expect(vip.getByRole("textbox")).toHaveAttribute("aria-description", "Needs Edit in this team. Ask the team’s admin.");
  await expect(vip.getByRole("radio", { name: "green" })).toBeDisabled();
  await vip.getByRole("radio", { name: "green" }).click({ force: true });
  await expect(page.locator("[data-save-bar]")).toHaveCount(0);
});

test("a team project without Edit opens to read", async ({ page }) => {
  await asMember(page, allow(TEAM, "see", "start", "create", "edit"));
  await page.locator("aside [data-nav='automation']").click();
  await page.locator("main header").getByRole("button", { name: "New project" }).click();
  await expect(page.getByRole("textbox", { name: "Project name" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate((g) => (window as unknown as M).__shardxMock.teamGrants(g), allow(TEAM, "see", "start"));
  await waitForIdle(page);
  const name = page.getByRole("textbox", { name: "Project name" });
  await expect(name).toHaveAttribute("readonly", "");
  const before = await name.inputValue();
  await name.press("End");
  await page.keyboard.type(" changed");
  await expect(name).toHaveValue(before);
  await expect(page.getByRole("button", { name: "Add step" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("[data-editor-save]")).toContainText("Needs Edit in this team. Ask the team’s admin.");
  // Nothing to save, so leaving asks nothing.
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("the team status banner and a team start say the server's state in the app's words", async ({ page }) => {
  await asMember(page, allow(TEAM, "see", "start"));
  await page.evaluate(() => (window as unknown as M).__shardxMock.teamStatus({ state: "refused", error: "the team server answered 503" }));
  const banner = page.locator("[data-team-status]");
  await expect(banner).toContainText("The team server refused. The team server answered with an error. Check that it is running and up to date.");
  await page.evaluate(() => (window as unknown as M).__shardxMock.teamStatus({ state: "refused", error: "http://shops.example.org:8787 did not answer as a team server" }));
  await expect(banner).toContainText("That address isn’t an Octopus Agent team server.");
  await expect(banner).not.toContainText("didn’t answer");
  // Offline: a start takes the lease from the server first, so it is refused, in the start's words.
  await page.evaluate(() => (window as unknown as M).__shardxMock.teamStatus({ state: "offline", error: "timed out" }));
  const misc = row(page, "tp-misc-1");
  await misc.hover();
  await misc.getByRole("button", { name: "Start" }).click();
  const refused = toast(page, "Couldn’t start “Shared sandbox”");
  await expect(refused).toContainText("The team server isn’t answering. Try again once it’s back.");
  await expect(refused).not.toContainText("saved");
  await expect(misc.locator("[data-cell='status']")).not.toContainText("Running");
});

test("a bulk Start leaves out a team profile open elsewhere without calling it a failure", async ({ page }) => {
  await asMember(page, allow(TEAM, "see", "start"));
  await page.evaluate(() => (window as unknown as M).__shardxMock.teamOpenOn("tp-shop-1", { device_name: "Lee’s laptop", member_name: "Lee Park" }));
  await expect(row(page, "tp-shop-1").locator("[data-cell='status']")).toContainText("On Lee’s laptop");
  for (const id of ["tp-shop-1", "tp-misc-1"]) await row(page, id).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "Start", exact: true }).click();
  await expect(toast(page, "Skipped “Etsy main”")).toBeVisible();
  await expect.poll(async () => (await callsOf(page, "launch")).map((a) => a.profileId)).toEqual(["tp-misc-1"]);
  await expect(page.locator("[data-toast]").filter({ hasText: /failed/ })).toHaveCount(0);
});

test("leaving a team closes its profiles open here, saved to it; a withdrawal closes them unsaved", async ({ page }) => {
  await asMember(page, allow(TEAM, "see", "start"));
  const misc = row(page, "tp-misc-1");
  await misc.hover();
  await misc.getByRole("button", { name: "Start" }).click();
  await expect(misc.locator("[data-cell='status']")).toContainText("Running");
  await space(page).click();
  await menu(page).getByRole("menuitem", { name: "Leave this team…" }).click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("Its profiles open here are saved to the team and closed first.");
  await ask.getByRole("button", { name: "Leave team" }).click();
  await expect(toast(page, "“Shared sandbox” saved to the team")).toBeVisible();
  await expect(space(page)).toHaveText("Personal");

  // Joined again, and the team withdraws this launcher while a profile is open: it closes, unsaved.
  await joinTeam(page, MEMBER_INVITE);
  await page.evaluate((g) => (window as unknown as M).__shardxMock.teamGrants(g), allow(TEAM, "see", "start"));
  await waitForIdle(page);
  await misc.hover();
  await misc.getByRole("button", { name: "Start" }).click();
  await expect(misc.locator("[data-cell='status']")).toContainText("Running");
  await page.evaluate(() => (window as unknown as M).__shardxMock.teamWithdraw("revoked"));
  await expect(space(page)).toHaveText("Personal");
  await expect(toast(page, /withdrew this launcher’s access|withdrew/)).toBeVisible();
  expect(await page.evaluate(() => Object.keys((window as unknown as M).__shardxMock.state.running))).not.toContain("tp-misc-1");
});

test("a queued write goes to the space it was made in, never the one in use after a switch", async ({ page }) => {
  await asMember(page, allow(TEAM, "see", "start", "edit", "create"));
  // The new tag's write waits on a slow server; the launcher moves to Personal meanwhile.
  await page.evaluate(() => { (window as unknown as { __shardxMockSlow: Record<string, number> }).__shardxMockSlow = { tag_save: 800 }; });
  const etsy = row(page, "tp-shop-1");
  await etsy.click({ button: "right" });
  await item(page, /^Edit tags/).click();
  await page.getByPlaceholder("Find or create a tag…").fill("Team only");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  const asked = await page.evaluate(() => (window as unknown as M).__shardxMock.epoch);
  await page.evaluate(() => (window as unknown as { __shardxMock: { moveSpace: (s: unknown) => void } }).__shardxMock.moveSpace({ kind: "personal" }));
  await expect(space(page)).toHaveText("Personal");
  // The assign queued behind the save still names the team's edition, so it is refused there.
  await expect.poll(async () => (await callsOf(page, "tag_assign")).length).toBeGreaterThan(0);
  for (const w of [...await callsOf(page, "tag_save"), ...await callsOf(page, "tag_assign")]) expect(w.epoch).toBe(asked);
  await expect(toast(page, "switched to another space before this was saved").first()).toBeVisible();
  const personal = await page.evaluate(() => (window as unknown as M).__shardxMock.state.tags?.tags ?? []);
  expect(personal.map((x: { name: string }) => x.name)).not.toContain("Team only");
});

test("in Russian at 1280 px with Peek open, the row's Start and Peek's name are whole", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await asMember(page, allow(TEAM, "see", "start"));
  await page.evaluate(() => (window as unknown as M).__shardxMock.teamOpenOn("tp-shop-1", { device_name: "Lee’s laptop", member_name: "Lee Park" }));
  // The same launcher, now in Russian.
  await page.evaluate(() => localStorage.setItem("shardx.lang", "ru"));
  await page.reload();
  await expect(row(page, "tp-shop-1").locator("[data-cell='status']")).toContainText("Lee’s laptop");
  await row(page, "tp-shop-1").locator("[data-cell='status']").click();
  await expect(peek(page)).toBeVisible();
  const title = peek(page).locator("[data-peek-header] h2");
  await expect.poll(() => title.evaluate((h) => h.scrollWidth <= h.clientWidth)).toBe(true);
  // The row's Start never runs over the icons beside it.
  const other = row(page, "tp-shop-2");
  await other.hover();
  const start = other.getByRole("button", { name: "Запустить" });
  const icons = other.locator("[data-command]");
  const s = await start.boundingBox();
  const last = await icons.last().boundingBox();
  expect(s && last && last.x + last.width <= s.x + 0.5).toBe(true);
});

test("the Team page in the personal space leads back to the team this launcher is in", async ({ page }) => {
  await asMember(page, allow(TEAM, "see"));
  await space(page).click();
  await menu(page).getByRole("menuitem", { name: "Your access" }).click();
  await expect(page.locator("main [data-team-section='access']")).toBeVisible();
  // A member's legend: what the marks mean for them, not what may be set.
  await expect(page.locator("main")).toContainText("a dash is not given per profile");
  await space(page).click();
  await menu(page).getByRole("menuitemradio", { name: "Personal" }).click();
  await expect(space(page)).toHaveText("Personal");
  await expect(page.locator("main")).toContainText("You’re in “Shops team”. Switch to it to see what you may do there, or make a team of your own.");
  await page.locator("main").getByRole("button", { name: "Switch to “Shops team”" }).click();
  await expect(space(page)).toHaveText("Shops team");
});
