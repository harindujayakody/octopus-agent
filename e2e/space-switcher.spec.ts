import { expect, test, type Page } from "@playwright/test";
import { openApp, reloadApp } from "./support/app";

// The space switcher at the foot of the sidebar: the person's own space or a
// team's, joined with an invite. The mock's team server accepts any "stm_…"
// member token and names the team after the host.
const INVITE = "http://ads.example.net:8787#stm_mockmembertoken";

const space = (page: Page) => page.locator("aside [data-nav='space']");
const menu = (page: Page) => page.getByRole("menu");
const dialog = (page: Page) => page.getByRole("dialog");

async function join(page: Page) {
  await space(page).click();
  await menu(page).getByRole("menuitem", { name: "Join a team…" }).click();
  await dialog(page).getByRole("textbox", { name: "Server address" }).fill(INVITE);
  await dialog(page).getByRole("button", { name: "Join" }).click();
  await expect(dialog(page)).toHaveCount(0);
}

test("the switcher sits first in the sidebar's foot and starts in the personal space", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  const foot = page.locator("[data-sidebar-footer] button").first();
  await expect(foot).toHaveAttribute("data-nav", "space");
  await expect(space(page)).toHaveText("Personal");
  await space(page).click();
  await expect(menu(page).getByRole("menuitemradio", { name: "Personal" })).toHaveAttribute("aria-checked", "true");
});

test("a pasted invite fills both fields, and joining moves the launcher into the team", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await space(page).click();
  await menu(page).getByRole("menuitem", { name: "Join a team…" }).click();
  await dialog(page).getByRole("textbox", { name: "Server address" }).fill(INVITE);
  await expect(dialog(page).getByRole("textbox", { name: "Server address" })).toHaveValue("http://ads.example.net:8787");
  await expect(dialog(page).getByLabel("Access token")).toHaveValue("stm_mockmembertoken");
  await dialog(page).getByRole("button", { name: "Join" }).click();
  await expect(space(page)).toHaveText("Ads team");
  await expect(space(page)).toHaveAttribute("data-space", "team");
  // And it is still there after a restart.
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("shardx-mock-state") ?? "{}").space?.kind))
    .toBe("team");
  await reloadApp(page);
  await expect(space(page)).toHaveText("Ads team");
});

test("a token the server does not know is said in the dialog, which stays open", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await space(page).click();
  await menu(page).getByRole("menuitem", { name: "Join a team…" }).click();
  await dialog(page).getByRole("textbox", { name: "Server address" }).fill("http://ads.example.net:8787");
  await dialog(page).getByLabel("Access token").fill("wrong");
  await dialog(page).getByRole("button", { name: "Join" }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("does not know this token");
  await expect(space(page)).toHaveText("Personal");
});

test("switching back and leaving: the menu marks the active space, and leaving returns to personal", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await join(page);
  await space(page).click();
  await expect(menu(page).getByRole("menuitemradio", { name: /Ads team/ })).toHaveAttribute("aria-checked", "true");
  await menu(page).getByRole("menuitemradio", { name: "Personal" }).click();
  await expect(space(page)).toHaveText("Personal");

  await space(page).click();
  await menu(page).getByRole("menuitemradio", { name: /Ads team/ }).click();
  await expect(space(page)).toHaveText("Ads team");
  await space(page).click();
  await menu(page).getByRole("menuitem", { name: "Leave this team…" }).click();
  // Leaving is a danger confirm, which the app draws as an alert dialog.
  await page.getByRole("alertdialog").getByRole("button", { name: "Leave team" }).click();
  await expect(space(page)).toHaveText("Personal");
  await space(page).click();
  await expect(menu(page).getByRole("menuitemradio")).toHaveCount(1);
});

test("a team that withdrew this launcher shows so and can only be forgotten", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await join(page);
  // As live.rs revoke: the team marked, the launcher back in its own space.
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("shardx-mock-state") ?? "{}");
    st.teams = st.teams.map((t: object) => ({ ...t, revoked: true }));
    st.space = { kind: "personal" };
    localStorage.setItem("shardx-mock-state", JSON.stringify(st));
  });
  await reloadApp(page);
  await expect(space(page)).toHaveText("Personal");
  await space(page).click();
  const gone = menu(page).getByRole("menuitem", { name: "Ads team" });
  await expect(gone).toHaveAccessibleDescription("Access withdrawn");
  await expect(menu(page).getByRole("menuitemradio")).toHaveCount(1);
  await gone.click();
  await page.getByRole("button", { name: "Forget team" }).click();
  // The menu reads the teams as it opens: wait for the launcher to forget it.
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("shardx-mock-state") ?? "{}").teams?.length))
    .toBe(0);
  await space(page).click();
  await expect(menu(page).getByRole("menuitem", { name: "Ads team" })).toHaveCount(0);
});

// As live.rs token_replaced: the admin made a new invite, so the token kept
// here is gone; the launcher is back in its own space.
async function replaceToken(page: Page, opts: { backToPersonal: boolean }) {
  await page.evaluate((personal) => {
    const mock = (window as unknown as { __shardxMock: MockHandle }).__shardxMock;
    for (const t of mock.state.teams) t.needs_invite = true;
    const server = mock.state.teamServers["team-ads.example.net:8787"];
    server.members.find((m) => m.token === "stm_mockmembertoken")!.token = "stm_mock_reissued";
    if (!personal) { mock.save(); return; }
    mock.state.space = { kind: "personal" };
    mock.save();
    mock.emit("space-changed", mock.state.space);
  }, opts.backToPersonal);
}
type MockHandle = {
  state: {
    teams: { needs_invite?: boolean }[];
    teamServers: Record<string, { members: { token: string }[] }>;
    space: { kind: string };
  };
  save: () => void;
  emit: (event: string, payload?: unknown) => void;
};

test("a team whose token was replaced waits for its new invite, and Join opens with its address in", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await join(page);
  await replaceToken(page, { backToPersonal: true });
  await expect(space(page)).toHaveText("Personal");
  await space(page).click();
  const waiting = menu(page).getByRole("menuitem", { name: "Ads team" });
  await expect(waiting).toHaveAccessibleDescription("Needs a new invite");
  // Not a space to pick until the new invite is in.
  await expect(menu(page).getByRole("menuitemradio")).toHaveCount(1);
  await waiting.click();
  const ask = page.getByRole("dialog", { name: "Ads team needs a new invite" });
  await expect(ask).toContainText("The team’s admin made you a new invite");
  await ask.getByRole("button", { name: "Paste new invite…" }).click();

  const joinDialog = page.getByRole("dialog", { name: "Join a team" });
  await expect(joinDialog.getByRole("textbox", { name: "Server address" })).toHaveValue("http://ads.example.net:8787");
  const token = joinDialog.getByLabel("Access token");
  await expect(token).toHaveValue("");
  await expect(token).toBeFocused();
  // The address it opened with is not an edit: Esc closes it without asking.
  await page.keyboard.press("Escape");
  await expect(joinDialog).toHaveCount(0);
  await space(page).click();
  await menu(page).getByRole("menuitem", { name: "Ads team" }).click();
  await ask.getByRole("button", { name: "Paste new invite…" }).click();
  await token.fill("stm_mock_reissued");
  await joinDialog.getByRole("button", { name: "Join" }).click();
  await expect(joinDialog).toHaveCount(0);
  await expect(space(page)).toHaveText("Ads team");
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("shardx-mock-state") ?? "{}").teams?.[0]?.needs_invite ?? false))
    .toBe(false);
});

// No new invite coming: the same question forgets the team.
test("a team waiting for a new invite can be forgotten from the same question", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await join(page);
  await replaceToken(page, { backToPersonal: true });
  await expect(space(page)).toHaveText("Personal");
  await space(page).click();
  await menu(page).getByRole("menuitem", { name: "Ads team" }).click();
  const ask = page.getByRole("dialog", { name: "Ads team needs a new invite" });
  await ask.getByRole("button", { name: "Forget team" }).click();
  await expect(ask).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("shardx-mock-state") ?? "{}").teams?.length))
    .toBe(0);
  await space(page).click();
  await expect(menu(page).getByRole("menuitem", { name: "Ads team" })).toHaveCount(0);
});

test("a switch the launcher refuses is said, not lost, and the menu then shows why", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await join(page);
  await space(page).click();
  await menu(page).getByRole("menuitemradio", { name: "Personal" }).click();
  await expect(space(page)).toHaveText("Personal");
  // The token goes while the menu is open: it still offers the team.
  await space(page).click();
  await replaceToken(page, { backToPersonal: false });
  await menu(page).getByRole("menuitemradio", { name: /Ads team/ }).click();
  const said = page.locator("[data-toast]").filter({ hasText: "Couldn’t switch to “Ads team”" });
  await expect(said).toContainText("The server does not know this token: ask the team’s admin for a new invite.");
  await expect(space(page)).toHaveText("Personal");
  // The launcher read its teams again after the refusal.
  await space(page).click();
  await expect(menu(page).getByRole("menuitem", { name: "Ads team" })).toHaveAccessibleDescription("Needs a new invite");
});

test("in the folded rail the team shows as its initials and keeps its name", async ({ page }) => {
  await openApp(page, { section: "profiles" });
  await join(page);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(space(page).locator("[data-initials]")).toHaveText("AT");
  await expect(space(page)).toHaveAttribute("aria-label", "Ads team");
});

test("Views and the sidebar's folds are each space's own: a team starts with none, and personal keeps its", async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("shardx.views") === null) {
      localStorage.setItem("shardx.views", JSON.stringify({ version: 1, views: [{ id: "v-mine", name: "Mine", pinned: true, query: { folder: "all" } }] }));
    }
  });
  const folders = page.locator("aside nav").getByRole("button", { name: "Folders", exact: true });
  const mine = page.locator("aside [data-view='v-mine']");
  await openApp(page, { section: "profiles" });
  await expect(mine).toBeVisible();
  await join(page);
  await expect(mine).toHaveCount(0);
  // A fold made in the team is the team's.
  await folders.click();
  await expect(folders).toHaveAttribute("aria-expanded", "false");
  await space(page).click();
  await menu(page).getByRole("menuitemradio", { name: "Personal" }).click();
  await expect(space(page)).toHaveText("Personal");
  await expect(mine).toBeVisible();
  await expect(folders).toHaveAttribute("aria-expanded", "true");
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^shardx\.(views|sidebar)/.test(k)).sort());
  expect(keys).toEqual(["shardx.sidebar@team-ads.example.net:8787", "shardx.views"]);
  // And back in the team after a restart, its fold is still there.
  await space(page).click();
  await menu(page).getByRole("menuitemradio", { name: /Ads team/ }).click();
  await expect(folders).toHaveAttribute("aria-expanded", "false");
  await reloadApp(page);
  await expect(space(page)).toHaveText("Ads team");
  await expect(folders).toHaveAttribute("aria-expanded", "false");
  await expect(mine).toHaveCount(0);
});
