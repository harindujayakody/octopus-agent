import { expect, test } from "@playwright/test";
import { openApp, reloadApp } from "./support/app";
import {
  ADMIN_INVITE, ADMIN_TEAM, MEMBER_INVITE, dialog, folderRow, folders, joinTeam, memberRow, members, menu, openTeamPage, rowMenu, server, space, toast,
} from "./support/team";

// The Team page: how a team is made (the guide), and what its admin does
// there (members, invites, folders); a member sees their own access only.

test("the guide shows how to run the server either way and joins as admin, then opens the Team page", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  // The space row reads as a switch: it has the up-and-down mark.
  await expect(space(page).locator("[data-icon='unfold-more']")).toHaveCount(1);
  await space(page).click();
  await menu(page).getByRole("menuitem", { name: "Create a team…" }).click();
  const guide = dialog(page);
  await expect(guide.getByRole("heading", { name: "Create a team" })).toBeVisible();
  // Docker: the run line, then where its token is (the container's log).
  const commands = guide.locator("[data-command]");
  await expect(commands).toHaveCount(2);
  await expect(commands.nth(0)).toContainText("ghcr.io/harindujayakody/octopus-agent-team-server:latest");
  await expect(commands.nth(0)).toContainText("SHARDBROWSER_TEAM_BIND=0.0.0.0:8787");
  await expect(commands.nth(0)).not.toContainText("SHARDBROWSER_TEAM_NAME");
  await expect(commands.nth(1)).toHaveText("docker logs shardbrowser-team");
  // The name typed goes in as one word.
  await guide.getByRole("textbox", { name: "Team name" }).fill("Ads crew");
  await expect(commands.nth(0)).toContainText("-e SHARDBROWSER_TEAM_NAME='Ads crew'");
  await expect(guide.getByRole("button", { name: "Copy the command: Docker", exact: true })).toBeVisible();
  // The downloaded program: a link to it, and the line for the server's shell.
  await guide.getByRole("radio", { name: "Downloaded program" }).click();
  await expect(guide.getByRole("button", { name: "Download from the releases page" })).toBeVisible();
  await guide.getByRole("radio", { name: "Windows" }).click();
  await expect(commands).toHaveCount(1);
  await expect(commands.nth(0)).toContainText("$env:SHARDBROWSER_TEAM_NAME='Ads crew'; $env:SHARDBROWSER_TEAM_BIND='0.0.0.0:8787';");
  await guide.getByRole("radio", { name: "macOS, Linux" }).click();
  await expect(commands.nth(0)).toContainText("SHARDBROWSER_TEAM_NAME='Ads crew' SHARDBROWSER_TEAM_BIND=0.0.0.0:8787 SHARDBROWSER_TEAM_DATA_DIR=");
  await expect(guide).toContainText("127.0.0.1:8787 by default");
  await expect(guide).toContainText("Plain http on an IP address works too");

  // Join as admin waits for both, and says so.
  const joinBtn = guide.getByRole("button", { name: "Join as admin" });
  await expect(joinBtn).toHaveAttribute("aria-disabled", "true");
  await expect(guide).toContainText("Needs the server address and the token");
  // A wrong token is said in place, in words to act on, and the dialog stays.
  await guide.getByRole("textbox", { name: "Server address" }).fill("ads.example.net:8787");
  await guide.getByLabel("Admin token").fill("wrong");
  await joinBtn.click();
  await expect(guide.getByRole("alert")).toHaveText("The server does not know this token: ask the team’s admin for a new invite.");
  // A whole invite pasted into either field fills both.
  await guide.getByLabel("Admin token").fill(ADMIN_INVITE);
  await expect(guide.getByRole("textbox", { name: "Server address" })).toHaveValue(ADMIN_INVITE.split("#")[0]);
  await expect(guide.getByLabel("Admin token")).toHaveValue(ADMIN_INVITE.split("#")[1]);
  await joinBtn.click();
  await expect(dialog(page)).toHaveCount(0);

  await expect(page.locator("main h1")).toHaveText("Ads team");
  await expect(page).toHaveURL(/section=team/);
  // The keyboard lands on the new page, not on the menu item that opened the guide.
  await expect(page.locator("main [data-page-title]")).toBeFocused();
  await expect(space(page)).toHaveAttribute("aria-current", "page");
  await expect(page.locator("main [data-team-server]")).toContainText("ads.example.net:8787");
  await expect(members(page).locator("[data-row-id]")).toHaveCount(3);
  await expect(folders(page).locator("[data-row-id]")).toHaveCount(3);
  await expect(folderRow(page, "Ads")).toContainText("3");
  await expect(memberRow(page, "m-sam").locator("[data-member-status]")).toHaveText("Switched off");
});

test("Join a team takes a bare address as http, and the palette reaches every team step", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox").fill("join a team");
  await page.keyboard.press("Enter");
  const join = page.getByRole("dialog", { name: "Join a team" });
  await join.getByRole("textbox", { name: "Invite or server address" }).fill("ads.example.net:8787");
  await join.getByLabel("Access token").fill("eyJhbGciOiJIUzI1NiJ9.mock.admin");
  await join.getByRole("button", { name: "Join" }).click();
  await expect(join).toHaveCount(0);
  await expect(space(page)).toHaveText("Ads team");
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("shardx-mock-state") ?? "{}").teams?.[0]?.server))
    .toBe("http://ads.example.net:8787");

  // Add team member, only for the admin: it opens the Team page and the dialog on it.
  await page.keyboard.press("ControlOrMeta+k");
  await palette.getByRole("combobox").fill("add team member");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Add member" })).toBeVisible();
  await expect(page).toHaveURL(/section=team/);
});

test("the space menu keeps its groups: spaces, then team page, join and create, then leave", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await space(page).click();
  await expect(menu(page).getByRole("menuitem")).toHaveText(["Join a team…", "Create a team…"]);
  await page.keyboard.press("Escape");
  await joinTeam(page, ADMIN_INVITE);
  await space(page).click();
  await expect(menu(page).getByRole("menuitem")).toHaveText(["Manage team", "Join a team…", "Create a team…", "Leave this team…"]);
  // Leaving as the admin says the admin token is the only way back.
  await menu(page).getByRole("menuitem", { name: "Leave this team…" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Coming back takes the admin token the server printed on its first start");
});

test("adding a member shows their invite once, focused, and leads on to their rights", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  await page.locator("main header").getByRole("button", { name: "Add member" }).click();
  const add = dialog(page);
  const confirm = add.getByRole("button", { name: "Add member" });
  await expect(confirm).toHaveAttribute("aria-disabled", "true");
  // A name already in the team is said under the field.
  await add.getByRole("textbox", { name: "Name" }).fill("dana kim");
  await expect(add).toContainText("A member named “dana kim” is already here");
  await expect(confirm).toHaveAttribute("aria-disabled", "true");
  await add.getByRole("textbox", { name: "Name" }).fill("Riley Chen");
  await confirm.click();

  await expect(add.getByRole("heading", { name: "Invite for “Riley Chen”" })).toBeVisible();
  const invite = add.getByRole("textbox", { name: "Invite" });
  await expect(invite).toHaveValue(/^http:\/\/ads\.example\.net:8787#stm_[0-9a-f]+$/);
  // The keyboard is on the invite, so Enter is Done and a screen reader hears it.
  await expect(invite).toBeFocused();
  await expect(add.getByRole("button", { name: "Copy invite" })).toBeVisible();
  await expect(add).toContainText("they paste it in “Join a team”");
  await expect(add).toContainText("They have no rights yet");
  await expect(add.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  const riley = (await server(page)).members.find((m: { name: string }) => m.name === "Riley Chen");
  expect(riley.token).toMatch(/^stm_/);
  await expect(memberRow(page, riley.id).locator("[data-member-access]")).toHaveText("No rights yet");

  // Set rights opens the editor for them.
  await add.getByRole("button", { name: "Set rights…" }).click();
  await expect(page.getByRole("dialog", { name: "Rights for “Riley Chen”" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(memberRow(page, riley.id)).toBeFocused();
  await expect(members(page).locator("[data-row-id]")).toHaveCount(4);
});

test("Enter on the invite step is Done", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  await page.locator("main header").getByRole("button", { name: "Add member" }).click();
  await dialog(page).getByRole("textbox", { name: "Name" }).fill("Riley Chen");
  await page.keyboard.press("Enter");
  await expect(dialog(page).getByRole("textbox", { name: "Invite" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toHaveCount(0);
});

test("a member reads as invited until their invite is used, and an active one says when they were last seen", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  const status = (id: string) => memberRow(page, id).locator("[data-member-status]");
  await expect(status("m-dana")).toHaveText("Active");
  await status("m-dana").hover();
  await expect(page.getByRole("tooltip")).toHaveText("Last seen 5 minutes ago");
  await status("m-lee").hover();
  await expect(page.getByRole("tooltip")).toHaveText("Last seen 2 days ago");
  await expect(status("m-sam")).toHaveText("Switched off");

  // A new member is invited until they join with their invite.
  await page.locator("main header").getByRole("button", { name: "Add member" }).click();
  await dialog(page).getByRole("textbox", { name: "Name" }).fill("Riley Chen");
  await dialog(page).getByRole("button", { name: "Add member" }).click();
  const invite = await dialog(page).getByRole("textbox", { name: "Invite" }).inputValue();
  await dialog(page).getByRole("button", { name: "Done" }).click();
  const riley = (await server(page)).members.find((m: { name: string }) => m.name === "Riley Chen");
  await expect(status(riley.id)).toHaveText("Invited");
  await expect(status(riley.id)).toHaveAttribute("data-member-status", "invited");
  await status(riley.id).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Hasn’t used the invite yet");

  // Riley joins with it here, and this launcher then joins back as the admin.
  await joinTeam(page, invite);
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  await expect(status(riley.id)).toHaveText("Active");
  await status(riley.id).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Last seen now");
});

test("a new invite asks first, then shows a token that replaces the old one, which stops working", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  await expect(memberRow(page, "m-lee").locator("[data-member-status]")).toHaveText("Active");
  const reads = () => page.evaluate(() => (window as unknown as { __shardxMock: { calls: Record<string, number> } }).__shardxMock.calls.team_admin_overview);
  const readsBefore = await reads();
  await rowMenu(page, memberRow(page, "m-lee"));
  await menu(page).getByRole("menuitem", { name: "New invite…" }).click();
  await expect(dialog(page)).toContainText("The invite they have now stops working");
  await dialog(page).getByRole("button", { name: "Make new invite" }).click();
  const invite = dialog(page).getByRole("textbox", { name: "Invite" });
  await expect(invite).toHaveValue(/#stm_/);
  await expect(invite).toBeFocused();
  const token = (await invite.inputValue()).split("#")[1];
  expect((await server(page)).members.find((m: { id: string }) => m.id === "m-lee").token).toBe(token);
  expect(token).not.toBe("stm_mock_lee");
  await dialog(page).getByRole("button", { name: "Done" }).click();
  await expect(dialog(page)).toHaveCount(0);
  // Their row as the answer gave it, without reading the team again: invited until the new one is used.
  await expect(memberRow(page, "m-lee").locator("[data-member-status]")).toHaveText("Invited");
  expect(await reads()).toBe(readsBefore);

  // Lee's old invite is refused now, for the reason the server gives.
  await space(page).click();
  await menu(page).getByRole("menuitem", { name: "Join a team…" }).click();
  await dialog(page).getByRole("textbox", { name: "Invite or server address" }).fill("http://ads.example.net:8787#stm_mock_lee");
  await dialog(page).getByRole("button", { name: "Join" }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText("The server does not know this token: ask the team’s admin for a new invite.");
});

test("switching a member off and on again shows in their status and stays after a restart", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  const dana = memberRow(page, "m-dana");
  await expect(dana.locator("[data-member-access]")).toHaveText("Whole team: see and start; Shops: edit, cookies");
  await rowMenu(page, dana);
  await menu(page).getByRole("menuitem", { name: "Switch off" }).click();
  await expect(dana.locator("[data-member-status]")).toHaveText("Switched off");
  await expect(toast(page, "Switched off “Dana Kim”")).toBeVisible();

  await reloadApp(page);
  await expect(memberRow(page, "m-dana").locator("[data-member-status]")).toHaveText("Switched off");
  await rowMenu(page, memberRow(page, "m-dana"));
  await menu(page).getByRole("menuitem", { name: "Switch on" }).click();
  await expect(memberRow(page, "m-dana").locator("[data-member-status]")).toHaveText("Active");
});

test("a refused switch is said over the list in words to act on, not only in a toast", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  // The member went away on the server meanwhile.
  await page.evaluate((id) => {
    const s = (window as unknown as { __shardxMock: { state: { teamServers: Record<string, { members: { id: string }[] }> } } }).__shardxMock.state.teamServers[id];
    s.members = s.members.filter((m) => m.id !== "m-lee");
  }, ADMIN_TEAM);
  await rowMenu(page, memberRow(page, "m-lee"));
  await menu(page).getByRole("menuitem", { name: "Switch off" }).click();
  await expect(members(page).locator("[data-members-error]")).toHaveText("Couldn’t switch off “Lee Park”: It’s no longer on the server: someone changed it meanwhile.");
});

test("removing a member asks first, says their profiles stay, and Cancel keeps them", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  await rowMenu(page, memberRow(page, "m-lee"));
  await menu(page).getByRole("menuitem", { name: "Remove…" }).click();
  const ask = page.getByRole("alertdialog", { name: "Remove “Lee Park”?" });
  await expect(ask).toContainText("The profiles they made stay in the team.");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(memberRow(page, "m-lee")).toBeVisible();
  // The keyboard comes back to the row the menu was on.
  await expect(memberRow(page, "m-lee")).toBeFocused();

  // Delete on a focused row asks the same.
  await page.keyboard.press("Delete");
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove member" }).click();
  await expect(memberRow(page, "m-lee")).toHaveCount(0);
  await expect(toast(page, "Removed “Lee Park”")).toBeVisible();
  expect((await server(page)).members.map((m: { id: string }) => m.id)).toEqual(["m-dana", "m-sam"]);
  // The team's profiles are all still there.
  expect((await server(page)).profiles).toHaveLength(8);
});

test("renaming the team renames it in the header and the space menu, and gives the keyboard back", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  const more = page.locator("main header").getByRole("button", { name: "More actions" });
  await more.click();
  await menu(page).getByRole("menuitem", { name: "Rename team…" }).click();
  const field = dialog(page).getByRole("textbox", { name: "Team name" });
  await expect(field).toHaveValue("Ads team");
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await more.click();
  await menu(page).getByRole("menuitem", { name: "Rename team…" }).click();
  await field.fill("Ads crew");
  await dialog(page).getByRole("button", { name: "Rename" }).click();
  await expect(page.locator("main h1")).toHaveText("Ads crew");
  await expect(space(page)).toHaveText("Ads crew");
});

test("folders: a taken name is said under the field, the server's refusal in words, and a rename carries the rules", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  await expect(folders(page)).toContainText("a profile’s “Folder” field puts it in one of these");
  await folders(page).getByRole("button", { name: "New folder" }).click();
  const d = dialog(page);
  const create = d.getByRole("button", { name: "Create folder" });
  await d.getByRole("textbox", { name: "Name" }).fill("ads");
  await expect(d).toContainText("A folder named “ads” is already here");
  await expect(create).toHaveAttribute("aria-disabled", "true");
  // A name taken on the server meanwhile: its refusal, translated, in the footer.
  await d.getByRole("textbox", { name: "Name" }).fill("Retargeting");
  await page.evaluate((id) => {
    const s = (window as unknown as { __shardxMock: { state: { teamServers: Record<string, { folders: { name: string; color: string }[] }> } } }).__shardxMock.state.teamServers[id];
    s.folders.push({ name: "Retargeting", color: "" });
  }, ADMIN_TEAM);
  await create.click();
  await expect(d.getByRole("alert")).toHaveText("A folder of that name is already there.");
  await d.getByRole("textbox", { name: "Name" }).fill("Retargeting EU");
  await expect(d.getByRole("alert")).toHaveCount(0);
  await d.getByRole("radio", { name: "Violet" }).click();
  await create.click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(folderRow(page, "Retargeting EU")).toContainText("0");
  expect((await server(page)).folders.find((f: { name: string }) => f.name === "Retargeting EU").color).toBe("violet");

  // Rename Ads from its menu: its profiles and the rules that named it follow,
  // and the keyboard lands on the row under its new name.
  await rowMenu(page, folderRow(page, "Ads"));
  await menu(page).getByRole("menuitem", { name: "Edit…" }).click();
  await expect(dialog(page).getByRole("heading", { name: "Edit team folder" })).toBeVisible();
  await dialog(page).getByRole("textbox", { name: "Name" }).fill("Ads EU");
  await expect(dialog(page)).toContainText("The rights that name this folder follow the new name.");
  await dialog(page).getByRole("button", { name: "Save" }).click();
  await expect(folderRow(page, "Ads EU")).toContainText("3");
  await expect(folderRow(page, "Ads")).toHaveCount(0);
  await expect(folderRow(page, "Ads EU")).toBeFocused();
  const lee = (await server(page)).members.find((m: { id: string }) => m.id === "m-lee");
  expect(lee.grants.filter((g: { scope: { name?: string } }) => g.scope.name === "Ads EU")).toHaveLength(3);
  await expect(memberRow(page, "m-lee").locator("[data-member-access]")).toContainText("Ads EU: start, edit, create");
});

test("a folder opens as its profiles", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  await folderRow(page, "Shops").click();
  await expect(page).toHaveURL(/section=profiles/);
  await expect(page.locator("main h1")).toHaveText("Shops");
});

test("a folder that holds profiles cannot be deleted, and says why; an empty one goes", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, ADMIN_INVITE);
  await openTeamPage(page);
  await rowMenu(page, folderRow(page, "Shops"));
  const del = menu(page).getByRole("menuitem", { name: "Delete…" });
  await expect(del).toHaveAttribute("aria-disabled", "true");
  await expect(del).toHaveAccessibleDescription("3 profiles are still in it: move them out first");
  await page.keyboard.press("Escape");
  // Delete on the row says the same over the list, and asks nothing.
  await folderRow(page, "Shops").focus();
  await page.keyboard.press("Delete");
  await expect(folders(page).locator("[data-folders-error]")).toHaveText("Can’t delete “Shops”: 3 profiles are still in it: move them out first");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // What the server still refuses, said in words: deleted profiles in its trash.
  await page.evaluate((id) => {
    const s = (window as unknown as { __shardxMock: { state: { teamServers: Record<string, { trash?: { id: string; folder: string }[] }> } } }).__shardxMock.state.teamServers[id];
    s.trash = [{ id: "tp-old-1", folder: "Warm-up" }];
  }, ADMIN_TEAM);
  await rowMenu(page, folderRow(page, "Warm-up"));
  await menu(page).getByRole("menuitem", { name: "Delete…" }).click();
  const ask = page.getByRole("alertdialog", { name: "Delete folder “Warm-up”?" });
  await ask.getByRole("button", { name: "Delete folder" }).click();
  await expect(ask.getByRole("alert")).toHaveText("Profiles deleted from this folder are kept in the team’s trash, so the folder stays for now.");
  await ask.getByRole("button", { name: "Cancel" }).click();

  await page.evaluate((id) => {
    const s = (window as unknown as { __shardxMock: { state: { teamServers: Record<string, { trash?: unknown[] }> } } }).__shardxMock.state.teamServers[id];
    s.trash = [];
  }, ADMIN_TEAM);
  await rowMenu(page, folderRow(page, "Warm-up"));
  await menu(page).getByRole("menuitem", { name: "Delete…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete folder" }).click();
  await expect(folderRow(page, "Warm-up")).toHaveCount(0);
  await expect(toast(page, "Deleted folder “Warm-up”")).toBeVisible();
});

test("a member sees their own access, read only, and nothing of the admin's", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await joinTeam(page, MEMBER_INVITE);
  await space(page).click();
  await expect(menu(page).getByRole("menuitem", { name: "Manage team" })).toHaveCount(0);
  await menu(page).getByRole("menuitem", { name: "Your access" }).click();
  const access = page.locator("main [data-team-section='access']");
  await expect(access.getByRole("heading", { name: "Your access" })).toBeVisible();
  await expect(page.locator("main h1")).toHaveText("Shops team");
  // A table, not a grid to edit: no button in it.
  const table = access.getByRole("table", { name: "Your access" });
  await expect(table).toBeVisible();
  await expect(access.getByRole("grid")).toHaveCount(0);
  await expect(table.getByRole("button")).toHaveCount(0);
  // A profile with a rule of its own is named as the team's list has it, and shows only that rule.
  await expect(table.getByRole("rowheader")).toHaveText(["Whole team", "Shops", /^FB Ads 02/]);
  const own = table.locator("[data-rights-row='profile:tp-ads-2']");
  await expect(own.getByRole("cell").nth(0)).toContainText("See, FB Ads 02: not set");
  await expect(own.getByRole("cell").nth(1)).toContainText("Start, FB Ads 02: refused");
  // Start on Shops comes from the whole team; Edit is the folder's own.
  const shops = table.locator("[data-rights-row='folder:Shops']");
  await expect(shops.getByRole("cell").nth(1)).toContainText("Start, Shops: not set, allowed by a wider rule");
  await expect(shops.getByRole("cell").nth(2)).toContainText("Edit, Shops: allowed");
  // Each cell says why on hover.
  await shops.getByRole("cell").nth(1).locator("[data-cell]").hover();
  await expect(page.getByRole("tooltip")).toHaveText("Shops, Start: allowed here by the whole-team rule");
  await expect(page.locator("main [data-team-section='members'], main [data-team-section='folders']")).toHaveCount(0);
  await expect(page.locator("main header").getByRole("button", { name: "Add member" })).toHaveCount(0);
});

test("in the personal space the Team page offers to create a team or join one", async ({ page }) => {
  await openApp(page, { section: "team" });
  await expect(page.locator("main h1")).toHaveText("Team");
  await expect(page.locator("main")).toContainText("You work in your personal space");
  await page.locator("main").getByRole("button", { name: "Join a team" }).click();
  await expect(dialog(page).getByRole("heading", { name: "Join a team" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await page.locator("main").getByRole("button", { name: "Create a team" }).click();
  await expect(dialog(page).getByRole("heading", { name: "Create a team" })).toBeVisible();
});
