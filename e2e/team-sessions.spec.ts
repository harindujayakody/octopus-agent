import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp, row, waitForIdle } from "./support/app";
import { ADMIN_INVITE, joinTeam, space, toast } from "./support/team";

// Team step 7 and verifier finding 9 (team phase C): Quit closes the team and synced
// profiles open here, each sent back first, so its question names them; and what became
// of a team profile's session as it closed is said in plain words, once. The mock tells
// a close as open.rs `tell` does: a warning first (stale, not saved), then "team-session".

type Outcome = "saved" | "stale" | "not_saved" | "discarded" | "kept";
type M = {
  __shardxMock: {
    calls: Record<string, number>;
    epoch: number;
    emit: (e: string, p?: unknown) => void;
    teamSessionEnds: (id: string, outcome: Outcome, why?: string) => void;
  };
  __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
};
type U = typeof import("../src/shared/model/unsaved");

const requestQuit = (page: Page) => page.evaluate(() => (window as unknown as M).__shardxMock.emit("app://quit-requested"));
const answers = (page: Page) =>
  page.evaluate(() => {
    const c = (window as unknown as M).__shardxMock.calls;
    return { confirmed: c.app_quit_confirmed ?? 0, cancelled: c.app_quit_cancelled ?? 0 };
  });
const question = (page: Page) => page.getByRole("dialog", { name: "Quit Octopus Agent?" });
const call = (page: Page, cmd: string, args: Record<string, unknown>) =>
  page.evaluate(([c, a]) => {
    const w = window as unknown as M;
    return w.__TAURI_INTERNALS__.invoke(c as string, { ...(a as object), epoch: w.__shardxMock.epoch });
  }, [cmd, args] as const);
const ends = (page: Page, id: string, outcome: Outcome, why?: string) =>
  page.evaluate(([i, o, w]) => (window as unknown as M).__shardxMock.teamSessionEnds(i as string, o as Outcome, w as string | undefined), [id, outcome, why] as const);
const warn = (page: Page, text: string) => page.evaluate((t) => (window as unknown as M).__shardxMock.emit("launcher-warning", t), text);

/** In the Ads team as its admin, with `ids` of its profiles running here. */
async function inTeamWith(page: Page, ids: string[]) {
  await openApp(page);
  await joinTeam(page, ADMIN_INVITE);
  await expect(space(page)).toHaveText("Ads team");
  for (const id of ids) await call(page, "launch", { profileId: id });
  await waitForIdle(page);
}

test("Quit names the team and synced profiles open here; Cancel stays, Save and quit goes on", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockSync?: string }).__shardxMockSync = "connected"; });
  await openApp(page);
  // Amazon US seller runs here (seeded) and now syncs; eBay DE buyer runs and does not.
  await call(page, "profile_sync_set", { ids: ["a78a0eea"], on: true });
  await joinTeam(page, ADMIN_INVITE);
  await expect(space(page)).toHaveText("Ads team");
  await row(page, "FB Ads 01").hover();
  await row(page, "FB Ads 01").getByRole("button", { name: "Start" }).click();
  await expect(row(page, "FB Ads 01").getByRole("button", { name: "Stop" })).toBeVisible();

  await requestQuit(page);
  await expect(question(page)).toBeVisible();
  await expect(question(page)).toContainText("These profiles are open here. Octopus Agent saves each one and closes it before it quits.");
  const items = question(page).locator("[data-confirm-items] li");
  // In the order they opened: Amazon US seller was running first.
  await expect(items).toHaveText([
    "Amazon US sellerSynced: will be saved and closed",
    "FB Ads 01Will be saved to “Ads team” and closed",
  ]);
  // Nothing is answered while the question is open.
  expect(await answers(page)).toEqual({ confirmed: 0, cancelled: 0 });
  await question(page).getByRole("button", { name: "Cancel" }).click();
  await expect.poll(() => answers(page)).toEqual({ confirmed: 0, cancelled: 1 });

  await requestQuit(page);
  await question(page).getByRole("button", { name: "Save and quit" }).click();
  await expect.poll(() => answers(page)).toEqual({ confirmed: 1, cancelled: 1 });
});

test("unsaved changes are asked first, then the open profiles", async ({ page }) => {
  await inTeamWith(page, ["tp-ads-1"]);
  await appModule(page, "/src/shared/model/unsaved.ts", "__unsaved");
  await page.evaluate(() => {
    (window as unknown as { __unsaved: U }).__unsaved.unsavedStore.setState({
      editors: [{ id: "fake", label: "Fake", save: async () => true, discard: () => {} }],
    });
  });
  await requestQuit(page);
  await page.getByRole("alertdialog", { name: "Save changes to Fake?" }).getByRole("button", { name: "Don’t save" }).click();
  await expect(question(page)).toContainText("This profile is open here. Octopus Agent saves it and closes it before it quits.");
  await expect(question(page).locator("[data-confirm-items] li")).toHaveText(["FB Ads 01Will be saved to “Ads team” and closed"]);
  await question(page).getByRole("button", { name: "Save and quit" }).click();
  await expect.poll(() => answers(page)).toEqual({ confirmed: 1, cancelled: 0 });
});

test("a team profile closed here says it was saved to the team; closes told together say so once", async ({ page }) => {
  await inTeamWith(page, ["tp-ads-1", "tp-ads-2", "tp-ads-3"]);
  await row(page, "FB Ads 01").hover();
  await row(page, "FB Ads 01").getByRole("button", { name: "Stop" }).click();
  await expect(toast(page, "“FB Ads 01” saved to the team")).toBeVisible();
  await call(page, "process_kill", { profileId: "tp-ads-2" });
  await call(page, "process_kill", { profileId: "tp-ads-3" });
  await expect(toast(page, "2 profiles saved to the team")).toBeVisible();
  await expect(toast(page, "“FB Ads 02” saved to the team")).toHaveCount(0);
});

test("a session not kept or not sent is said once, in plain words, with why", async ({ page }) => {
  await inTeamWith(page, ["tp-ads-1", "tp-shop-1"]);
  await ends(page, "tp-ads-1", "stale");
  const stale = toast(page, "Changes in “FB Ads 01” weren’t kept");
  await expect(stale).toContainText("Someone saved it from another device while it was open here, so the team keeps their version.");
  await ends(page, "tp-shop-1", "not_saved", "the team server did not answer: timed out");
  const unsent = toast(page, "“Etsy main” wasn’t saved to the team");
  await expect(unsent).toContainText("The team server isn’t answering. Try again once it’s back.");
  // The warning says it; the session's end adds no second toast, and no raw words show.
  await page.waitForTimeout(2000);
  await expect(toast(page, "FB Ads 01")).toHaveCount(1);
  await expect(toast(page, "Etsy main")).toHaveCount(1);
  await expect(page.locator("[data-toast]", { hasText: /was saved from another device|its session was not saved/ })).toHaveCount(0);
});

test("a copy kept for the new invite, and a session dropped with nothing to say why, are said", async ({ page }) => {
  await inTeamWith(page, ["tp-ads-1", "tp-ads-2", "tp-misc-2"]);
  await ends(page, "tp-ads-1", "kept");
  await expect(toast(page, "“FB Ads 01” is kept on this computer")).toContainText("It goes to the team once you paste the new invite.");
  await ends(page, "tp-ads-2", "discarded");
  await expect(toast(page, "“FB Ads 02” closed without saving to the team")).toContainText("What was done in it this time wasn’t kept.");
  // Its lost lease already said why: the end adds nothing.
  await warn(page, "Reddit 01: the lease is held by another device while this computer could not reach the team, so it was closed here and the changes made here were not kept.");
  await expect(toast(page, "“Reddit 01” was closed here")).toBeVisible();
  await ends(page, "tp-misc-2", "discarded");
  await page.waitForTimeout(2200);
  await expect(toast(page, "“Reddit 01” closed without saving")).toHaveCount(0);
});
