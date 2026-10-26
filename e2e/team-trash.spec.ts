import { expect, test, type Page } from "@playwright/test";
import { NOW, openApp, row as profileRow, waitForIdle } from "./support/app";
import { ADMIN_INVITE, ADMIN_TEAM, MEMBER_INVITE, joinTeam, menu, space, toast } from "./support/team";

// The team's Trash (space/admin.rs, team-server 30 days): the sidebar's Trash opens it in a
// team, for its admin and for a member who sees rows in it. The mock's server judges each row
// as the real one: See where it was deleted from to list, Delete there too to act.

type Scope = { kind: "team" } | { kind: "folder"; name: string } | { kind: "profile"; id: string };
type Grant = { scope: Scope; action: string; allow: boolean };
type Row = { id: string; kind: string; name: string; folder?: string; deleted_by?: string; deleted_at?: number; proxy_kind?: string; country?: string };
type M = {
  __shardxMock: {
    epoch: number;
    log: { cmd: string; args: Record<string, unknown> }[];
    state: {
      teamServers: Record<string, { members: { id: string; grants: Grant[] }[]; me: string | null; trash?: Row[] }>;
      tags?: { tags: { id: string; name: string; color: string }[] };
    };
    save: () => void;
    teamGrants: (g: Grant[]) => void;
    teamTrashAdd: (r: Row) => void;
  };
  __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
};

const MEMBER_TEAM = "team-shops.example.org:8787";
const nowSecs = Math.floor(NOW.getTime() / 1000);
const allow = (scope: Scope, ...actions: string[]): Grant[] => actions.map((action) => ({ scope, action, allow: true }));
const TEAM: Scope = { kind: "team" };
const SHOPS: Scope = { kind: "folder", name: "Shops" };

const trashItem = (page: Page) => page.locator("aside [data-nav='trash']");
const grid = (page: Page) => page.getByRole("treegrid", { name: "Team Trash", exact: true });
const trashRow = (page: Page, name: string) => grid(page).locator("[role='row'][data-row-id]").filter({ hasText: name });
const cells = (page: Page, name: string) => trashRow(page, name).locator("[role='gridcell']").allTextContents();
/** A command sent straight to the mock's backend: its answer, or its refusal as text. */
const call = (page: Page, cmd: string, args: Record<string, unknown>) =>
  page.evaluate(([c, a]) => {
    const w = window as unknown as M;
    return w.__TAURI_INTERNALS__.invoke(c as string, { ...(a as object), epoch: w.__shardxMock.epoch }).catch((e) => `refused: ${String(e)}`);
  }, [cmd, args] as const);
const add = (page: Page, r: Row) => page.evaluate((x) => (window as unknown as M).__shardxMock.teamTrashAdd(x), r);
const callsOf = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as unknown as M).__shardxMock.log.filter((x) => x.cmd === c).map((x) => x.args), cmd);

async function asAdmin(page: Page) {
  await openApp(page);
  await joinTeam(page, ADMIN_INVITE);
  await expect(space(page)).toHaveText("Ads team");
  await waitForIdle(page);
}

async function asMember(page: Page, grants: Grant[]) {
  await openApp(page);
  await joinTeam(page, MEMBER_INVITE);
  await expect(space(page)).toHaveText("Shops team");
  await page.evaluate((g) => (window as unknown as M).__shardxMock.teamGrants(g), grants);
  await waitForIdle(page);
}

test("the admin's Trash in a team holds what was deleted there; Restore brings a profile back to its list", async ({ page }) => {
  await asAdmin(page);
  await trashItem(page).click();
  await expect(page.locator("main")).toHaveAttribute("data-section", "trash");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Team Trash");
  await expect(page).toHaveTitle("Team Trash – Octopus Agent");
  await expect(page.locator("main")).toContainText("The team’s Trash is empty");
  await expect(page.locator("main")).toContainText("Anything deleted in the team waits here for 30 days.");

  // Deletes elsewhere in the team (the Local API, another window) arrive by "team-trash".
  await call(page, "profile_delete", { id: "tp-ads-1" });
  const proxy = await call(page, "proxy_save", { entry: { id: "", name: "DE Frankfurt", kind: "socks5", host: "de.example.net", port: 1080, username: "", password: "", country: "DE", notes: "" } }) as { id: string };
  await call(page, "proxy_delete", { id: proxy.id });
  await expect(trashRow(page, "FB Ads 01")).toBeVisible();
  expect(await cells(page, "FB Ads 01")).toEqual(expect.arrayContaining(["FB Ads 01", "Profile", "Ads", "Admin", "30 days left"]));
  await expect(trashRow(page, "DE Frankfurt")).toBeVisible();
  expect(await cells(page, "DE Frankfurt")).toEqual(expect.arrayContaining(["Proxy", "SOCKS5, Germany"]));
  // Every kind in one list, newest first: the proxy went last.
  await expect(grid(page).locator("[role='row'][data-row-id]").first()).toContainText("DE Frankfurt");

  await trashRow(page, "FB Ads 01").hover();
  await trashRow(page, "FB Ads 01").getByRole("button", { name: "Restore" }).click();
  const back = toast(page, "Restored “FB Ads 01”");
  await expect(back).toBeVisible();
  await expect(trashRow(page, "FB Ads 01")).toHaveCount(0);
  expect((await callsOf(page, "team_trash_restore")).map((a) => [a.teamId, a.id, a.kind])).toEqual([[ADMIN_TEAM, "tp-ads-1", "profile"]]);
  // Its kind as the row gives it: an id is unique only within its kind.
  await back.getByRole("button", { name: "Show in list" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-section", "profiles");
  await expect(profileRow(page, "FB Ads 01")).toBeVisible();
});

test("Delete for good asks first, then the row is gone from the team", async ({ page }) => {
  await asAdmin(page);
  await call(page, "profile_delete", { id: "tp-ads-2" });
  await trashItem(page).click();
  await trashRow(page, "FB Ads 02").hover();
  await trashRow(page, "FB Ads 02").getByRole("button", { name: "More actions" }).click();
  await menu(page).getByRole("menuitem", { name: "Delete for good" }).click();
  const ask = page.getByRole("alertdialog", { name: "Delete “FB Ads 02” for good?" });
  await expect(ask).toContainText("It’s removed from the team server now, with its saved session. You can’t undo this.");
  await ask.getByRole("button", { name: "Delete for good" }).click();
  await expect(toast(page, "Deleted “FB Ads 02” for good")).toBeVisible();
  await expect(page.locator("main")).toContainText("The team’s Trash is empty");
  // Gone on the server too: another restore of it answers "no such thing".
  expect(await call(page, "team_trash_restore", { teamId: ADMIN_TEAM, id: "tp-ads-2", kind: "profile" })).toBe("refused: no such thing");
});

test("refusals are said in words: a tag whose name is taken, and a row already gone", async ({ page }) => {
  await asAdmin(page);
  const tag = await call(page, "tag_save", { tag: { id: "", name: "warm-up", color: "orange" } }) as { id: string };
  await call(page, "tag_delete", { id: tag.id });
  await call(page, "tag_save", { tag: { id: "", name: "Warm-Up", color: "blue" } });
  await trashItem(page).click();
  await trashRow(page, "warm-up").hover();
  await trashRow(page, "warm-up").getByRole("button", { name: "Restore" }).click();
  const taken = toast(page, "Couldn’t restore “warm-up”");
  await expect(taken).toContainText("The team already has a tag named “Warm-Up”. Rename or delete that tag, then restore this one.");
  // It stays in the trash.
  await expect(trashRow(page, "warm-up")).toBeVisible();

  // Purged by another device, unheard of here: the server no longer has it.
  await page.evaluate((team) => { (window as unknown as M).__shardxMock.state.teamServers[team].trash = []; }, ADMIN_TEAM);
  await trashRow(page, "warm-up").hover();
  await trashRow(page, "warm-up").getByRole("button", { name: "Restore" }).click();
  await expect(toast(page, "It’s no longer on the server: someone changed it meanwhile.")).toContainText("Couldn’t restore “warm-up”");
  // It stays out of the list: the server has no such row to act on again.
  await expect(trashRow(page, "warm-up")).toHaveCount(0);
  await expect(page.locator("main")).toContainText("The team’s Trash is empty");
  expect((await callsOf(page, "team_trash_list")).length).toBeGreaterThan(1);
});

test("deleting a team profile says it waits in the team's Trash, and it does", async ({ page }) => {
  await asAdmin(page);
  await profileRow(page, "FB Ads 02").click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Delete" }).click();
  const ask = page.getByRole("alertdialog", { name: "Delete “FB Ads 02”?" });
  await expect(ask).toContainText("A deleted profile is gone for everyone in the team. It stays in the team’s Trash for 30 days and can be restored from there.");
  await ask.getByRole("button", { name: "Delete" }).click();
  await expect(profileRow(page, "FB Ads 02")).toHaveCount(0);
  await trashItem(page).click();
  await expect(trashRow(page, "FB Ads 02")).toBeVisible();
});

test("on the team's Trash the palette offers no Restore or Delete for good of the personal Trash", async ({ page }) => {
  await asAdmin(page);
  await call(page, "profile_delete", { id: "tp-ads-1" });
  await trashItem(page).click();
  await expect(trashRow(page, "FB Ads 01")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole("option", { name: /^Restore/ })).toHaveCount(0);
  await expect(palette.getByRole("option", { name: /^Delete for good/ })).toHaveCount(0);
  await expect(palette.getByRole("option", { name: /^Empty Trash/ })).toHaveCount(0);
});

test("another device's delete shows at once, with who did it and the time left", async ({ page }) => {
  await asAdmin(page);
  await trashItem(page).click();
  await expect(page.locator("main")).toContainText("The team’s Trash is empty");
  await add(page, { id: "bm-1", kind: "bookmark", name: "Seller dashboard", deleted_by: "m-lee", deleted_at: nowSecs - 29 * 86_400 - 3600 });
  await expect(trashRow(page, "Seller dashboard")).toBeVisible();
  // Names come with the admin's member list; the last day is amber, as in the personal Trash.
  expect(await cells(page, "Seller dashboard")).toEqual(expect.arrayContaining(["Bookmark", "Lee Park", "1 day left"]));
  // The search narrows by name or kind.
  await add(page, { id: "ext-9", kind: "extension", name: "MetaMask", deleted_by: "admin" });
  await expect(trashRow(page, "MetaMask")).toBeVisible();
  await page.locator("main header").getByRole("button", { name: /Search/ }).click();
  await page.keyboard.type("bookmark");
  await expect(grid(page).locator("[role='row'][data-row-id]")).toHaveCount(1);
  // Restored here, it is back in the team's Bookmarks.
  await trashRow(page, "Seller dashboard").hover();
  await trashRow(page, "Seller dashboard").getByRole("button", { name: "Restore" }).click();
  await expect(toast(page, "Restored “Seller dashboard”")).toBeVisible();
  await page.locator("aside [data-nav='bookmarks']").click();
  await expect(page.locator("main")).toContainText("Seller dashboard");
});

test("a member sees the Trash only once a row is theirs to see, and acts only with Delete there", async ({ page }) => {
  await asMember(page, [...allow(SHOPS, "see", "start")]);
  // Nothing they may see: no Trash in this team.
  await expect(trashItem(page)).toHaveCount(0);
  await add(page, { id: "tp-ads-9", kind: "profile", name: "FB Ads 09", folder: "Ads", deleted_by: "m-lee" });
  await waitForIdle(page);
  await expect(trashItem(page)).toHaveCount(0);

  // A profile deleted from Shops: they see it, and the Trash shows.
  await add(page, { id: "tp-shop-9", kind: "profile", name: "Etsy old", folder: "Shops", deleted_by: "m-lee" });
  await expect(trashItem(page)).toBeVisible();
  await trashItem(page).click();
  await expect(grid(page).locator("[role='row'][data-row-id]")).toHaveCount(1);
  expect(await cells(page, "Etsy old")).toEqual(expect.arrayContaining(["Shops", "A team member"]));
  // No Delete in Shops: Restore says why and does nothing.
  const restore = trashRow(page, "Etsy old").getByRole("button", { name: "Restore" });
  await trashRow(page, "Etsy old").hover();
  await expect(restore).toHaveAttribute("aria-disabled", "true");
  // Drawn dimmed, as a blocked Start is.
  await expect(restore).toHaveAttribute("data-disabled", "");
  await expect(restore).toHaveAttribute("aria-description", "Needs Delete where it was. Ask the team’s admin.");
  await restore.click({ force: true });
  expect(await callsOf(page, "team_trash_restore")).toEqual([]);
  // The Delete key on the row says why too, and asks nothing.
  await trashRow(page, "Etsy old").click();
  await page.keyboard.press("Delete");
  await expect(toast(page, "Couldn’t delete “Etsy old” for good")).toContainText("Needs Delete where it was. Ask the team’s admin.");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await callsOf(page, "team_trash_purge")).toEqual([]);
  expect(await call(page, "team_trash_restore", { teamId: MEMBER_TEAM, id: "tp-shop-9", kind: "profile" })).toBe("refused: not allowed");

  // With Delete there it acts; the server's own refusal is said in the same words.
  await page.evaluate((g) => (window as unknown as M).__shardxMock.teamGrants(g), allow(SHOPS, "see", "start", "delete"));
  await waitForIdle(page);
  await expect(restore).not.toHaveAttribute("aria-disabled", "true");
  await page.evaluate((team) => {
    const s = (window as unknown as M).__shardxMock.state.teamServers[team];
    s.members.find((m) => m.id === s.me)!.grants = [{ scope: { kind: "folder", name: "Shops" }, action: "see", allow: true }];
  }, MEMBER_TEAM);
  await trashRow(page, "Etsy old").hover();
  await restore.click();
  await expect(toast(page, "Couldn’t restore “Etsy old”")).toContainText("Needs Delete where it was. Ask the team’s admin.");
  // Their own delete reads "You".
  await add(page, { id: "tp-shop-8", kind: "profile", name: "Etsy older", folder: "Shops", deleted_by: "m-dana" });
  await expect(trashRow(page, "Etsy older")).toBeVisible();
  expect(await cells(page, "Etsy older")).toEqual(expect.arrayContaining(["You"]));
});

test("a member's delete with Delete on the team goes to the team's Trash, and Restore brings it back", async ({ page }) => {
  await asMember(page, allow(TEAM, "see", "start", "create", "delete"));
  await page.locator("aside [data-nav='bookmarks']").click();
  await call(page, "bookmark_save", { entry: { id: "", title: "Orders", url: "https://example.com/orders", folder: "" } });
  const saved = await call(page, "bookmark_list", {}) as { id: string; title: string }[];
  await call(page, "bookmark_delete", { id: saved.find((b) => b.title === "Orders")!.id });
  await expect(trashItem(page)).toBeVisible();
  await trashItem(page).click();
  await expect(trashRow(page, "Orders")).toBeVisible();
  expect(await cells(page, "Orders")).toEqual(expect.arrayContaining(["Bookmark", "You"]));
  await trashRow(page, "Orders").hover();
  await trashRow(page, "Orders").getByRole("button", { name: "Restore" }).click();
  await expect(toast(page, "Restored “Orders”")).toBeVisible();
  // The Trash item stays while they are on it, though nothing is left.
  await expect(page.locator("main")).toContainText("The team’s Trash is empty");
  await expect(trashItem(page)).toBeVisible();
  await page.locator("aside [data-nav='bookmarks']").click();
  await expect(page.locator("main")).toContainText("Orders");
});

test("a tag restore by a member without Delete: a taken name is said before the server judges", async ({ page }) => {
  await asMember(page, allow(TEAM, "see", "start"));
  await page.evaluate(() => {
    const m = (window as unknown as M).__shardxMock;
    (m.state.tags ??= { tags: [] }).tags.push({ id: "tag-live", name: "VIP", color: "blue" });
    m.save();
  });
  await add(page, { id: "tag-old", kind: "tag", name: "vip" });
  // As admin.rs: the launcher looks at the name first; the server's "not allowed" comes after.
  expect(await call(page, "team_trash_restore", { teamId: MEMBER_TEAM, id: "tag-old", kind: "tag" })).toBe("refused: a tag named VIP already exists");
  await page.evaluate(() => {
    const m = (window as unknown as M).__shardxMock;
    m.state.tags!.tags = m.state.tags!.tags.filter((t) => t.id !== "tag-live");
    m.save();
  });
  expect(await call(page, "team_trash_restore", { teamId: MEMBER_TEAM, id: "tag-old", kind: "tag" })).toBe("refused: not allowed");
});

test("in Russian the team's Trash says its words", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.lang", "ru"));
  await openApp(page);
  // Joined as the Join dialog does, without its English labels.
  const [server, token] = ADMIN_INVITE.split("#");
  await call(page, "team_join", { server, token });
  await expect(space(page)).toHaveText("Ads team");
  await waitForIdle(page);
  await call(page, "profile_delete", { id: "tp-misc-1" });
  await trashItem(page).click();
  const ru = page.getByRole("treegrid", { name: "Корзина команды", exact: true }).locator("[role='row'][data-row-id]").filter({ hasText: "Shared sandbox" });
  await expect(ru).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Корзина команды");
  expect(await ru.locator("[role='gridcell']").allTextContents()).toEqual(expect.arrayContaining(["Профиль", "Без папки", "Администратор", "30 дней"]));
});

test("the personal Trash keeps its own list beside a team's", async ({ page }) => {
  await asAdmin(page);
  await call(page, "profile_delete", { id: "tp-ads-3" });
  await space(page).click();
  await menu(page).getByRole("menuitemradio", { name: "Personal" }).click();
  await expect(space(page)).toHaveText("Personal");
  await trashItem(page).click();
  const own = page.getByRole("treegrid", { name: "Trash", exact: true });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trash");
  await expect(own.locator("[role='row'][data-row-id]").first()).toBeVisible();
  await expect(own.locator("[role='row'][data-row-id]").filter({ hasText: "Google Ads 01" })).toHaveCount(0);
  expect(await callsOf(page, "trash_list")).not.toEqual([]);
});
