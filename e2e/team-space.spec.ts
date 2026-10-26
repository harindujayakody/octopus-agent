import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle } from "./support/app";
import { ADMIN_INVITE, ADMIN_TEAM, joinTeam, menu, space, toast } from "./support/team";

// The space under every write and list (team steps 5 and 6). The mock keeps each space's lists
// apart and refuses writes as space/mod.rs does (src/dev/mock/spaces.ts).

type Row = { _meta: { pinned: boolean; folder: string } };
type M = {
  __shardxMock: {
    epoch: number;
    log: { cmd: string; args: Record<string, unknown> }[];
    calls: Record<string, number>;
    state: {
      profiles: Record<string, Row>;
      spaceData?: Record<string, { profiles: Record<string, Row> }>;
      tags?: { tags: { id: string; name: string; color: string }[]; by_profile: Record<string, string[]> };
      folders?: { registry: string[]; meta: Record<string, unknown> };
      settings: Record<string, unknown>;
    };
    moveSpace: (space: { kind: "personal" } | { kind: "team"; team_id: string }, opts?: { tell?: boolean }) => void;
    teamStatus: (s: { state: string; error?: string }) => void;
    emit: (event: string, payload?: unknown) => void;
  };
  __shardxMockFailWith?: Record<string, string>;
  __shardxMockSlow?: Record<string, number>;
  __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
};

const SANDBOX = "f62a9d43";
const AMAZON = "a78a0eea";
const ETSY_MAIN = "tp-shop-1";
const NO_EPOCH = "a write in a team space has to name the space it was asked in (epoch): nothing was written";
const OFFLINE = "error sending request for url (http://ads.example.net:8787/profiles)";

const row = (page: Page, id: string) => page.locator(`[role='row'][data-profile-id='${id}']`);
const banner = (page: Page) => page.locator("main [data-team-status]");
const epochNow = (page: Page) => page.evaluate(() => (window as unknown as M).__shardxMock.epoch);
/** The arguments of the latest call of `cmd`. */
const lastArgs = (page: Page, cmd: string) => page.evaluate((c) => [...(window as unknown as M).__shardxMock.log].reverse().find((x) => x.cmd === c)?.args ?? null, cmd);

async function pin(page: Page, id: string) {
  await row(page, id).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
}

/** A team write: a team keeps no pins (space/mod.rs set_pin), so its rows are taken out of their folder. */
async function unfile(page: Page, id: string) {
  await row(page, id).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from folder", exact: true }).click();
}

async function switchTo(page: Page, name: string | RegExp) {
  await space(page).click();
  await menu(page).getByRole("menuitemradio", { name }).click();
}

/** Joined as the team's admin, its lists in and every read the switch asked for answered. */
async function inTeam(page: Page) {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await expect(space(page)).toHaveText("Ads team");
  await expect(row(page, ETSY_MAIN)).toBeVisible();
  await waitForIdle(page);
}

test("every space write carries the edition of the space on screen, personal and team alike", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await pin(page, SANDBOX);
  await expect(page.locator(`aside [data-pinned='${SANDBOX}']`)).toBeVisible();
  const personal = await epochNow(page);
  expect(await lastArgs(page, "profile_set_pin")).toMatchObject({ id: SANDBOX, pinned: true, epoch: personal });

  await joinTeam(page, ADMIN_INVITE);
  await expect(row(page, ETSY_MAIN)).toBeVisible();
  // The team takes it: a team write without the edition would be refused.
  await unfile(page, ETSY_MAIN);
  await expect(row(page, ETSY_MAIN).locator("[data-cell='folder']").getByText("Shops")).toHaveCount(0);
  const team = await epochNow(page);
  expect(team).toBeGreaterThan(personal);
  await expect.poll(() => lastArgs(page, "profile_set_folder")).toMatchObject({ id: ETSY_MAIN, folder: "", epoch: team });
  await expect(toast(page, /Couldn’t/)).toHaveCount(0);
});

test("a write sent after the launcher moved on is refused whole, said plainly, and the window follows", async ({ page }) => {
  await inTeam(page);
  await row(page, ETSY_MAIN).click({ button: "right" });
  // As live.rs does when the team withdraws access: moved, and the window has not heard yet.
  await page.evaluate(() => (window as unknown as M).__shardxMock.moveSpace({ kind: "personal" }, { tell: false }));
  await expect(space(page)).toHaveText("Ads team");
  await page.getByRole("menuitem", { name: "Remove from folder", exact: true }).click();
  const said = toast(page, "Couldn’t move “Etsy main”");
  await expect(said).toContainText("Octopus Agent switched to another space before this was saved, so nothing was written.");
  // The space is read again: the personal one, its own list, nothing of the team's.
  await expect(space(page)).toHaveText("Personal");
  await expect(row(page, AMAZON)).toBeVisible();
  await expect(row(page, ETSY_MAIN)).toHaveCount(0);
  const written = await page.evaluate((team) => {
    const s = (window as unknown as M).__shardxMock.state;
    return { team: s.spaceData?.[team]?.profiles["tp-shop-1"]?._meta.folder, here: "tp-shop-1" in s.profiles };
  }, ADMIN_TEAM);
  expect(written).toEqual({ team: "Shops", here: false });
});

test("the backend's refusal of a team write without the edition is taken for a bug, and said plainly", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await inTeam(page);
  // The mock refuses one as space/mod.rs window_ticket does.
  const raw = await page.evaluate(
    (id) => (window as unknown as M).__TAURI_INTERNALS__.invoke("profile_set_pin", { id, pinned: true }).then(() => "written", (e) => String(e)),
    ETSY_MAIN,
  );
  expect(raw).toBe(NO_EPOCH);
  // Were the app ever to send one: one plain sentence, and a line for whoever fixes it.
  await page.evaluate((text) => { (window as unknown as M).__shardxMockFailWith = { profile_set_folder: text }; }, NO_EPOCH);
  await unfile(page, ETSY_MAIN);
  await expect(toast(page, "Couldn’t move “Etsy main”")).toContainText("Nothing was saved: Octopus Agent couldn’t tell which space this was for.");
  await expect.poll(() => errors.some((e) => e.includes("profile_set_folder") && e.includes("(a bug)"))).toBe(true);
  await expect(space(page)).toHaveText("Ads team");
});

test("a team server that stops answering shows as a slim line over the page; writes wait for it", async ({ page }) => {
  await inTeam(page);
  await expect(banner(page)).toHaveCount(0);
  await page.evaluate((error) => (window as unknown as M).__shardxMock.teamStatus({ state: "offline", error }), OFFLINE);
  await expect(banner(page)).toHaveAttribute("data-team-status", "offline");
  await expect(banner(page)).toHaveAttribute("role", "status");
  await expect(banner(page)).toContainText("The team server isn’t answering.");
  await expect(banner(page)).toContainText(/Showing what was last read, at .+\. Changes won’t save until it answers\./);
  // What was last read stays on screen.
  await expect(row(page, ETSY_MAIN)).toBeVisible();
  await unfile(page, ETSY_MAIN);
  await expect(toast(page, "Couldn’t move “Etsy main”")).toContainText("The team server isn’t answering. Try again once it’s back.");
  await page.evaluate(() => (window as unknown as M).__shardxMock.teamStatus({ state: "ready" }));
  await expect(banner(page)).toHaveCount(0);

  await page.evaluate(() => (window as unknown as M).__shardxMock.teamStatus({ state: "refused", error: "this member is switched off on the server" }));
  await expect(banner(page)).toHaveAttribute("data-team-status", "refused");
  await expect(banner(page)).toContainText("The team server refused. This member is switched off on the server: ask the team’s admin to switch them on.");
  // The personal space has no team server to wait for.
  await switchTo(page, "Personal");
  await expect(banner(page)).toHaveCount(0);
});

test("a team entered while its server is down says nothing was read yet", async ({ page }) => {
  await page.addInitScript((error) => {
    (window as unknown as { __shardxMockTeamStatus: unknown }).__shardxMockTeamStatus = { state: "offline", error };
  }, OFFLINE);
  await openApp(page, { section: "proxies" });
  await joinTeam(page, ADMIN_INVITE);
  await expect(banner(page)).toContainText("The team server isn’t answering. Nothing has been read from it yet.");
  // Its cache is empty, as the backend's is: the list says what it waits for, and fills when it answers.
  await page.locator("aside [data-nav='profiles']").click();
  await expect(page.locator("main")).toContainText("Nothing read from the team server yet");
  await expect(page.locator("[role='row'][data-profile-id]")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __shardxMock: { teamStatus: (s: unknown) => void } }).__shardxMock.teamStatus({ state: "ready" }));
  await expect(page.locator("[role='row'][data-profile-id='tp-ads-1']")).toBeVisible();
});

test("tags and folders changed elsewhere are read again", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await expect(row(page, SANDBOX)).toBeVisible();
  await page.evaluate((id) => {
    const mock = (window as unknown as M).__shardxMock;
    const s = mock.state;
    s.tags ??= { tags: [], by_profile: {} };
    s.tags.tags.push({ id: "t-elsewhere", name: "Elsewhere", color: "violet" });
    s.tags.by_profile[id] = ["t-elsewhere"];
    mock.emit("store-changed", "tags");
  }, SANDBOX);
  await expect(row(page, SANDBOX).locator("[data-cell='tags']")).toContainText("Elsewhere");

  const kept = page.locator("aside [data-folder='Kept elsewhere']");
  await expect(kept).toHaveCount(0);
  await page.evaluate(() => {
    const mock = (window as unknown as M).__shardxMock;
    mock.state.folders ??= { registry: [], meta: {} };
    mock.state.folders.registry.push("Kept elsewhere");
    mock.emit("store-changed", "folders");
  });
  await expect(kept).toBeVisible();
});

test("a switch shows nothing of the space left, not even for a moment, on any page", async ({ page }) => {
  // A read of the old space is held 4 s on purpose, past the switch.
  test.slow();
  await openApp(page, { section: "profiles" });
  const mine = await page.locator("[role='row'][data-profile-id]").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-profile-id")!));
  expect(mine).toContain(SANDBOX);
  // Watches every frame: a personal row on screen while the switcher says the team is a flash.
  await page.evaluate((ids) => {
    const w = window as unknown as { __flashed?: string[] };
    w.__flashed = [];
    const look = () => {
      if (document.querySelector("aside [data-nav='space']")?.getAttribute("data-space") === "team") {
        for (const id of ids) if (document.querySelector(`main [data-profile-id='${id}']`)) w.__flashed!.push(id);
      }
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }, mine);
  // A read of the old space still out as the switch lands (its answer comes last), and slow lists after it.
  const knob = (name: "__shardxMockSlow" | "__shardxMockLate", ms: Record<string, number>) =>
    page.evaluate(([n, v]) => { (window as unknown as Record<string, unknown>)[n as string] = v; }, [name, ms] as const);
  await knob("__shardxMockLate", { profile_list: 4000 });
  await page.evaluate(() => (window as unknown as M).__shardxMock.emit("store-changed", "profiles"));
  await expect.poll(() => page.evaluate(() => (window as unknown as M).__shardxMock.log.filter((x) => x.cmd === "profile_list").length)).toBeGreaterThan(1);
  // Read as the personal space now, it arrives once the team is in use.
  await page.waitForTimeout(400);
  await knob("__shardxMockLate", {});
  await knob("__shardxMockSlow", { profile_list: 800, proxy_list: 800, tag_list: 800, folder_list: 800 });
  await joinTeam(page, ADMIN_INVITE);
  await expect(space(page)).toHaveAttribute("data-space", "team");
  await expect(row(page, ETSY_MAIN)).toBeVisible();
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => (window as unknown as { __flashed: string[] }).__flashed)).toEqual([]);
  await expect(page.locator("[role='row'][data-profile-id]")).toHaveCount(8);
  await knob("__shardxMockSlow", {});

  // The other pages: none of the person's own proxies, bookmarks, extensions or projects.
  const pages: [string, string][] = [
    ["proxies", "DC New York"], ["bookmarks", "Seller Central"], ["extensions", "uBlock Origin Lite"], ["automation", "Pricing scrape 6h"],
  ];
  for (const [section, theirs] of pages) {
    await page.locator(`aside [data-nav='${section}']`).click();
    await expect(page.locator("main")).toHaveAttribute("data-section", section);
    await expect(page.locator("main [data-page-loading]")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(theirs);
  }
  // And back: the person's own lists again.
  await switchTo(page, "Personal");
  await expect(page.locator("main")).toContainText("Pricing scrape 6h");
  await page.locator("aside [data-nav='profiles']").click();
  await expect(row(page, SANDBOX)).toBeVisible();
  await expect(row(page, ETSY_MAIN)).toHaveCount(0);
});

test("unsaved changes are asked about before a switch: Cancel stays, Don’t save drops them, Save keeps them", async ({ page }) => {
  await inTeam(page);
  await switchTo(page, "Personal");
  await page.locator("aside [data-nav='settings']").click();
  const tray = page.getByRole("switch", { name: /tray/i });
  const bar = page.locator("[data-save-bar]");
  const guard = page.getByRole("alertdialog", { name: "Save changes to Settings?" });
  const before = await tray.isChecked();
  await tray.click();
  await expect(bar).toBeVisible();

  // The space already in use moves nothing: no question, the changes stay.
  const sets = () => page.evaluate(() => (window as unknown as M).__shardxMock.calls.space_set ?? 0);
  const setsBefore = await sets();
  await switchTo(page, "Personal");
  await expect.poll(sets).toBe(setsBefore + 1);
  await expect(guard).toHaveCount(0);
  await expect(bar).toBeVisible();

  await switchTo(page, /Ads team/);
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Cancel" }).click();
  await expect(guard).toHaveCount(0);
  await expect(space(page)).toHaveText("Personal");
  await expect(bar).toBeVisible();

  await switchTo(page, /Ads team/);
  await guard.getByRole("button", { name: "Don’t save" }).click();
  await expect(space(page)).toHaveText("Ads team");
  await expect(bar).toHaveCount(0);
  await expect(tray).toBeChecked({ checked: before });
  expect(await page.evaluate(() => (window as unknown as M).__shardxMock.calls.settings_save ?? 0)).toBe(0);

  await tray.click();
  await switchTo(page, "Personal");
  await guard.getByRole("button", { name: "Save", exact: true }).click();
  await expect(space(page)).toHaveText("Personal");
  await expect.poll(() => page.evaluate(() => (window as unknown as M).__shardxMock.state.settings.minimize_to_tray)).toBe(!before);
});

test("joining a team with unsaved changes asks first; Cancel keeps the invite open and joins nothing", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("switch", { name: /tray/i }).click();
  await space(page).click();
  await menu(page).getByRole("menuitem", { name: "Join a team…" }).click();
  const join = page.getByRole("dialog", { name: "Join a team" });
  await join.getByRole("textbox", { name: "Invite or server address" }).fill(ADMIN_INVITE);
  await join.getByRole("button", { name: "Join" }).click();
  const guard = page.getByRole("alertdialog", { name: "Save changes to Settings?" });
  await guard.getByRole("button", { name: "Cancel" }).click();
  await expect(join).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as M).__shardxMock.calls.team_join ?? 0)).toBe(0);
  await expect(space(page)).toHaveText("Personal");
});
