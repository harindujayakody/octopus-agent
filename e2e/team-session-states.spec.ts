import { expect, test, type Page } from "@playwright/test";
import { openApp, row, waitForIdle } from "./support/app";
import { ADMIN_INVITE, MEMBER_INVITE, joinTeam, menu, space, toast } from "./support/team";

// A team profile's session after its browser closes (open.rs send_back): sent again until the
// server takes it, "Saving…" meanwhile with Start refused BUSY, kept here for the next start
// when quitting cuts it short; and the launcher's newer team warnings, said in words.

type Outcome = "saved" | "stale" | "not_saved" | "discarded" | "kept";
type Scope = { kind: "team" } | { kind: "folder"; name: string } | { kind: "profile"; id: string };
type M = {
  __shardxMock: {
    epoch: number;
    emit: (e: string, p?: unknown) => void;
    save: () => void;
    state: {
      bookmarks: { id: string; title: string; url: string; folder: string }[];
      extensions: Record<string, unknown>[];
      profiles: Record<string, { _meta: { extensions: string[] } }>;
      saving?: Record<string, true>;
    };
    teamGrants: (g: { scope: Scope; action: string; allow: boolean }[]) => void;
    teamSessionEnds: (id: string, outcome: Outcome, why?: string, unsent?: boolean) => void;
    teamSessionResends: (id: string, why?: string) => void;
  };
  __shardxMockStartPayloads?: { id: string; extensions: string[]; bookmarks: string[] }[];
  __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
};

const BUSY = "It’s still opening or being saved here. Start it again in a moment.";
const peek = (page: Page) => page.locator("aside[data-peek]");
const status = (page: Page, name: string) => row(page, name).locator("[data-cell='status']");
const requestQuit = (page: Page) => page.evaluate(() => (window as unknown as M).__shardxMock.emit("app://quit-requested"));
const question = (page: Page) => page.getByRole("dialog", { name: "Quit Octopus Agent?" });
/** A command sent straight to the mock's backend: "done", or its refusal as text. */
const call = (page: Page, cmd: string, args: Record<string, unknown>) =>
  page.evaluate(([c, a]) => {
    const w = window as unknown as M;
    return w.__TAURI_INTERNALS__.invoke(c as string, { ...(a as object), epoch: w.__shardxMock.epoch }).then(() => "done", (e) => String(e));
  }, [cmd, args] as const);
const resends = (page: Page, id: string) => page.evaluate((i) => (window as unknown as M).__shardxMock.teamSessionResends(i), id);
const ends = (page: Page, id: string, outcome: Outcome, why?: string, unsent?: boolean) =>
  page.evaluate(([i, o, w, u]) => (window as unknown as M).__shardxMock.teamSessionEnds(i as string, o as Outcome, w as string | undefined, u as boolean | undefined), [id, outcome, why, unsent] as const);
const warn = (page: Page, text: string) => page.evaluate((t) => (window as unknown as M).__shardxMock.emit("launcher-warning", t), text);

async function inAdsTeam(page: Page, running: string[] = []) {
  await openApp(page);
  await joinTeam(page, ADMIN_INVITE);
  await expect(space(page)).toHaveText("Ads team");
  for (const id of running) await call(page, "launch", { profileId: id });
  await waitForIdle(page);
}

test("a closed profile whose session is sent again says Saving…, waits to start, and Quit names it", async ({ page }) => {
  await inAdsTeam(page, ["tp-ads-1"]);
  await expect(status(page, "FB Ads 01")).toContainText("Running");
  await resends(page, "tp-ads-1");
  await expect(toast(page, "“FB Ads 01” isn’t saved to the team yet"))
    .toContainText("The team server didn’t take its session. It’s kept on this computer and sent again until the server takes it.");
  await expect(status(page, "FB Ads 01")).toContainText("Saving…");

  // Start waits, and says why; the backend refuses a start in the same words.
  const fb = row(page, "FB Ads 01");
  await fb.hover();
  const start = fb.getByRole("button", { name: "Start" });
  await expect(start).toHaveAttribute("aria-disabled", "true");
  await expect(start).toHaveAttribute("aria-description", BUSY);
  expect(await call(page, "launch", { profileId: "tp-ads-1" })).toBe("this profile is still opening or being saved here: start it again in a moment");
  await fb.locator("[data-cell='status']").click();
  await expect(peek(page).locator("[data-peek-run-status]")).toContainText("Saving…");
  await expect(peek(page).getByRole("button", { name: "Start" })).toHaveAttribute("aria-disabled", "true");

  // Quitting waits for it too: the question names it as still on its way.
  await requestQuit(page);
  await expect(question(page).locator("[data-confirm-items] li")).toHaveText(["FB Ads 01Closed, still being saved to “Ads team”"]);
  await question(page).getByRole("button", { name: "Cancel" }).click();

  // The server takes it at last: Saving… ends with the save, and Start is back.
  await ends(page, "tp-ads-1", "saved");
  await expect(toast(page, "“FB Ads 01” saved to the team")).toBeVisible();
  await expect(status(page, "FB Ads 01")).not.toContainText("Saving…");
  await fb.hover();
  await expect(fb.getByRole("button", { name: "Start" })).not.toHaveAttribute("aria-disabled", "true");
});

test("a Stop whose save takes a while shows Saving… until it is in", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockSessionSaveMs?: number }).__shardxMockSessionSaveMs = 2500; });
  await inAdsTeam(page, ["tp-ads-2"]);
  const fb = row(page, "FB Ads 02");
  await expect(status(page, "FB Ads 02")).toContainText("Running");
  await fb.hover();
  await fb.getByRole("button", { name: "Stop" }).click();
  await expect(status(page, "FB Ads 02")).toContainText("Saving…");
  await expect(status(page, "FB Ads 02")).not.toContainText("Saving…");
  expect(await page.evaluate(() => Object.keys((window as unknown as { __shardxMock: { state: { saving?: object } } }).__shardxMock.state.saving ?? {}))).toEqual([]);
});

test("a switch of spaces with a team profile running never says it is saving", async ({ page }) => {
  await inAdsTeam(page, ["tp-ads-1"]);
  await expect(status(page, "FB Ads 01")).toContainText("Running");
  await space(page).click();
  await menu(page).getByRole("menuitemradio", { name: "Personal" }).click();
  await expect(space(page)).toHaveText("Personal");
  // Past the settling read: still open in the team, it is no business of this space.
  await page.waitForTimeout(3_000);
  await requestQuit(page);
  await expect(question(page).locator("[data-confirm-items] li")).toHaveText(["FB Ads 01Will be saved to “Ads team” and closed"]);
  await question(page).getByRole("button", { name: "Cancel" }).click();
  await space(page).click();
  await menu(page).getByRole("menuitemradio", { name: "Ads team" }).click();
  await expect(status(page, "FB Ads 01")).toContainText("Running");
  await page.waitForTimeout(3_000);
  await expect(status(page, "FB Ads 01")).toContainText("Running");
});

test("a session kept here for the next start says so in its own words", async ({ page }) => {
  await inAdsTeam(page, ["tp-ads-3"]);
  await ends(page, "tp-ads-3", "not_saved", "the team server did not take it in time", true);
  const kept = toast(page, "“Google Ads 01” is saved on this computer");
  await expect(kept).toContainText("It goes to the team when Octopus Agent starts next.");
  await expect(toast(page, "wasn’t saved to the team")).toHaveCount(0);
});

test("the clock and missing extensions warnings are said in words", async ({ page }) => {
  await inAdsTeam(page);
  await warn(page, "This computer's clock is 7 min ahead of the team server's, so the team's permission runs short: set the clock right, or FB Ads 01 may close when the permission runs out.");
  await expect(toast(page, "This computer’s clock is 7 min ahead"))
    .toContainText("The team’s permission runs out early by it. Set the clock right, or “FB Ads 01” may close when the permission runs out.");
  await warn(page, "FB Ads 02 started without 2 of its extensions: the team server did not give them to this launcher.");
  await expect(toast(page, "“FB Ads 02” started without 2 of its extensions")).toContainText("The team server didn’t send them to this computer.");
  await expect(page.locator("[data-toast]", { hasText: /team server's|did not give them/ })).toHaveCount(0);
});

test("in Russian the new team warnings read as Russian", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.lang", "ru"));
  await openApp(page);
  await warn(page, "FB Ads 02 started without 2 of its extensions: the team server did not give them to this launcher.");
  await expect(toast(page, "«FB Ads 02» запущен без 2 расширений")).toContainText("Сервер команды не передал их на этот компьютер.");
  await warn(page, "FB Ads 01 closed, and its session was not saved to the team: the team server did not take it in time; it is kept on this computer and sent when the launcher starts next");
  await expect(toast(page, "«FB Ads 01» сохранён на этом компьютере")).toContainText("Он уйдёт в команду при следующем запуске Octopus Agent.");
});

test("a second start of a personal profile while one is under way is refused in words", async ({ page }) => {
  await openApp(page);
  // A start from the Local API is under way (the mock's takes about a second).
  const first = call(page, "launch", { profileId: "f62a9d43" });
  await row(page, "Sandbox").hover();
  await row(page, "Sandbox").getByRole("button", { name: "Start" }).click();
  await expect(toast(page, "Couldn’t start “Sandbox”")).toContainText(BUSY);
  expect(await first).toBe("done");
});

test("a member with rights on a folder only gets the team's bookmarks and the profile's extensions at start", async ({ page }) => {
  await openApp(page);
  await joinTeam(page, MEMBER_INVITE);
  await expect(space(page)).toHaveText("Shops team");
  await page.evaluate(() => {
    const m = (window as unknown as M).__shardxMock;
    m.teamGrants([{ scope: { kind: "folder", name: "Shops" }, action: "see", allow: true }, { scope: { kind: "folder", name: "Shops" }, action: "start", allow: true }]);
    m.state.bookmarks.push({ id: "bm-team", title: "Orders", url: "https://example.com/orders", folder: "" });
    m.state.extensions.push({ id: "ext-a", name: "Wallet", version: "1.0.0", description: "", icon: "", path: "/x/ext-a", size_bytes: 1, added_at: "@0" });
    m.state.profiles["tp-shop-1"]._meta.extensions = ["ext-a", "ext-b"];
    m.save();
    m.emit("store-changed", "profiles");
  });
  await waitForIdle(page);
  // The team's lists show them nothing: no See on the team.
  expect(await page.evaluate(() => (window as unknown as M).__TAURI_INTERNALS__.invoke("bookmark_list"))).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as M).__TAURI_INTERNALS__.invoke("extension_list"))).toEqual([]);
  const shop = page.locator("[role='row'][data-profile-id='tp-shop-1']");
  await shop.locator("[data-cell='status']").click();
  await expect(peek(page).locator("[data-property='extensions']")).toContainText("2 team extensions");
  await shop.hover();
  await shop.getByRole("button", { name: "Start" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as M).__shardxMockStartPayloads?.at(-1)))
    .toEqual({ id: "tp-shop-1", extensions: ["ext-a", "ext-b"], bookmarks: ["bm-team"] });
});

const saving = (page: Page) => page.evaluate(() => Object.keys((window as unknown as M).__shardxMock.state.saving ?? {}));

test("a start that finds a session kept here unsent sends it first: Saving…, then Start is back", async ({ page }) => {
  await inAdsTeam(page, ["tp-ads-3"]);
  await ends(page, "tp-ads-3", "not_saved", "the team server did not take it in time", true);
  await page.evaluate(() => { (window as unknown as { __shardxMockSessionSaveMs?: number }).__shardxMockSessionSaveMs = 2500; });
  const google = row(page, "Google Ads 01");
  await google.hover();
  await google.getByRole("button", { name: "Start" }).click();
  // open.rs claim sends the kept copy and refuses this start: the row says it is saving, Start waits.
  await expect(toast(page, "Couldn’t start “Google Ads 01”")).toContainText(BUSY);
  await expect(status(page, "Google Ads 01")).toContainText("Saving…");
  await google.hover();
  await expect(google.getByRole("button", { name: "Start" })).toHaveAttribute("aria-description", BUSY);
  // Sent: Start is back, and the refused start is not left as a failure.
  await expect(status(page, "Google Ads 01")).not.toContainText("Saving…", { timeout: 10_000 });
  await expect(status(page, "Google Ads 01")).not.toContainText("Failed");
  await google.hover();
  await google.getByRole("button", { name: "Start" }).click();
  await expect(status(page, "Google Ads 01")).toContainText("Running");
});

test("only a team or synced profile is saving after Stop; a synced one says it goes to the sync server", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shardxMockSync?: string; __shardxMockSessionSaveMs?: number };
    w.__shardxMockSync = "connected";
    w.__shardxMockSessionSaveMs = 1500;
  });
  await openApp(page);
  // Amazon US seller and eBay DE buyer run here (seeded); only Amazon US seller syncs.
  await call(page, "profile_sync_set", { ids: ["a78a0eea"], on: true });
  await waitForIdle(page);

  const ebay = row(page, "eBay DE buyer");
  await ebay.hover();
  await ebay.getByRole("button", { name: "Stop" }).click();
  await expect(status(page, "eBay DE buyer")).not.toContainText("Running");
  await expect(status(page, "eBay DE buyer")).not.toContainText("Saving…");
  expect(await saving(page)).toEqual([]);

  const amazon = row(page, "Amazon US seller");
  await amazon.hover();
  await amazon.getByRole("button", { name: "Stop" }).click();
  await expect(status(page, "Amazon US seller")).toContainText("Saving…");
  await amazon.locator("[data-cell='status']").click();
  await expect(peek(page).locator("[data-peek-run-status]")).toContainText("Its session is being sent to the sync server");
  // Its send ends untold (no team-session): it leaves the list, and Saving… goes with it.
  await expect.poll(() => saving(page), { timeout: 10_000 }).toEqual([]);
  await expect(status(page, "Amazon US seller")).not.toContainText("Saving…", { timeout: 10_000 });
  expect(await call(page, "launch", { profileId: "a78a0eea" })).toBe("done");
});

test("the palette's Start follows a save that ends while it is open", async ({ page }) => {
  await inAdsTeam(page, ["tp-ads-1"]);
  await resends(page, "tp-ads-1");
  await expect(status(page, "FB Ads 01")).toContainText("Saving…");
  await row(page, "FB Ads 01").locator("[data-cell='status']").click();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const start = palette.getByRole("option", { name: /^Start/ }).first();
  await expect(start).toHaveAttribute("aria-disabled", "true");
  // Sent, and off the open list at the next read: no event and no list read move the palette.
  await page.evaluate(() => { delete (window as unknown as M).__shardxMock.state.saving!["tp-ads-1"]; });
  await expect(start).not.toHaveAttribute("aria-disabled", "true", { timeout: 10_000 });
});

test("Peek counts a team profile's extensions the member's list does not show as team extensions", async ({ page }) => {
  await openApp(page);
  await joinTeam(page, MEMBER_INVITE);
  await expect(space(page)).toHaveText("Shops team");
  await page.evaluate(() => {
    const m = (window as unknown as M).__shardxMock;
    m.teamGrants([{ scope: { kind: "team" }, action: "see", allow: true }]);
    for (const id of ["ext-a", "ext-b", "ext-c"]) m.state.extensions.push({ id, name: id, version: "1.0.0", description: "", icon: "", path: `/x/${id}`, size_bytes: 1, added_at: "@0" });
    m.state.profiles["tp-shop-1"]._meta.extensions = ["ext-x", "ext-y"];
    m.save();
    m.emit("store-changed", "profiles");
  });
  await waitForIdle(page);
  const shop = page.locator("[role='row'][data-profile-id='tp-shop-1']");
  await shop.locator("[data-cell='status']").click();
  // Not "2 of N": neither is among the ones the list shows.
  await expect(peek(page).locator("[data-property='extensions']")).toContainText("2 team extensions");
  await page.evaluate(() => {
    const m = (window as unknown as M).__shardxMock;
    m.state.profiles["tp-shop-1"]._meta.extensions = ["ext-a"];
    m.save();
    m.emit("store-changed", "profiles");
  });
  await expect(peek(page).locator("[data-property='extensions']")).toContainText(/1 of \d+/);
});
