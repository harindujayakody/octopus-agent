import { expect, type Page } from "@playwright/test";

// The team flows' shared steps. The mock's team server seeds a team on the
// first join: an "eyJ…" token joins as its admin, an "stm_…" one as Dana Kim,
// a member with a few rules (src/dev/mock/teamServer.ts).
export const ADMIN_INVITE = "http://ads.example.net:8787#eyJhbGciOiJIUzI1NiJ9.mock.admin";
export const MEMBER_INVITE = "http://shops.example.org:8787#stm_mock_dana";
export const ADMIN_TEAM = "team-ads.example.net:8787";

export const space = (page: Page) => page.locator("aside [data-nav='space']");
export const menu = (page: Page) => page.getByRole("menu");
export const dialog = (page: Page) => page.getByRole("dialog");
export const members = (page: Page) => page.locator("main [data-team-section='members']");
export const folders = (page: Page) => page.locator("main [data-team-section='folders']");
export const memberRow = (page: Page, id: string) => members(page).locator(`[data-row-id='${id}']`);
export const folderRow = (page: Page, name: string) => folders(page).locator(`[data-row-id='${name}']`);
export const toast = (page: Page, text: string | RegExp) => page.locator("[data-toast]").filter({ hasText: text });

/** Joins with an invite through Join a team, which moves the launcher into the team. */
export async function joinTeam(page: Page, invite: string) {
  await space(page).click();
  await menu(page).getByRole("menuitem", { name: "Join a team…" }).click();
  await dialog(page).getByRole("textbox", { name: "Invite or server address" }).fill(invite);
  await dialog(page).getByRole("button", { name: "Join" }).click();
  await expect(dialog(page)).toHaveCount(0);
}

/** Opens the Team page from the space menu. */
export async function openTeamPage(page: Page, item: "Manage team" | "Your access" = "Manage team") {
  await space(page).click();
  await menu(page).getByRole("menuitem", { name: item }).click();
  await expect(page.locator("main [data-team-section]").first()).toBeVisible();
}

/** The mock team server's state for a team. */
export const server = (page: Page, teamId = ADMIN_TEAM) =>
  page.evaluate((id) => (window as unknown as { __shardxMock: { state: { teamServers?: Record<string, any> } } }).__shardxMock.state.teamServers?.[id], teamId);

/** A row's own menu, from its More button. */
export async function rowMenu(page: Page, row: ReturnType<Page["locator"]>) {
  await row.hover();
  await row.getByRole("button", { name: "More actions" }).click();
  await expect(menu(page)).toBeVisible();
}
