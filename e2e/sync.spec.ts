import { expect, test, type Page } from "@playwright/test";
import { openApp, reloadApp, row } from "./support/app";
import { ADMIN_INVITE, MEMBER_INVITE, joinTeam } from "./support/team";

// Personal sync: a person's own data across their computers, kept on a team
// server (src/dev/mock/syncServer.ts). Not connected by default; an
// "eyJ…" token is the person's own server, "stm_…" someone else's.
const OWN_INVITE = "http://sync.example.net:8787#eyJhbGciOiJIUzI1NiJ9.mock.admin";

type Win = { __shardxMockSync?: string; __shardxMockSyncOffline?: boolean; __shardxMockSyncError?: string };
type Mock = {
  __shardxMock: {
    state: { sync?: { kinds: Record<string, unknown>; picked: string[]; pending: number }; space?: { kind: string } };
    calls: Record<string, number>;
    log: { cmd: string; args: Record<string, unknown> }[];
  };
  __shardxMockClipboard?: string;
};
const startConnected = (page: Page) => page.addInitScript(() => { (window as unknown as Win).__shardxMockSync = "connected"; });
const setOffline = (page: Page, on: boolean) => page.evaluate((v) => { (window as unknown as Win).__shardxMockSyncOffline = v; }, on);
const tab = (page: Page, name: string) => page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name, exact: true });
const pane = (page: Page) => page.locator("main [data-sync]");
const setting = (page: Page, id: string) => page.locator(`[data-setting='${id}']`);
const status = (page: Page) => setting(page, "sync-status");
const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });
const menuItem = (page: Page, name: string | RegExp) => page.getByRole("menu").getByRole("menuitem", { name });
const mockSync = (page: Page) => page.evaluate(() => (window as unknown as Mock).__shardxMock.state.sync);
/** The backend calls of one command, with their arguments. */
const callsOf = (page: Page, cmd: string) => page.evaluate((c) => (window as unknown as Mock).__shardxMock.log.filter((x) => x.cmd === c).map((x) => x.args), cmd);
const focused = (page: Page) => page.evaluate(() => {
  const el = document.activeElement;
  return el === document.body || !el ? "BODY" : `${el.tagName} ${el.textContent?.trim() ?? ""}`;
});

async function openSyncTab(page: Page) {
  await page.locator("aside [data-nav='settings']").click();
  await tab(page, "Sync").click();
  await expect(pane(page)).toBeVisible();
}

async function connectWithInvite(page: Page, invite = OWN_INVITE) {
  const form = page.locator("[data-sync-connect='server']");
  await form.getByRole("textbox", { name: "Invite or server address" }).fill(invite);
  await form.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(pane(page)).toHaveAttribute("data-sync", "on");
}

async function select(page: Page, names: string[]) {
  for (const name of names) await row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
}

test("an invite connects sync: the tab names the server, this computer and the status, and says what to pick", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "Sync").click();
  await expect(page).toHaveURL(/tab=sync/);
  await expect(pane(page)).toHaveAttribute("data-sync", "off");
  await expect(pane(page)).toContainText("They meet on a sync server: one you run yourself, or your team’s.");
  // The first step for someone with no server: the guide, a button of its own.
  await expect(setting(page, "sync-setup").getByRole("button", { name: "Set up a server…" })).toBeVisible();
  const form = page.locator("[data-sync-connect='server']");
  await expect(form).toContainText("Already have one? Paste its invite, or its address and token.");
  const connect = form.getByRole("button", { name: "Connect", exact: true });
  await expect(connect).toHaveAttribute("aria-disabled", "true");
  await expect(form).toContainText("Needs the server address and the token");
  // A wrong token is said in place; before connecting, nobody knows who runs the server.
  await form.getByRole("textbox", { name: "Invite or server address" }).fill("sync.example.net:8787");
  await form.getByLabel("Access token").fill("wrong");
  await connect.click();
  await expect(form.getByRole("alert")).toHaveText("The server does not know this token: check it, or ask whoever runs the server for a new invite.");
  // A whole invite in either field fills both; an admin token warns of no one.
  await form.getByLabel("Access token").fill(OWN_INVITE);
  await expect(form.getByRole("textbox", { name: "Invite or server address" })).toHaveValue("http://sync.example.net:8787");
  await expect(form.locator("[data-sync-owner]")).toHaveCount(0);
  await connect.click();

  await expect(pane(page)).toHaveAttribute("data-sync", "on");
  await expect(toast(page, "Sync is on")).toContainText("Pick the profiles to sync from their menu, or turn on “All profiles”.");
  // The keyboard is not left on the page: it lands on Sync now.
  await expect.poll(() => focused(page)).toMatch(/^BUTTON (Sync now|Retry)/);
  await expect(setting(page, "sync-server")).toContainText("sync.example.net:8787, your own server");
  await expect(setting(page, "sync-device")).toContainText("Your other computers see it as “Mock-MacBook”.");
  await expect(status(page).locator("[data-sync-status]")).toHaveText("Synced just now");
  // The other computer's profile came down, picked: one of all of them syncs.
  await expect(setting(page, "sync-profiles").locator("[data-sync-picked]")).toContainText(/^1 of \d+ profiles sync\./);
  await setting(page, "sync-profiles").getByRole("button", { name: "Pick profiles" }).click();
  await expect(page).toHaveURL(/section=profiles/);
  await expect(row(page, "Office main")).toBeVisible();
  await expect(row(page, "Office main").locator("[data-synced]")).toHaveCount(1);
});

test("a member's invite warns about the server's owner before connecting", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "Sync").click();
  const form = page.locator("[data-sync-connect='server']");
  await form.getByRole("textbox", { name: "Invite or server address" }).fill(MEMBER_INVITE);
  const warning = form.locator("[data-sync-owner='other']");
  await expect(warning).toContainText("This is a member’s invite: whoever runs that server can read what you sync to it, cookies and saved passwords included.");
  await expect(warning.getByRole("button", { name: "Set up your own server" })).toBeVisible();
  await form.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(setting(page, "sync-server")).toContainText("shops.example.org:8787: whoever runs it can read what you sync");
});

test("a team server the person does not run warns about its owner first; the guide reads as a sync server", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, MEMBER_INVITE);
  await openSyncTab(page);
  const picker = page.locator("[data-sync-connect='team']");
  const use = picker.getByRole("button", { name: "Use this server" });
  await expect(use).toHaveAttribute("aria-disabled", "true");
  await picker.getByRole("combobox", { name: "Team" }).click();
  await page.getByRole("option", { name: /Shops team/ }).click();
  const warning = picker.locator("[data-sync-owner='other']");
  await expect(warning).toContainText("Whoever runs this team server can read what you sync to it, cookies and saved passwords included.");

  // Its own server instead: the Create a team guide, worded for sync.
  await warning.getByRole("button", { name: "Set up your own server" }).click();
  const guide = page.getByRole("dialog", { name: "Set up your own sync server" });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("only you hold its admin token");
  await expect(guide).toContainText("Run it on a computer that stays on and that all your computers can reach");
  await expect(guide).toContainText("Plain http on an IP address is fine over the internet too: the launcher encrypts the connection itself.");
  await expect(guide.getByRole("textbox", { name: "Team name" })).toHaveCount(0);
  await expect(guide.getByRole("heading", { name: "Connect with the admin token" })).toBeVisible();
  await expect(guide.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);

  await use.click();
  await expect(pane(page)).toHaveAttribute("data-sync", "on");
  await expect(setting(page, "sync-server")).toContainText("Shops team (shops.example.org:8787): whoever runs it can read what you sync");
});

test("a team server the person runs says so, and the guide connects sync with the admin token", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openSyncTab(page);
  const picker = page.locator("[data-sync-connect='team']");
  await picker.getByRole("combobox", { name: "Team" }).click();
  await page.getByRole("option", { name: /Ads team/ }).click();
  await expect(picker.locator("[data-sync-owner='you']")).toHaveText("You run this server: only you hold its admin token.");
  await expect(picker.locator("[data-sync-owner='other']")).toHaveCount(0);

  await setting(page, "sync-setup").getByRole("button", { name: "Set up a server…" }).click();
  const guide = page.getByRole("dialog", { name: "Set up your own sync server" });
  await guide.getByLabel("Admin token").fill(OWN_INVITE);
  await guide.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(guide).toHaveCount(0);
  // It stays on Settings, now connected, says so and keeps the keyboard.
  await expect(page).toHaveURL(/tab=sync/);
  await expect(toast(page, "Sync is on")).toBeVisible();
  await expect(setting(page, "sync-server")).toContainText("sync.example.net:8787, your own server");
  await expect.poll(() => focused(page)).not.toBe("BODY");
});

test("Join a team from the Sync tab keeps the personal space and picks that team", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "Sync").click();
  await page.locator("[data-sync-connect='team']").getByRole("button", { name: "Join a team…" }).click();
  const join = page.getByRole("dialog");
  await join.getByRole("textbox", { name: "Invite or server address" }).fill(MEMBER_INVITE);
  await join.getByRole("button", { name: "Join" }).click();
  await expect(join).toHaveCount(0);
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as Mock).__shardxMock.state.space))?.kind).toBe("personal");
  const picker = page.locator("[data-sync-connect='team']");
  await expect(picker.getByRole("combobox", { name: "Team" })).toContainText("Shops team");
  await expect(picker.locator("[data-sync-owner='other']")).toBeVisible();
});

test("what syncs: quick switches all land, one write at a time, and survive a reload", async ({ page }) => {
  await startConnected(page);
  await openApp(page, { section: "settings" });
  await tab(page, "Sync").click();
  const proxies = page.getByRole("switch", { name: "All proxies" });
  const bookmarks = page.getByRole("switch", { name: "Bookmarks" });
  const extensions = page.getByRole("switch", { name: "Extensions" });
  await expect(proxies).not.toBeChecked();
  await expect(bookmarks).toBeChecked();
  await expect(setting(page, "sync-automation")).toContainText("Secret step values never leave this computer.");
  await expect(page.locator("main")).toContainText("These apply on all your computers.");
  // Three in a row, faster than the backend answers: none undoes another.
  await page.evaluate(() => { (window as unknown as { __shardxMockSlow?: Record<string, number> }).__shardxMockSlow = { sync_set_kinds: 300 }; });
  await proxies.click();
  await bookmarks.click();
  await extensions.click();
  await expect(proxies).toBeChecked();
  await expect(bookmarks).not.toBeChecked();
  await expect(extensions).not.toBeChecked();
  // No Save: the page's Save bar never shows for these.
  await expect(page.locator("[data-save-bar]")).toBeHidden();
  await expect.poll(async () => (await mockSync(page))?.kinds).toMatchObject({ proxies: "all", bookmarks: false, extensions: false });
  // Never two writes at once: the second carries both later changes.
  expect((await callsOf(page, "sync_set_kinds")).length).toBeLessThanOrEqual(2);
  await reloadApp(page);
  await expect(page.getByRole("switch", { name: "All proxies" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Bookmarks" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Extensions" })).not.toBeChecked();
});

test("a profile syncs from its row menu and from the bulk bar, and stops again", async ({ page }) => {
  await startConnected(page);
  await openApp(page);
  const sandbox = row(page, "Sandbox");
  await expect(sandbox.locator("[data-synced]")).toHaveCount(0);
  await sandbox.click({ button: "right" });
  await menuItem(page, "Sync this profile").click();
  await expect(toast(page, "Syncing “Sandbox”")).toBeVisible();
  await expect(sandbox.locator("[data-synced]")).toHaveCount(1);
  // Said by word too, not by the glyph alone.
  await expect(sandbox.locator("[data-cell='name']")).toContainText("Synced to your computers");
  await sandbox.click({ button: "right" });
  await expect(menuItem(page, "Sync this profile")).toHaveCount(0);
  await menuItem(page, "Stop syncing").click();
  // What the other computers do with it is said too.
  await expect(toast(page, "Stopped syncing “Sandbox”")).toContainText("Your other computers keep their copy; it no longer updates.");
  await expect(sandbox.locator("[data-synced]")).toHaveCount(0);

  // A selection, from the bar's More menu.
  await select(page, ["Etsy craft shop", "FB Ads acc-02"]);
  const bar = page.getByRole("toolbar", { name: /selected/ });
  await bar.getByRole("button", { name: "More bulk actions" }).click();
  // Apart from Start in sync (windows driven together): not one after the other.
  const items = await page.getByRole("menu").getByRole("menuitem").allTextContents();
  expect(items.findIndex((x) => x.startsWith("Sync these profiles")) - items.findIndex((x) => x.startsWith("Start in sync"))).toBeGreaterThan(1);
  await menuItem(page, "Sync these profiles").click();
  await expect(toast(page, "Syncing 2 profiles")).toBeVisible();
  await expect(row(page, "Etsy craft shop").locator("[data-synced]")).toHaveCount(1);
  await expect(row(page, "FB Ads acc-02").locator("[data-synced]")).toHaveCount(1);
  expect((await mockSync(page))?.picked).toEqual(expect.arrayContaining(["aed41005", "c31d92f1"]));
});

test("with All profiles on, every profile reads as synced and Stop syncing says why it is off", async ({ page }) => {
  await startConnected(page);
  await openApp(page, { section: "settings" });
  await tab(page, "Sync").click();
  await expect(setting(page, "sync-profiles").locator("[data-sync-picked]")).toBeVisible();
  await page.getByRole("switch", { name: "All profiles" }).check();
  // Every profile syncs: no count of picked ones.
  await expect(setting(page, "sync-profiles").locator("[data-sync-picked]")).toHaveCount(0);
  await page.locator("aside [data-nav='profiles']").click();
  const sandbox = row(page, "Sandbox");
  await expect(sandbox.locator("[data-synced]")).toHaveCount(1);
  await sandbox.click({ button: "right" });
  await expect(menuItem(page, "Sync this profile")).toHaveCount(0);
  const stop = menuItem(page, /^Stop syncing/);
  await expect(stop).toHaveAttribute("aria-disabled", "true");
  await expect(stop).toContainText("Every profile syncs while “All profiles” is on in Settings");
});

test("on a team server the person does not run, All profiles asks first", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await tab(page, "Sync").click();
  await connectWithInvite(page, MEMBER_INVITE);
  const all = page.getByRole("switch", { name: "All profiles" });
  await all.click();
  const ask = page.getByRole("dialog", { name: "Sync every profile to shops.example.org:8787?" });
  await expect(ask).toContainText("Whoever runs it can read them.");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(all).not.toBeChecked();
  expect(await callsOf(page, "sync_set_kinds")).toHaveLength(0);
  await all.click();
  await page.getByRole("dialog", { name: /Sync every profile/ }).getByRole("button", { name: "Sync all profiles" }).click();
  await expect(all).toBeChecked();
});

test("a profile open on another computer says so, every Start refuses it before the backend, and it can be taken here", async ({ page }) => {
  await startConnected(page);
  await openApp(page);
  const office = row(page, "Office main");
  await expect(office.locator("[data-cell='status']")).toContainText("On Work-PC");
  // How long since that computer was heard from, in the full sentence.
  await expect(office.locator("[data-cell='status']")).toContainText("Last seen: 2 h ago.");
  await expect(office.locator("[data-pill='status']")).toHaveAttribute("data-state", "elsewhere");

  // The row's Start: off here, as the menu's, and it says why (the menu offers Open here instead).
  await office.hover();
  const start = office.getByRole("button", { name: "Start" });
  await expect(start).toHaveAttribute("aria-disabled", "true");
  await expect(start).toHaveAttribute("aria-description", "It’s open on Work-PC. Only one computer can have it open at a time.");
  await start.click({ force: true });
  expect(await callsOf(page, "launch")).toEqual([]);
  await expect(office.locator("[data-cell='status']")).toContainText("On Work-PC");

  // The row menu: Start and Stop syncing are off and say why.
  await office.click({ button: "right" });
  await expect(menuItem(page, /^Start/)).toHaveAttribute("aria-disabled", "true");
  await expect(menuItem(page, /^Stop syncing/)).toHaveAttribute("aria-disabled", "true");
  await expect(menuItem(page, /^Stop syncing/)).toContainText("Open on Work-PC: stop it there first");
  await page.keyboard.press("Escape");

  // A bulk Start and Start in sync leave it out, before any proxy question.
  await select(page, ["Office main", "Etsy craft shop", "FB Ads acc-02"]);
  const bar = page.getByRole("toolbar", { name: /selected/ });
  await bar.getByRole("button", { name: "More bulk actions" }).click();
  await menuItem(page, "Start in sync").click();
  await expect.poll(async () => (await callsOf(page, "sync_launch")).length).toBe(1);
  expect((await callsOf(page, "sync_launch"))[0].profileIds).not.toContain("sync-office-main");
  await expect(office.locator("[data-cell='status']")).toContainText("On Work-PC");
  await bar.getByRole("button", { name: /Clear selection/ }).click();

  // Peek: the Sync row says where, and its button takes it here.
  await office.locator("[data-cell='name']").click();
  const peek = page.locator("aside[data-peek]");
  await expect(peek.locator("[data-property='sync']")).toContainText("Open on Work-PC");
  await expect(peek.locator("[data-peek-run-status]")).toContainText("On Work-PC");
  await peek.getByRole("button", { name: "Open here", exact: true }).click();
  const take = page.getByRole("dialog", { name: "Open “Office main” here instead?" });
  await expect(take).toContainText("Work-PC will close it at its next sync. Changes made there and not yet synced are kept as a conflict copy.");
  await take.getByRole("button", { name: "Open here" }).click();
  await expect.poll(async () => (await callsOf(page, "launch")).map((a) => a.profileId)).toEqual(["sync-office-main"]);
  await expect(office.locator("[data-cell='status']")).not.toContainText("On Work-PC");
});

test("in a team's space, personal sync offers nothing on its profiles", async ({ page }) => {
  await startConnected(page);
  await openApp(page);
  await expect(row(page, "Office main").locator("[data-synced]")).toHaveCount(1);
  await joinTeam(page, MEMBER_INVITE);
  // The list as the team's space reads it: the team's profiles, none of the person's own.
  await reloadApp(page);
  await expect(row(page, "Etsy main")).toHaveCount(1);
  await expect(row(page, "Office main")).toHaveCount(0);
  await expect(page.locator("main [data-synced]")).toHaveCount(0);
  await row(page, "Etsy main").click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(menuItem(page, /^Sync this profile/)).toHaveCount(0);
  await expect(menuItem(page, /^Stop syncing/)).toHaveCount(0);
});

test("another computer joins with the copied invite; this one can be renamed", async ({ page }) => {
  await startConnected(page);
  await openApp(page, { section: "settings" });
  await tab(page, "Sync").click();
  await expect(setting(page, "sync-others")).toContainText("On each of them, paste this invite in Settings, on the “Sync” tab.");
  await setting(page, "sync-others").getByRole("button", { name: "Copy invite" }).click();
  await expect(toast(page, "Copied. It clears from the clipboard in 1 minute.")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Mock).__shardxMockClipboard)).toBe(OWN_INVITE);

  await setting(page, "sync-device").getByRole("button", { name: "Rename…" }).click();
  const rename = page.getByRole("dialog", { name: "Rename this computer" });
  await rename.getByRole("textbox", { name: "Name" }).fill("Studio Mac");
  await rename.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(rename).toHaveCount(0);
  await expect(setting(page, "sync-device")).toContainText("Your other computers see it as “Studio Mac”.");
});

test("Disconnect keeps a copy on the server or removes it; this computer keeps its own either way", async ({ page }) => {
  await startConnected(page);
  await openApp(page);
  await row(page, "Sandbox").click({ button: "right" });
  await menuItem(page, "Sync this profile").click();
  await expect(row(page, "Sandbox").locator("[data-synced]")).toHaveCount(1);

  // Changes still waiting are said, with a way to send them first.
  await openSyncTab(page);
  await setOffline(page, true);
  await page.evaluate(() => { (window as unknown as Mock).__shardxMock.state.sync!.pending = 3; });
  await setOffline(page, true);
  await setting(page, "sync-server").getByRole("button", { name: "Disconnect…" }).click();
  const ask = page.getByRole("dialog", { name: "Disconnect sync?" });
  await expect(ask).toContainText("This computer keeps its copies of everything.");
  await expect(ask.locator("[data-sync-unsent]")).toContainText("3 changes made here haven’t reached the server: they stay on this computer only.");
  await expect(ask.locator("[data-sync-unsent]").getByRole("button", { name: "Sync first" })).toBeVisible();
  await expect(ask.getByRole("radio", { name: "Keep it on the server" })).toBeChecked();
  await ask.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(toast(page, "Sync is off. Your copy stays on the server.")).toBeVisible();
  await expect(pane(page)).toHaveAttribute("data-sync", "off");
  // The keyboard is not left on the page.
  await expect.poll(() => focused(page)).not.toBe("BODY");
  await setOffline(page, false);
  await page.locator("aside [data-nav='profiles']").click();
  await expect(row(page, "Office main")).toBeVisible();
  await expect(row(page, "Office main").locator("[data-synced]")).toHaveCount(0);
  await expect(row(page, "Sandbox").locator("[data-synced]")).toHaveCount(0);

  // Kept: connecting again picks up where it left off.
  await openSyncTab(page);
  await connectWithInvite(page);
  await page.locator("aside [data-nav='profiles']").click();
  await expect(row(page, "Sandbox").locator("[data-synced]")).toHaveCount(1);

  // Removed: the next connect starts empty, and the other computers stop.
  await openSyncTab(page);
  await setting(page, "sync-server").getByRole("button", { name: "Disconnect…" }).click();
  await page.getByRole("radio", { name: "Remove it from the server" }).check();
  const remove = page.getByRole("alertdialog", { name: "Disconnect sync?" });
  await expect(remove).toContainText("Your synced data is deleted from the server for good, and your other computers stop syncing.");
  await remove.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(toast(page, "Sync is off. Your copy was removed from the server.")).toBeVisible();
  await connectWithInvite(page);
  await page.locator("aside [data-nav='profiles']").click();
  await expect(row(page, "Sandbox").locator("[data-synced]")).toHaveCount(0);
  await expect(row(page, "Office main").locator("[data-synced]")).toHaveCount(0);
});

test("Sync now runs a sync; offline counts the changes waiting, and an edit made meanwhile comes back as a conflict copy beside the original", async ({ page }) => {
  await startConnected(page);
  await openApp(page, { section: "settings" });
  await tab(page, "Sync").click();
  const word = status(page).locator("[data-sync-status]");
  await expect(word).toHaveText("Synced 2 min ago");
  await status(page).getByRole("button", { name: "Sync now" }).click();
  await expect(word).toHaveText("Syncing…");
  await expect(status(page).getByRole("button", { name: "Sync now" })).toHaveAttribute("aria-disabled", "true");
  await expect(word).toHaveText("Synced just now");

  await setOffline(page, true);
  await expect(word).toHaveText("Offline");
  await expect(status(page)).toContainText("Changes made here wait until the server answers.");
  await status(page).getByRole("button", { name: "Sync now" }).click();
  await expect(toast(page, "Couldn’t sync")).toContainText("The sync server didn’t answer: check that it is running and the address is right.");

  // An edit to the profile Work-PC holds, made offline.
  await page.locator("aside [data-nav='profiles']").click();
  await row(page, "Office main").click({ button: "right" });
  await menuItem(page, "Rename").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Office main 2");
  await page.keyboard.press("Enter");
  await expect(row(page, "Office main 2")).toBeVisible();
  await openSyncTab(page);
  await expect(word).toHaveText("Offline, 1 change waiting");
  await expect(status(page)).toContainText("They go once the server answers.");

  await setOffline(page, false);
  await expect(word).toHaveText("Synced just now");
  // Said once, with a way to it.
  await expect(toast(page, "A profile changed on two computers: your changes from here are in “Office main 2 (conflict copy)”.")).toContainText("Don’t run both");
  await page.locator("aside [data-nav='profiles']").click();
  const copy = row(page, "Office main 2 (conflict copy)");
  await expect(copy).toBeVisible();
  await expect(copy.locator("[data-synced='conflict']")).toHaveCount(1);
  await expect(copy.locator("[data-cell='name']")).toContainText("Don’t run it beside the original");
  // Both kept: the original is the other computer's version again.
  await expect(page.locator("[data-profile-id='sync-office-main'] [data-name]")).toHaveText("Office main");
});

test("a sync that stopped says why, in words for the server's own admin, and Retry tries again", async ({ page }) => {
  await startConnected(page);
  await openApp(page, { section: "settings" });
  await tab(page, "Sync").click();
  await page.evaluate(() => { (window as unknown as Win).__shardxMockSyncError = "the server does not know this token"; });
  await expect(status(page).locator("[data-sync-status]")).toHaveText("Sync stopped");
  await expect(status(page)).toContainText("The server no longer knows this token. If you reset the server or its data folder, connect again with its new admin token.");
  await page.evaluate(() => { (window as unknown as Win).__shardxMockSyncError = undefined; });
  await status(page).getByRole("button", { name: "Retry" }).click();
  await expect(status(page).locator("[data-sync-status]")).toHaveText("Synced just now");
});

test("the palette reaches the Sync tab, and Sync now once connected", async ({ page }) => {
  await openApp(page);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.keyboard.press("ControlOrMeta+k");
  await palette.getByRole("combobox").fill("sync now");
  await expect(palette.getByRole("option", { name: /^Sync now/ })).toHaveCount(0);
  await palette.getByRole("combobox").fill("sync");
  await palette.getByRole("option", { name: /^Sync$/ }).click();
  await expect(page).toHaveURL(/section=settings&tab=sync/);
  await connectWithInvite(page);
  // The connect's own sync has ended: what follows is the palette's.
  await expect(status(page).locator("[data-sync-status]")).toHaveText("Synced just now");
  expect(await callsOf(page, "sync_now")).toHaveLength(0);
  await page.keyboard.press("ControlOrMeta+k");
  await palette.getByRole("combobox").fill("sync now");
  await palette.getByRole("option", { name: /^Sync now/ }).click();
  await expect(status(page).locator("[data-sync-status]")).toHaveText("Syncing…");
  expect(await callsOf(page, "sync_now")).toHaveLength(1);
});

test("a backend without sync has no Sync tab", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockFailWith?: Record<string, string> }).__shardxMockFailWith = { sync_state: "Command sync_state not found" }; });
  await openApp(page, { section: "settings" });
  await expect(tab(page, "Storage")).toBeVisible();
  await expect(tab(page, "Sync")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("sync");
  await expect(palette.getByRole("option", { name: /^Sync$/ })).toHaveCount(0);
});
