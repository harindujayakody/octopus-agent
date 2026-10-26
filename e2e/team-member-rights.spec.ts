import { expect, test, type Page } from "@playwright/test";
import { openApp, waitForIdle } from "./support/app";
import { MEMBER_INVITE, joinTeam, menu, space, toast } from "./support/team";

// A member's rights in a team space (team step 5, phase B). The mock judges each door as
// space/doors.rs does, by the shared rule (narrowest grant wins, a refusal at the same width):
// Dana Kim joins the Shops team, and `teamGrants` sets her rules as a new permission would.
// Ads holds tp-ads-1..3, Shops tp-shop-1..3, and tp-misc-1..2 are in no folder.

type Scope = { kind: "team" } | { kind: "folder"; name: string } | { kind: "profile"; id: string };
type Grant = { scope: Scope; action: string; allow: boolean };
type M = {
  __shardxMock: {
    log: { cmd: string; args: Record<string, unknown> }[];
    epoch: number;
    teamGrants: (g: Grant[]) => void;
    teamOpenOn: (id: string, on: { device_name: string; member_name: string } | null) => void;
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
/** A command sent straight to the mock's backend, its refusal as text. */
const raw = (page: Page, cmd: string, args: Record<string, unknown>) =>
  page.evaluate(([c, a]) => {
    const w = window as unknown as M;
    return w.__TAURI_INTERNALS__.invoke(c as string, { ...(a as object), epoch: w.__shardxMock.epoch }).then(() => "done", (e) => String(e));
  }, [cmd, args] as const);

/** Joined as Dana Kim, holding exactly `grants` once the team has told the launcher. */
async function asMember(page: Page, grants: Grant[]) {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, MEMBER_INVITE);
  await expect(space(page)).toHaveText("Shops team");
  await expect(row(page, "tp-shop-1")).toBeVisible();
  await page.evaluate((g) => (window as unknown as M).__shardxMock.teamGrants(g), grants);
  await waitForIdle(page);
}

/** Every frame, whether the row was gone at any moment since: a refused write never hides it. */
async function watchGone(page: Page, id: string) {
  await page.evaluate((rid) => {
    const w = window as unknown as { __gone?: boolean };
    w.__gone = false;
    const look = () => {
      if (!document.querySelector(`main [data-profile-id='${rid}']`)) w.__gone = true;
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }, id);
  return () => page.evaluate(() => (window as unknown as { __gone?: boolean }).__gone);
}

test("see only: nothing starts or changes, each way says why, and the form opens to read", async ({ page }) => {
  await asMember(page, allow(TEAM, "see"));
  const ads = row(page, "tp-ads-1");
  // The row's Start: off, and its tooltip says why.
  await ads.hover();
  const start = ads.getByRole("button", { name: "Start" });
  await expect(start).toHaveAttribute("aria-disabled", "true");
  await expect(start).toHaveAttribute("aria-description", "Needs Start on this profile. Ask the team’s admin.");
  await start.click({ force: true });
  // Read-only: no cell has an edit button, and a double-click edits nothing.
  await expect(ads.locator("[data-cell='proxy'] button, [data-cell='folder'] button")).toHaveCount(0);
  await ads.locator("[data-cell='proxy']").dblclick();
  await expect(ads.getByRole("textbox")).toHaveCount(0);
  // The list's own key does nothing either.
  await ads.locator("[data-cell='status']").click();
  await page.keyboard.press("s");
  expect(await callsOf(page, "launch")).toEqual([]);

  // The row menu: each action it may not do is off, with the reason; no pin, no cookies.
  await ads.click({ button: "right" });
  await expect(item(page, /^Start/)).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, /^Start/)).toContainText("Needs Start on this profile. Ask the team’s admin.");
  for (const name of [/^Rename/, /^Clone/, /^Move to folder/, /^Edit tags/, /^Change proxy/]) await expect(item(page, name)).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, /^Clone/)).toContainText("Needs Create in “Ads”. Ask the team’s admin.");
  await expect(item(page, /^Delete/)).toContainText("Needs Delete on this profile. Ask the team’s admin.");
  await expect(item(page, /^Pin/)).toHaveCount(0);
  await expect(item(page, /cookies/i)).toHaveCount(0);
  await expect(item(page, /^Move to Trash/)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Peek says what this person may do, and its Start is off too.
  await expect(peek(page).locator("[data-property='access']")).toContainText("See");
  await expect(peek(page).getByRole("button", { name: "Start" })).toHaveAttribute("aria-disabled", "true");
  // The form opens to read: every field there, nothing to save.
  await peek(page).locator("[data-peek-edit]").click();
  const form = page.getByRole("dialog", { name: "View FB Ads 01" });
  await expect(form).toContainText("You can view this profile, not change it. Needs Edit on this profile. Ask the team’s admin.");
  await expect(form.getByRole("textbox", { name: "Name" })).toBeDisabled();
  await expect(form.getByRole("button", { name: "Save" })).toHaveCount(0);
  // The footer's Close, beside the dialog's own close button.
  await form.locator("form").getByRole("button", { name: "Close" }).click();
  await expect(form).toHaveCount(0);

  // A new profile needs Create somewhere; a team's folders are its admin's.
  await expect(page.locator("main header").getByRole("button", { name: "New profile" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("aside [data-new-folder]")).toHaveAttribute("aria-disabled", "true");
  // A member who sees nothing in the team's Trash has no Trash item.
  await expect(page.locator("aside [data-nav='trash']")).toHaveCount(0);
  expect([...await callsOf(page, "profile_save"), ...await callsOf(page, "profile_delete"), ...await callsOf(page, "launch")]).toEqual([]);
});

test("Start without Cookies starts the profile, and says what it leaves out", async ({ page }) => {
  await asMember(page, allow(TEAM, "see", "start"));
  const misc = row(page, "tp-misc-1");
  await misc.locator("[data-cell='status']").click();
  await expect(peek(page).locator("[data-property='access']")).toContainText("See, Start");
  await expect(peek(page).locator("[data-start-no-cookies]")).toHaveText(
    "Starts without “Cookies”: its session is on this computer only while it’s open, and automation, a debugger and the API can’t drive it.",
  );
  await peek(page).getByRole("button", { name: "Start" }).click();
  await expect.poll(async () => (await callsOf(page, "launch")).map((a) => a.profileId)).toEqual(["tp-misc-1"]);
  await expect(misc.locator("[data-cell='status']")).toContainText("Running");
  // Its debugging address stays closed without Cookies.
  await misc.click({ button: "right" });
  await expect(item(page, /^Copy the debugging address/)).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, /^Copy the debugging address/)).toContainText("Needs “Cookies” on this profile: without it the team keeps its debugging address closed.");
  await expect(item(page, /^Rename/)).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  // Driving it is refused by the backend in those words.
  expect(await raw(page, "automation_launch", { profileId: "tp-misc-2" })).toBe("not allowed in this team: needs cookies on the profile");
});

test("Edit without Delete: a change saves; a delete is refused before anything leaves the list", async ({ page }) => {
  await asMember(page, allow(TEAM, "see", "start", "edit"));
  const etsy = row(page, "tp-shop-1");
  // E renames it.
  await etsy.locator("[data-cell='status']").click();
  await page.keyboard.press("Escape");
  await etsy.focus();
  await page.keyboard.press("e");
  const field = etsy.getByRole("textbox");
  await field.fill("Etsy main (US)");
  await field.press("Enter");
  await expect(etsy.locator("[data-cell='name']")).toContainText("Etsy main (US)");
  await expect.poll(async () => (await callsOf(page, "profile_save")).length).toBe(1);

  // Delete: the key, the menu and the bulk bar refuse it, and the row never leaves for a moment.
  const gone = await watchGone(page, "tp-shop-1");
  await etsy.focus();
  await page.keyboard.press("Delete");
  await etsy.click({ button: "right" });
  await expect(item(page, /^Delete/)).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, /^Delete/)).toContainText("Needs Delete on this profile. Ask the team’s admin.");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await callsOf(page, "profile_delete")).toEqual([]);
  expect(await gone()).toBe(false);
  // The backend says the same, in its own words.
  expect(await raw(page, "profile_delete", { id: "tp-shop-1" })).toBe("not allowed in this team: needs delete on the profile");

  // Move to folder: a folder it may not create in is off; staying is no move.
  await etsy.click({ button: "right" });
  await item(page, /^Move to folder/).click();
  const picker = page.getByRole("dialog", { name: "Move to folder" });
  await expect(picker.getByRole("option", { name: /Ads/ })).toHaveAttribute("aria-disabled", "true");
  await expect(picker.getByRole("option", { name: /Ads/ })).toContainText("No “Create” here");
  await page.keyboard.press("Escape");
  expect(await callsOf(page, "profile_set_folder")).toEqual([]);
});

test("a folder's grant covers its profiles only; a team's delete asks first and has no Undo", async ({ page }) => {
  await asMember(page, [...allow(TEAM, "see"), ...allow(SHOPS, "start", "edit", "delete", "create")]);
  await row(page, "tp-shop-1").hover();
  await expect(row(page, "tp-shop-1").getByRole("button", { name: "Start" })).not.toHaveAttribute("aria-disabled", "true");
  await row(page, "tp-ads-1").hover();
  await expect(row(page, "tp-ads-1").getByRole("button", { name: "Start" })).toHaveAttribute("aria-disabled", "true");

  // Both picked: the one it may delete is asked about, the other is named and stays.
  const gone = await watchGone(page, "tp-ads-1");
  for (const id of ["tp-ads-1", "tp-shop-1"]) await row(page, id).locator("[data-cell='checkbox'] input").check({ force: true });
  await page.getByRole("toolbar", { name: /selected/ }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(toast(page, "Couldn’t delete “FB Ads 01”")).toContainText("Needs Delete on these profiles. Ask the team’s admin.");
  const ask = page.getByRole("alertdialog", { name: "Delete “Etsy main”?" });
  await expect(ask).toContainText("A deleted profile is gone for everyone in the team.");
  await ask.getByRole("button", { name: "Delete" }).click();
  const done = toast(page, "Deleted “Etsy main”");
  await expect(done).toBeVisible();
  await expect(done.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(row(page, "tp-shop-1")).toHaveCount(0);
  expect((await callsOf(page, "profile_delete")).map((a) => a.id)).toEqual(["tp-shop-1"]);
  expect(await gone()).toBe(false);

  // A new profile goes where Create is given: no folder is refused, Shops is taken.
  await page.locator("main header").getByRole("button", { name: "New profile" }).click();
  const form = page.getByRole("dialog", { name: "New profile" });
  await expect(form.locator("[data-rights-problem]")).toHaveText("Needs Create for profiles in no folder. Ask the team’s admin.");
  await expect(form.getByRole("button", { name: "Create profile" })).toHaveAttribute("aria-disabled", "true");
  await form.locator("[data-property='folder'] button").click();
  await page.getByRole("option", { name: "Shops" }).click();
  await expect(form.locator("[data-rights-problem]")).toHaveCount(0);
  await form.getByRole("button", { name: "Create profile" }).click();
  await expect(form).toHaveCount(0);
  const made = (await callsOf(page, "profile_save"))[0] as { payload: { _meta: { id: string; folder: string } } };
  expect(made.payload._meta).toMatchObject({ id: "", folder: "Shops" });
});

test("a profile open on another device says who has it, and starts here once it is closed there", async ({ page }) => {
  await asMember(page, allow(TEAM, "see", "start"));
  await page.evaluate(() => (window as unknown as M).__shardxMock.teamOpenOn("tp-shop-1", { device_name: "Lee’s laptop", member_name: "Lee Park" }));
  const etsy = row(page, "tp-shop-1");
  await expect(etsy.locator("[data-cell='status']")).toContainText("On Lee’s laptop");
  await expect(etsy.locator("[data-cell='status']")).toContainText("Open on Lee’s laptop by Lee Park, opened 12 min ago. It starts here once it’s closed there.");
  await etsy.hover();
  await expect(etsy.getByRole("button", { name: "Start" })).toHaveAttribute("aria-description", "Open on Lee’s laptop by Lee Park: it starts here once it’s closed there.");
  // Nobody takes a team's profile over from here: that is personal sync's.
  await etsy.click({ button: "right" });
  await expect(item(page, /^Start/)).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, /^Open here instead/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await etsy.locator("[data-cell='status']").click();
  await expect(peek(page).locator("[data-property='open-on']")).toContainText("Lee’s laptop (Lee Park)");
  expect(await raw(page, "launch", { profileId: "tp-shop-1" })).toBe("this profile is open on Lee’s laptop: close it there first");
  expect(await callsOf(page, "launch")).toHaveLength(1);

  // Closed there: it starts here.
  await page.evaluate(() => (window as unknown as M).__shardxMock.teamOpenOn("tp-shop-1", null));
  await expect(etsy.locator("[data-cell='status']")).toContainText("Never run");
  await etsy.hover();
  await etsy.getByRole("button", { name: "Start" }).click();
  await expect(etsy.locator("[data-cell='status']")).toContainText("Running");
});

test("a personal synced profile open on another computer is taken here with Open here instead", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockSync?: string }).__shardxMockSync = "connected"; });
  await openApp(page, { section: "profiles" });
  const office = page.locator("[role='row'][data-profile-id]", { hasText: "Office main" });
  await expect(office.locator("[data-cell='status']")).toContainText("On Work-PC");
  await office.click({ button: "right" });
  await item(page, /^Open here instead/).click();
  const take = page.getByRole("dialog", { name: "Open “Office main” here instead?" });
  await take.getByRole("button", { name: "Open here" }).click();
  await expect.poll(async () => (await callsOf(page, "profile_sync_take")).map((a) => a.id)).toEqual(["sync-office-main"]);
  await expect.poll(async () => (await callsOf(page, "launch")).map((a) => a.profileId)).toEqual(["sync-office-main"]);
  await expect(office.locator("[data-cell='status']")).not.toContainText("On Work-PC");
});

test("a team's own rights rule its bookmarks, proxies, extensions and projects; it has no Trash", async ({ page }) => {
  await openApp(page, { section: "trash" });
  await joinTeam(page, MEMBER_INVITE);
  // Entering a team leaves its Trash: there is none here.
  await expect(page.locator("main")).toHaveAttribute("data-section", "profiles");
  await page.evaluate((g) => (window as unknown as M).__shardxMock.teamGrants(g), allow(TEAM, "see"));
  await waitForIdle(page);

  const why = "Needs Create in this team. Ask the team’s admin.";
  await page.locator("aside [data-nav='bookmarks']").click();
  const newBookmark = page.locator("main header").getByRole("button", { name: "New bookmark" });
  await expect(newBookmark).toHaveAttribute("aria-disabled", "true");
  await expect(newBookmark).toHaveAttribute("aria-description", why);
  await page.keyboard.press("c");
  await expect(page.getByRole("dialog", { name: "New bookmark" })).toHaveCount(0);

  await page.locator("aside [data-nav='proxies']").click();
  await expect(page.locator("main header").getByRole("button", { name: "Add proxies" })).toHaveAttribute("aria-description", why);

  await page.locator("aside [data-nav='extensions']").click();
  await page.locator("main header").getByRole("button", { name: "Add extension" }).click();
  await expect(item(page, /^From a link/)).toHaveAttribute("aria-disabled", "true");
  await expect(item(page, /^From a link/)).toContainText(why);
  await page.keyboard.press("Escape");

  await page.locator("aside [data-nav='automation']").click();
  await expect(page.locator("main header").getByRole("button", { name: "New project" })).toHaveAttribute("aria-disabled", "true");

  // Create given: the same button works, once the team has told the launcher.
  await page.evaluate((g) => (window as unknown as M).__shardxMock.teamGrants(g), allow(TEAM, "see", "create"));
  await page.locator("aside [data-nav='bookmarks']").click();
  await expect(newBookmark).not.toHaveAttribute("aria-disabled", "true");
  await newBookmark.click();
  await expect(page.getByRole("dialog", { name: "New bookmark" })).toBeVisible();
});
