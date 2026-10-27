import { expect, test, type Locator, type Page } from "@playwright/test";
import { NOW, appModule, openApp, openEditForm } from "./support/app";

// Web Store updates of extensions added by link (design-final §3.7, §7 v1 6a/6b):
// the card says where its update stands, the menu acts on it, the header
// checks and updates all, Link to Web Store links one by hand, and the sidebar
// counts what can go in now. The mock reaches every state by its knobs
// (src/dev/mock/extUpdates.ts).
type Upd = Record<string, unknown>;
type Mock = { __shardxMock: { state: { extUpdates?: Record<string, Upd>; extensions: { id: string; version: string; source?: unknown }[] }; emit(e: string, p: unknown): void; log: { cmd: string; args: Record<string, unknown> }[]; calls: Record<string, number> } };

const NOW_S = Math.floor(NOW.getTime() / 1000);
const MM = "nkbihfbeogaeaoehlefnkodbefgpgknn";
const COOKIE = "hlkenndednhfkekhgcdicdfddnkalmdm";

const knobs = (page: Page, k: Record<string, unknown>) => page.addInitScript((k) => { Object.assign(window, k); }, k);
const setKnobs = (page: Page, k: Record<string, unknown>) => page.evaluate((k) => { Object.assign(window, k); }, k);
const records = (page: Page, r: Record<string, Upd>) => knobs(page, { __shardxMockExtUpdates: r });
const card = (page: Page, id: string) => page.locator(`[role='listitem'][data-row-id='${id}']`);
const badge = (page: Page, id: string) => card(page, id).locator("[data-update-badge]");
const toast = (page: Page, text: string) => page.locator("[data-toast]").filter({ hasText: text });
const header = (page: Page) => page.locator("main header");
const calls = (page: Page, cmd: string) => page.evaluate((c) => (window as unknown as Mock).__shardxMock.log.filter((l) => l.cmd === c).map((l) => l.args), cmd);
const emit = (page: Page, event: string, payload: unknown) => page.evaluate(([e, p]) => (window as unknown as Mock).__shardxMock.emit(e as string, p), [event, payload] as const);

async function menuOf(page: Page, id: string): Promise<Locator> {
  await card(page, id).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}
const pick = async (page: Page, id: string, item: string) => (await menuOf(page, id)).getByRole("menuitem", { name: item, exact: true }).click();

const AVAILABLE = { state: "available", latest: "1.14.0", size: 700_000, first_seen: NOW_S - 3 * 3600 };

test.describe("a card's update", () => {
  test("available: the card says so, Update puts it in and the version moves", async ({ page }) => {
    await records(page, { "cookie-editor": AVAILABLE });
    await knobs(page, { __shardxMockExtStepMs: 400 });
    await openApp(page, { section: "extensions" });
    await expect(badge(page, "cookie-editor")).toHaveText("1.14.0 available");
    await expect(badge(page, "ublock")).toHaveCount(0);
    await pick(page, "cookie-editor", "Update");
    // The download in words and a percent, while it runs.
    await expect(badge(page, "cookie-editor")).toHaveText(/^Updating, \d+%$/);
    await expect(toast(page, "Updated “Cookie-Editor” to 1.14.0")).toBeVisible();
    await expect(badge(page, "cookie-editor")).toHaveCount(0);
    await expect(card(page, "cookie-editor")).toContainText("v1.14.0");
  });

  test("the menu follows the state, and a linked one opens its Web Store page", async ({ page }) => {
    await page.addInitScript(() => { window.open = () => null; });
    await records(page, { "cookie-editor": { ...AVAILABLE, state: "ready" } });
    await openApp(page, { section: "extensions" });
    const items = async (id: string) => {
      const menu = await menuOf(page, id);
      const names = await menu.getByRole("menuitem").allTextContents();
      await page.keyboard.press("Escape");
      return names.map((s) => s.trim());
    };
    expect(await items("cookie-editor")).toEqual(["Update", "Cancel update", "Skip this version", "Open in Web Store", "Remove extension"]);
    expect(await items("ublock")).toEqual(["Open in Web Store", "Remove extension"]);
    expect(await items("metamask")).toEqual(["Link to Web Store…", "Remove extension"]);
    await pick(page, "ublock", "Open in Web Store");
    expect(await calls(page, "plugin:opener|open_url")).toEqual([{ url: "https://chromewebstore.google.com/detail/ddkjiahejlhfcafbddmgiahcphecmpfh" }]);
  });

  test("Cancel update keeps it offered; Skip this version lets it go", async ({ page }) => {
    await records(page, { "cookie-editor": { ...AVAILABLE, state: "ready" } });
    await openApp(page, { section: "extensions" });
    await pick(page, "cookie-editor", "Cancel update");
    await expect.poll(() => calls(page, "extension_update_cancel")).toEqual([{ id: "cookie-editor" }]);
    await expect(badge(page, "cookie-editor")).toHaveText("1.14.0 available");
    await pick(page, "cookie-editor", "Skip this version");
    await expect.poll(() => calls(page, "extension_update_skip")).toEqual([{ id: "cookie-editor", version: "1.14.0" }]);
    await expect(badge(page, "cookie-editor")).toHaveCount(0);
    const menu = await menuOf(page, "cookie-editor");
    await expect(menu.getByRole("menuitem", { name: "Update", exact: true })).toHaveCount(0);
  });

  test("failed: the card says so with the reason on hover, and Update tries again", async ({ page }) => {
    await records(page, { "cookie-editor": AVAILABLE });
    await knobs(page, { __shardxMockExtFail: { "cookie-editor": "the download does not match the Web Store's hash" } });
    await openApp(page, { section: "extensions" });
    await pick(page, "cookie-editor", "Update");
    const fail = toast(page, "Couldn’t update “Cookie-Editor”");
    await expect(fail).toContainText("The package from the Web Store didn’t pass its check. Try again later.");
    await expect(badge(page, "cookie-editor")).toHaveText("Update failed");
    // The reason as the toast says it: in words, not the backend's.
    await badge(page, "cookie-editor").hover();
    await expect(page.getByRole("tooltip")).toHaveText("The package from the Web Store didn’t pass its check. Try again later.");
    await pick(page, "cookie-editor", "Update");
    await expect(toast(page, "Updated “Cookie-Editor” to 1.14.0")).toBeVisible();
  });

  test("failed: Skip this version hides that version, and its failure with it", async ({ page }) => {
    await records(page, { "cookie-editor": AVAILABLE });
    await knobs(page, { __shardxMockExtFail: { "cookie-editor": "the download does not match the Web Store's hash" } });
    await openApp(page, { section: "extensions" });
    await pick(page, "cookie-editor", "Update");
    await expect(badge(page, "cookie-editor")).toHaveText("Update failed");
    const menu = await menuOf(page, "cookie-editor");
    expect((await menu.getByRole("menuitem").allTextContents()).map((x) => x.trim())).toEqual(["Update", "Skip this version", "Open in Web Store", "Remove extension"]);
    await page.keyboard.press("Escape");
    await pick(page, "cookie-editor", "Skip this version");
    await expect.poll(() => calls(page, "extension_update_skip")).toEqual([{ id: "cookie-editor", version: "1.14.0" }]);
    await expect(badge(page, "cookie-editor")).toHaveCount(0);
    // As updates.rs view: current, the skipped version still named as the latest.
    const [u] = await page.evaluate(() => (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string) => Promise<Upd[]> } }).__TAURI_INTERNALS__.invoke("extension_updates")
      .then((all) => all.filter((x) => x.id === "cookie-editor")));
    expect(u).toMatchObject({ state: "current", latest: "1.14.0", skipped: "1.14.0", error: null });
  });

  test("the Web Store not serving the version it named: a toast, and the badge stays", async ({ page }) => {
    await records(page, { "cookie-editor": AVAILABLE });
    await knobs(page, { __shardxMockExtNotServed: ["cookie-editor"] });
    await openApp(page, { section: "extensions" });
    await pick(page, "cookie-editor", "Update");
    await expect(toast(page, "The Web Store isn’t offering this version right now. Try again later.")).toBeVisible();
    await expect(badge(page, "cookie-editor")).toHaveText("1.14.0 available");
  });

  test("needs a newer browser engine: said on the card and when Update finds it", async ({ page }) => {
    await records(page, { ublock: { state: "needs_engine", latest: "2025.2.1.900", needs_engine: "160.0.8000.0" }, "cookie-editor": AVAILABLE });
    await knobs(page, { __shardxMockExtStore: { [COOKIE]: { version: "1.14.0", minEngine: "161.0.7000.1" } } });
    await openApp(page, { section: "extensions" });
    await expect(badge(page, "ublock")).toHaveText("Needs browser engine 160.0.8000.0 or newer");
    // Cancel would only offer it again, to be downloaded and refused again: Skip instead.
    expect((await (await menuOf(page, "ublock")).getByRole("menuitem").allTextContents()).map((s) => s.trim())).toEqual(["Skip this version", "Open in Web Store", "Remove extension"]);
    await page.keyboard.press("Escape");
    await pick(page, "cookie-editor", "Update");
    await expect(toast(page, "Couldn’t update “Cookie-Editor”")).toContainText("Needs browser engine 161.0.7000.1 or newer");
    await expect(badge(page, "cookie-editor")).toHaveText("Needs browser engine 161.0.7000.1 or newer");
  });

  test("an ID conflict from another computer is said on the card, with nothing to do", async ({ page }) => {
    await records(page, { ublock: { state: "id_conflict", error: "the version from the other computer would change this extension's ID here, so it was not applied" } });
    await openApp(page, { section: "extensions" });
    await expect(badge(page, "ublock")).toHaveText("Another computer’s version would change its ID here, so it wasn’t applied");
    expect((await (await menuOf(page, "ublock")).getByRole("menuitem").allTextContents()).map((s) => s.trim())).toEqual(["Open in Web Store", "Remove extension"]);
  });

  test("a Web Store flag: red at any state, and Update closed with the reason", async ({ page }) => {
    await records(page, {
      "cookie-editor": { ...AVAILABLE, flags: ["malware"] },
      ublock: { state: "current", flags: ["policy_violation"] },
    });
    await openApp(page, { section: "extensions" });
    for (const id of ["cookie-editor", "ublock"]) {
      await expect(card(page, id).locator("[data-flagged]")).toHaveText("The Web Store marks this extension as harmful");
    }
    // Its version is no invitation: only the red mark shows, with what to do on hover.
    await expect(badge(page, "cookie-editor")).toHaveCount(0);
    await card(page, "cookie-editor").locator("[data-flagged]").hover();
    await expect(page.getByRole("tooltip")).toHaveText("It still runs in the profiles that use it. Remove it, or take it out of those profiles.");
    const update = (await menuOf(page, "cookie-editor")).getByRole("menuitem", { name: "Update", exact: true });
    await expect(update).toBeDisabled();
    await expect(update).toHaveAccessibleDescription("The Web Store marks this extension as harmful");
    await page.keyboard.press("Escape");
    // Not counted in the sidebar either.
    await expect(page.locator("aside [data-nav='extensions'] [data-update-count]")).toHaveCount(0);
  });
});

test.describe("waiting for profiles", () => {
  const WAITING = {
    state: "waiting", latest: "2025.2.1.900", ready_since: NOW_S - 600,
    waiting_on: [{ id: "a78a0eea", name: "Amazon US seller" }, { id: "9828bf28", name: "eBay DE buyer" }],
  };

  test("Waiting for 2 profiles to close: who and since when on hover", async ({ page }) => {
    await records(page, { ublock: WAITING });
    await openApp(page, { section: "extensions" });
    await expect(badge(page, "ublock")).toHaveText("Waiting for 2 profiles to close");
    await badge(page, "ublock").hover();
    await expect(page.getByRole("tooltip")).toHaveText(/^Used by Amazon US seller and eBay DE buyer\. Ready since .+\.$/);
  });

  test("Stop 2 profiles and update asks with their names, then it goes in as they close", async ({ page }) => {
    await records(page, { ublock: WAITING });
    await openApp(page, { section: "extensions" });
    await pick(page, "ublock", "Stop 2 profiles and update…");
    const ask = page.getByRole("dialog", { name: "Stop profiles to update “uBlock Origin Lite”?" });
    await expect(ask.locator("[data-confirm-items] li")).toHaveText(["Amazon US seller", "eBay DE buyer"]);
    await ask.getByRole("button", { name: "Stop and update" }).click();
    await expect.poll(async () => (await calls(page, "process_kill")).map((a) => a.profileId).sort()).toEqual(["9828bf28", "a78a0eea"]);
    await expect(badge(page, "ublock")).toHaveCount(0);
    await expect(card(page, "ublock")).toContainText("v2025.2.1.900");
  });

  test("an Update that finds the extension in use waits, and says so", async ({ page }) => {
    // Amazon US seller runs with uBlock Origin Lite (the mock's seed).
    await records(page, { ublock: { ...AVAILABLE, latest: "2025.2.1.900" } });
    await openApp(page, { section: "extensions" });
    await pick(page, "ublock", "Update");
    await expect(toast(page, "“uBlock Origin Lite” updates when the profiles using it close")).toBeVisible();
    await expect(badge(page, "ublock")).toHaveText("Waiting for 1 profile to close");
  });

  test("the launcher itself busy: no profiles to stop, only Cancel", async ({ page }) => {
    await records(page, { ublock: { ...WAITING, waiting_on: [] } });
    await openApp(page, { section: "extensions" });
    await expect(badge(page, "ublock")).toHaveText("Will update when Octopus Agent is free");
    expect((await (await menuOf(page, "ublock")).getByRole("menuitem").allTextContents()).map((s) => s.trim())).toEqual(["Cancel update", "Open in Web Store", "Remove extension"]);
  });
});

test.describe("asking first", () => {
  test("grown access: the dialog lists it with the size and age, and Update lets exactly that in", async ({ page }) => {
    await records(page, { "cookie-editor": AVAILABLE });
    await knobs(page, {
      __shardxMockExtStore: {
        [COOKIE]: {
          version: "1.14.0", size: 700_000,
          grown: [
            { kind: "host", value: "<all_urls>" },
            { kind: "connectable", value: "extension:*" },
            { kind: "override", value: "chrome_settings_overrides.search_provider" },
            { kind: "web_resource", value: "https://x.com/*" },
            { kind: "permission", value: "debugger" },
          ],
        },
      },
    });
    await openApp(page, { section: "extensions" });
    await pick(page, "cookie-editor", "Update");
    const dialog = page.getByRole("dialog", { name: "Update “Cookie-Editor” to 1.14.0?" });
    await expect(dialog).toContainText("The new version asks for more access:");
    await expect(dialog.locator("[data-grants] li")).toHaveText([
      "Access to all sites",
      "Can receive messages from any extension",
      "Changes your default search engine",
      "Its files can be loaded by https://x.com/*",
      "Full control of pages through the debugger",
    ]);
    await expect(dialog).toContainText("Download size: 684 KB. Appeared 3 hours ago.");
    // Asked once: the menu says so too.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(badge(page, "cookie-editor")).toHaveText("1.14.0 waits for your OK");
    await pick(page, "cookie-editor", "Update…");
    await page.getByRole("dialog", { name: "Update “Cookie-Editor” to 1.14.0?" }).getByRole("button", { name: "Update", exact: true }).click();
    await expect(toast(page, "Updated “Cookie-Editor” to 1.14.0")).toBeVisible();
    expect((await calls(page, "extension_update")).map((a) => a.confirmed)).toEqual([false, true]);
  });

  test("a weak link: both names and how many files match", async ({ page }) => {
    await records(page, {
      "cookie-editor": {
        ...AVAILABLE, state: "confirm",
        confirm: { reason: "identity", grown: [], names: { old: "Cookie-Editor", new: "Cookie Editor Plus" }, overlap: 0.34 },
      },
    });
    await openApp(page, { section: "extensions" });
    await pick(page, "cookie-editor", "Update…");
    // It may be another extension: Update is the risky choice, and the dialog an alert.
    const dialog = page.getByRole("alertdialog", { name: "Update “Cookie-Editor” to 1.14.0?" });
    await expect(dialog.locator("[data-update-confirm='identity']")).toContainText(
      "The installed one is called “Cookie-Editor”, the new version “Cookie Editor Plus”. Only 34% of its files match the installed copy. It may be a different extension now.",
    );
  });
});

test.describe("the header and the sidebar", () => {
  test("Check for updates: Checking…, then up to date, or what it found", async ({ page }) => {
    await knobs(page, { __shardxMockExtStepMs: 400 });
    await openApp(page, { section: "extensions" });
    const check = header(page).getByRole("button", { name: /^(Check for updates|Checking…)$/ });
    await check.click();
    await expect(check).toHaveText("Checking…");
    await expect(toast(page, "All extensions are up to date")).toBeVisible();
    await expect(check).toHaveText("Check for updates");
    await setKnobs(page, { __shardxMockExtStore: { [COOKIE]: { version: "1.14.0" } } });
    await check.click();
    await expect(toast(page, "1 extension can be updated")).toBeVisible();
    await expect(badge(page, "cookie-editor")).toHaveText("1.14.0 available");
  });

  test("Check for updates offline says it could not, and why", async ({ page }) => {
    await knobs(page, { __shardxMockExtCheck: "offline" });
    await openApp(page, { section: "extensions" });
    await header(page).getByRole("button", { name: "Check for updates" }).click();
    const fail = toast(page, "Couldn’t check for extension updates");
    await expect(fail).toContainText("Couldn’t reach the Web Store. Check your connection and try again.");
  });

  test("no linked extension: no Check for updates (nothing to ask about)", async ({ page }) => {
    await openApp(page, { section: "extensions" });
    await page.evaluate(() => {
      const m = (window as unknown as Mock).__shardxMock;
      for (const e of m.state.extensions) delete e.source;
      m.state.extUpdates = {};
      m.emit("store-changed", "extensions");
    });
    await expect(header(page).getByRole("button", { name: "Check for updates" })).toHaveCount(0);
  });

  test("Update all: from two that can go in, one at a time, one toast at the end", async ({ page }) => {
    await records(page, { "cookie-editor": AVAILABLE });
    await openApp(page, { section: "extensions" });
    await expect(header(page).getByRole("button", { name: "Update all" })).toHaveCount(0);
    // A second one: uBlock Origin Lite, in use by a running profile.
    await page.evaluate((now) => {
      const m = (window as unknown as Mock).__shardxMock;
      Object.assign(m.state.extUpdates!.ublock, { state: "available", latest: "2025.2.1.900", first_seen: now });
      m.emit("store-changed", "extension-updates");
    }, NOW_S);
    await expect(page.locator("aside [data-nav='extensions'] [data-update-count]")).toHaveText("2");
    await header(page).getByRole("button", { name: "Update all" }).click();
    const done = toast(page, "Updated 1 extension");
    await expect(done).toContainText("Ready, updates when their profiles close: uBlock Origin Lite");
    await expect(page.locator("[data-toast]")).toHaveCount(1);
    await expect(card(page, "cookie-editor")).toContainText("v1.14.0");
    await expect(badge(page, "ublock")).toHaveText("Waiting for 1 profile to close");
  });

  test("Update all names what asks first instead of asking", async ({ page }) => {
    await records(page, { "cookie-editor": AVAILABLE, ublock: { ...AVAILABLE, latest: "2025.2.1.900" } });
    await knobs(page, { __shardxMockExtStore: { [COOKIE]: { version: "1.14.0", grown: [{ kind: "permission", value: "tabs" }] } } });
    await openApp(page, { section: "extensions" });
    await header(page).getByRole("button", { name: "Update all" }).click();
    await expect(toast(page, "No extensions were updated")).toContainText("Not updated, needs your confirmation: Cookie-Editor");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Nothing went in: no success mark.
    await appModule(page, "/src/shared/model/toast.ts", "__toast");
    expect(await page.evaluate(() => (window as unknown as { __toast: { useToastStore: { getState(): { items: { title: string; kind: string }[] } } } }).__toast.useToastStore.getState().items.find((i) => i.title === "No extensions were updated")?.kind)).toBe("info");
    // The card and the sidebar say which one waits for the person.
    await expect(badge(page, "cookie-editor")).toHaveText("1.14.0 waits for your OK");
    await expect(page.locator("aside [data-nav='extensions'] [data-update-count]")).toHaveText("1");
  });

  test("the sidebar counts what can be updated now, and says it in words", async ({ page }) => {
    await records(page, {
      "cookie-editor": AVAILABLE,
      ublock: { state: "waiting", latest: "2025.2.1.900", waiting_on: [{ id: "a78a0eea", name: "Amazon US seller" }] },
    });
    await openApp(page);
    const item = page.locator("aside [data-nav='extensions']");
    await expect(item.locator("[data-update-count]")).toHaveText("1");
    await expect(item).toHaveAccessibleName("Extensions 1 update available");
  });
});

test.describe("news from the background check", () => {
  test("new versions: one toast, and Open goes to the page", async ({ page }) => {
    await openApp(page);
    await emit(page, "extension-updates:news", { fresh: [{ id: "cookie-editor", name: "Cookie-Editor", version: "1.14.0" }, { id: "ublock", name: "uBlock Origin Lite", version: "2025.2.1.900" }], flagged: [] });
    const news = toast(page, "2 extensions can be updated");
    await expect(news).toBeVisible();
    await news.getByRole("button", { name: "Open" }).click();
    await expect(page.locator("main[data-section='extensions']")).toBeVisible();
  });

  test("a new Web Store flag: a toast of its own", async ({ page }) => {
    await openApp(page);
    await emit(page, "extension-updates:news", { fresh: [], flagged: [{ id: "cookie-editor", name: "Cookie-Editor", flags: ["malware"] }] });
    const flagged = toast(page, "The Web Store now marks “Cookie-Editor” as harmful");
    await expect(flagged).toContainText("It still runs in the profiles that use it. Remove it, or take it out of those profiles.");
    await expect(page.locator("[data-toast]")).toHaveCount(1);
    await flagged.getByRole("button", { name: "Open" }).click();
    await expect(page.locator("main[data-section='extensions']")).toBeVisible();
  });
});

test.describe("Link to Web Store", () => {
  test("the files match: it asks once with what it found, links, and the update shows", async ({ page }) => {
    await openApp(page, { section: "extensions" });
    await pick(page, "metamask", "Link to Web Store…");
    const dialog = page.getByRole("dialog", { name: "Link to Web Store" });
    const field = dialog.getByRole("textbox", { name: "Web Store page or extension ID" });
    await field.fill("https://chromewebstore.google.com.evil.com/detail/" + MM);
    await expect(dialog).toContainText("Paste a Web Store page or an extension ID.");
    await expect(dialog.getByRole("button", { name: "Link" })).toBeDisabled();
    await field.fill(`https://chromewebstore.google.com/detail/metamask/${MM}`);
    await dialog.getByRole("button", { name: "Link" }).click();
    const sure = page.getByRole("dialog", { name: "Link “MetaMask” to the Web Store?" });
    await expect(sure.locator("[data-link-confirm='same']")).toContainText("Installed: “MetaMask” 12.9.3");
    await expect(sure).toContainText("In the Web Store: “MetaMask” 13.53.0");
    await expect(sure).toContainText("96% of its files match the version in the Web Store.");
    await sure.getByRole("button", { name: "Link" }).click();
    await expect(toast(page, "Linked “MetaMask” to the Web Store")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(badge(page, "metamask")).toHaveText("13.53.0 available");
    expect((await calls(page, "extension_link_source")).map((a) => a.confirmed)).toEqual([false, true]);
    const menu = await menuOf(page, "metamask");
    await expect(menu.getByRole("menuitem", { name: "Open in Web Store" })).toBeVisible();
  });

  test("the files are unsure, the publisher unvouched, the item flagged: all said before linking", async ({ page }) => {
    await knobs(page, { __shardxMockExtLink: { [MM]: { kin: "unsure", overlap: 0.12, allowlisted: false, flags: ["malware"], name: "MetaMask Flask" } } });
    await openApp(page, { section: "extensions" });
    await pick(page, "metamask", "Link to Web Store…");
    await page.getByRole("dialog").getByRole("textbox").fill(MM);
    await page.getByRole("dialog").getByRole("button", { name: "Link" }).click();
    // Weak files and a harmful mark: Link is the risky choice, and the dialog an alert.
    const sure = page.getByRole("alertdialog", { name: "Link “MetaMask” to the Web Store?" });
    await expect(sure).toContainText("In the Web Store: “MetaMask Flask” 13.53.0");
    await expect(sure.locator("[data-link-confirm='unsure']")).toContainText(
      "Only 12% of its files match the installed copy. It may be a different extension now. The Web Store doesn’t vouch for this extension’s publisher.",
    );
    await expect(sure.locator("[data-flagged]")).toHaveText("The Web Store marks this extension as harmful");
  });

  test("a different extension by its files: refused, in words", async ({ page }) => {
    await knobs(page, { __shardxMockExtLink: { [MM]: { kin: "other", overlap: 0 } } });
    await openApp(page, { section: "extensions" });
    await pick(page, "metamask", "Link to Web Store…");
    await page.getByRole("dialog").getByRole("textbox").fill(MM);
    await page.getByRole("dialog").getByRole("button", { name: "Link" }).click();
    await expect(toast(page, "Couldn’t link “MetaMask” to the Web Store")).toContainText("By its files, that’s a different extension.");
    // The dialog stays for another link.
    await expect(page.getByRole("dialog", { name: "Link to Web Store" })).toBeVisible();
  });
});

test.describe("already in the library", () => {
  const addByLink = async (page: Page, link: string) => {
    await header(page).getByRole("button", { name: "Add extension" }).click();
    await page.getByRole("menuitem", { name: "From a link" }).click();
    const dialog = page.getByRole("dialog", { name: "Add from a link" });
    await dialog.getByRole("textbox").fill(link);
    await dialog.getByRole("button", { name: "Download" }).click();
  };

  test("the same Web Store item again, up to date: a separate copy that groups with it, or Cancel", async ({ page }) => {
    await openApp(page, { section: "extensions" });
    await addByLink(page, "ddkjiahejlhfcafbddmgiahcphecmpfh");
    const ask = page.getByRole("dialog", { name: "“uBlock Origin Lite” is already in the library" });
    await expect(ask).toContainText("Version 2025.1.14.1103 is installed and up to date. A separate copy gets its own empty storage.");
    await expect(ask.getByRole("button", { name: "Update it" })).toHaveCount(0);
    await expect(ask.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Add from a link" })).toHaveCount(0);
    await ask.getByRole("button", { name: "Add a separate copy" }).click();
    await expect(toast(page, "Added “uBlock Origin Lite”")).toBeVisible();
    await expect(page.getByText("Installed twice", { exact: true })).toHaveCount(2);
    expect((await calls(page, "extension_import_url")).map((a) => a.separate)).toEqual([false, true]);
  });

  test("with a newer version: Update it updates the one there", async ({ page }) => {
    await records(page, { ublock: { ...AVAILABLE, latest: "2025.2.1.900" } });
    await openApp(page, { section: "extensions" });
    await addByLink(page, "ddkjiahejlhfcafbddmgiahcphecmpfh");
    const ask = page.getByRole("dialog", { name: "“uBlock Origin Lite” is already in the library" });
    await expect(ask).toContainText("Version 2025.1.14.1103 is installed. Update it rather than add it again.");
    await ask.getByRole("button", { name: "Update it" }).click();
    // Amazon US seller runs with it (the mock's seed).
    await expect(toast(page, "“uBlock Origin Lite” updates when the profiles using it close")).toBeVisible();
    expect(await calls(page, "extension_update")).toEqual([{ id: "ublock", confirmed: false, epoch: expect.anything() }]);
  });

  test("no id of its own for a copy: only Update it", async ({ page }) => {
    await records(page, { ublock: { ...AVAILABLE, latest: "2025.2.1.900" } });
    await knobs(page, { __shardxMockExtSeparate: false });
    await openApp(page, { section: "extensions" });
    await addByLink(page, "ddkjiahejlhfcafbddmgiahcphecmpfh");
    const ask = page.getByRole("dialog", { name: "“uBlock Origin Lite” is already in the library" });
    await expect(ask.getByRole("button", { name: "Update it" })).toBeVisible();
    await expect(ask.getByRole("button", { name: "Add a separate copy" })).toHaveCount(0);
    await expect(ask).not.toContainText("separate copy");
  });

  test("ru: the question's three buttons fit its dialog", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("shardx.lang", "ru"));
    await records(page, { ublock: { ...AVAILABLE, latest: "2025.2.1.900" } });
    await openApp(page, { section: "extensions" });
    await header(page).getByRole("button", { name: "Добавить расширение" }).click();
    await page.getByRole("menuitem", { name: "По ссылке" }).click();
    const add = page.getByRole("dialog");
    await add.getByRole("textbox").fill("ddkjiahejlhfcafbddmgiahcphecmpfh");
    await add.getByRole("button", { name: "Скачать" }).click();
    const ask = page.getByRole("dialog", { name: "«uBlock Origin Lite» уже есть в библиотеке" });
    await expect(ask.getByRole("button", { name: "Добавить копию" })).toBeVisible();
    const box = (await ask.boundingBox())!;
    for (const b of await ask.getByRole("button").all()) {
      const r = (await b.boundingBox())!;
      expect(r.x, await b.textContent() ?? "").toBeGreaterThanOrEqual(box.x);
      expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width);
    }
  });

  test("a .crx file of one already there asks the same", async ({ page }) => {
    await knobs(page, { __shardxMockExtImportSame: "cookie-editor" });
    await openApp(page, { section: "extensions" });
    await header(page).getByRole("button", { name: "Add extension" }).click();
    await page.getByRole("menuitem", { name: ".crx or .zip file" }).click();
    const ask = page.getByRole("dialog", { name: "“Cookie-Editor” is already in the library" });
    await ask.getByRole("button", { name: "Add a separate copy" }).click();
    await expect(toast(page, "Added 1 extension")).toBeVisible();
    expect((await calls(page, "extension_import")).map((a) => a.separate)).toEqual([false, true]);
  });

  test("several files: each one refused is named with why, and the rest go in", async ({ page }) => {
    await knobs(page, { __shardxMockOpenFiles: ["/Users/you/Downloads/wallet.crx", "/Users/you/Downloads/broken.zip", "/Users/you/Downloads/notes.zip"] });
    await openApp(page, { section: "extensions" });
    await header(page).getByRole("button", { name: "Add extension" }).click();
    await page.getByRole("menuitem", { name: ".crx or .zip file" }).click();
    const some = toast(page, "Added 2 of 3 extensions");
    await expect(some).toContainText("broken.zip: It isn’t a .zip or .crx extension file, or the file is damaged.");
    await expect(page.locator("main")).toContainText("wallet");
    await expect(page.locator("main")).toContainText("notes");
  });

  test("several files all refused: each is named, the one already there too", async ({ page }) => {
    await knobs(page, { __shardxMockOpenFiles: ["/Users/you/Downloads/cookies.crx", "/Users/you/Downloads/broken.zip"], __shardxMockExtImportSame: "cookie-editor" });
    await openApp(page, { section: "extensions" });
    await header(page).getByRole("button", { name: "Add extension" }).click();
    await page.getByRole("menuitem", { name: ".crx or .zip file" }).click();
    const none = toast(page, "Couldn’t add the extension files");
    await expect(none).toContainText("cookies.crx: It’s already in the library.");
    await expect(none).toContainText("broken.zip: It isn’t a .zip or .crx extension file, or the file is damaged.");
    // Several files are listed, not asked about one by one.
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("elsewhere", () => {
  test("Settings: the check can be turned off, and its help says where the request goes from", async ({ page }) => {
    await openApp(page, { section: "settings" });
    const row = page.locator("[data-setting='ext-update-check']");
    await expect(row).toContainText("Check the Web Store for extension updates");
    await expect(row.locator("[data-setting-help]")).toHaveText("Every 5 hours, from this computer’s IP, not through profile proxies.");
    const sw = row.getByRole("switch");
    await expect(sw).toBeChecked();
    await sw.click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shardxMockSettingsSaves?: { ext_update_check?: boolean }[] }).__shardxMockSettingsSaves?.at(-1)?.ext_update_check)).toBe(false);
  });

  test("the profile form's extensions list the whole library, none picked per profile", async ({ page }) => {
    await openApp(page);
    const form = await openEditForm(page, "Sandbox", "Extensions");
    const tab = form.locator("[data-extensions-global]");
    await expect(tab).toContainText("Every Chrome extension in the library loads into this profile");
    await expect(tab.getByRole("listitem").filter({ hasText: "Cookie-Editor" })).toHaveCount(1);
    await expect(tab.getByRole("listitem").filter({ hasText: "uBlock Origin Lite" })).toHaveCount(1);
    await expect(form.getByRole("combobox", { name: "Extensions" })).toHaveCount(0);
  });

  test("a synced extension kept here: the warning in the person's language", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("shardx.lang", "ru"));
    await openApp(page);
    await emit(page, "launcher-warning", "“MetaMask” is newer on this computer (13.53.0) than on another one (13.46.1), so the version on this computer is kept.");
    await expect(toast(page, "«MetaMask» на этом компьютере новее (13.53.0), чем на другом (13.46.1), поэтому оставлена версия этого компьютера.")).toBeVisible();
  });

  test("a start refused while its extension is swapped is said in words", async ({ page }) => {
    await openApp(page);
    await appModule(page, "/src/shared/lib/errors.ts", "__e");
    const said = await page.evaluate(() => (window as unknown as { __e: { explainError(e: unknown): string } }).__e.explainError("An extension of this profile is being updated. Try again in a minute."));
    expect(said).toBe("An extension of this profile is being updated. Try again in a minute.");
    const store = await page.evaluate(() => (window as unknown as { __e: { explainError(e: unknown): string } }).__e.explainError("the Web Store has no extension with that id"));
    expect(store).toBe("The Web Store has no extension with that ID.");
  });
});

test.describe("states that say what to do", () => {
  const items = async (page: Page, id: string) => {
    const names = await (await menuOf(page, id)).getByRole("menuitem").allTextContents();
    await page.keyboard.press("Escape");
    return names.map((s) => s.trim());
  };

  test("asking first: its own words on the card, and counted in the sidebar", async ({ page }) => {
    await records(page, {
      "cookie-editor": { ...AVAILABLE, state: "confirm", confirm: { reason: "permissions", grown: [{ kind: "permission", value: "tabs" }] } },
    });
    await openApp(page, { section: "extensions" });
    await expect(badge(page, "cookie-editor")).toHaveText("1.14.0 waits for your OK");
    await expect(page.locator("aside [data-nav='extensions'] [data-update-count]")).toHaveText("1");
  });

  test("taken down from the Web Store: said so, and no Update that would only fail", async ({ page }) => {
    await records(page, { "cookie-editor": { state: "failed", error: "the Web Store does not know this extension (noupdate)" } });
    await openApp(page, { section: "extensions" });
    await expect(badge(page, "cookie-editor")).toHaveText("No longer in the Web Store");
    await badge(page, "cookie-editor").hover();
    await expect(page.getByRole("tooltip")).toHaveText("The Web Store took it down, so it gets no more updates. It keeps working in profiles.");
    expect(await items(page, "cookie-editor")).toEqual(["Open in Web Store", "Remove extension"]);
  });

  test("ru: a failed update's reason on hover is in Russian", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("shardx.lang", "ru"));
    await records(page, { "cookie-editor": { ...AVAILABLE, state: "failed", error: "Not enough free disk space for the update: it needs about 40 MB, and 12 MB is free. Free up space and try again." } });
    await openApp(page, { section: "extensions" });
    await badge(page, "cookie-editor").hover();
    await expect(page.getByRole("tooltip")).toHaveText("Недостаточно места на диске: нужно около 40 MB, свободно 12 MB.");
  });

  test("needs a newer engine: Update comes back once the engine here is new enough, with its version on hover", async ({ page }) => {
    await records(page, { ublock: { state: "needs_engine", latest: "2025.2.1.900", needs_engine: "150.0.0.0" } });
    await openApp(page, { section: "extensions" });
    expect(await items(page, "ublock")).toEqual(["Skip this version", "Open in Web Store", "Remove extension"]);
    // The engine's version is known once the GPU check ran (152.0.7977.65 in the mock).
    await appModule(page, "/src/shared/model/gpuCompat.ts", "__gpu");
    type Gpu = { __gpu: { useGpuCompat: { getState(): { load(): Promise<void>; caps: { engine_version: string } | null } } } };
    await page.evaluate(() => (window as unknown as Gpu).__gpu.useGpuCompat.getState().load());
    await expect.poll(() => page.evaluate(() => (window as unknown as Gpu).__gpu.useGpuCompat.getState().caps?.engine_version)).toBe("152.0.7977.65");
    await page.mouse.move(0, 0);
    await badge(page, "ublock").hover();
    await expect(page.getByRole("tooltip")).toHaveText("This computer has browser engine 152.0.7977.65.");
    expect(await items(page, "ublock")).toEqual(["Update", "Skip this version", "Open in Web Store", "Remove extension"]);
  });

  test("an ID conflict from the Web Store says so, not another computer", async ({ page }) => {
    await records(page, { ublock: { state: "id_conflict", error: "its key gives it the ID abc, not the Web Store item ddkjiahejlhfcafbddmgiahcphecmpfh" } });
    await openApp(page, { section: "extensions" });
    await expect(badge(page, "ublock")).toHaveText("The version from the Web Store would change its ID here, so it wasn’t applied");
  });

  test("waiting on Octopus Agent itself: what it is busy with, on hover", async ({ page }) => {
    await records(page, { ublock: { state: "waiting", latest: "2025.2.1.900", waiting_on: [], ready_since: NOW_S - 600 } });
    await openApp(page, { section: "extensions" });
    await badge(page, "ublock").hover();
    await expect(page.getByRole("tooltip")).toHaveText(/^Octopus Agent is moving its data, switching spaces or updating the browser engine\. It goes in once that ends\. Ready since .+\.$/);
  });

  test("a profile that closes shortens the wait on the card", async ({ page }) => {
    await records(page, {
      ublock: { state: "waiting", latest: "2025.2.1.900", ready_since: NOW_S - 600, waiting_on: [{ id: "a78a0eea", name: "Amazon US seller" }, { id: "9828bf28", name: "eBay DE buyer" }] },
    });
    await openApp(page, { section: "extensions" });
    await expect(badge(page, "ublock")).toHaveText("Waiting for 2 profiles to close");
    await appModule(page, "/src/entities/profile/index.ts", "__p");
    await page.evaluate(() => (window as unknown as { __p: { useProfile: { getState(): { stopMany(ids: string[]): Promise<unknown> } } } }).__p.useProfile.getState().stopMany(["9828bf28"]));
    await expect(badge(page, "ublock")).toHaveText("Waiting for 1 profile to close");
  });

  test("Skip this version says what it did", async ({ page }) => {
    await records(page, { "cookie-editor": AVAILABLE });
    await openApp(page, { section: "extensions" });
    await pick(page, "cookie-editor", "Skip this version");
    await expect(toast(page, "Skipped 1.14.0 of “Cookie-Editor”. A newer version will be offered when it appears.")).toBeVisible();
  });

  test("while it downloads: Remove waits, and Update all stays in the header", async ({ page }) => {
    await records(page, { "cookie-editor": AVAILABLE, metamask: { ...AVAILABLE, latest: "13.53.0" } });
    await page.evaluate(() => 0);
    await knobs(page, { __shardxMockExtStepMs: 500 });
    await openApp(page, { section: "extensions" });
    await page.evaluate(() => {
      const m = (window as unknown as Mock).__shardxMock;
      m.state.extensions.find((e) => e.id === "metamask")!.source = { kind: "webstore", id: "nkbihfbeogaeaoehlefnkodbefgpgknn" };
    });
    const all = header(page).getByRole("button", { name: "Update all" });
    await all.click();
    await expect(badge(page, "cookie-editor")).toHaveText(/^Updating, \d+%$/);
    await expect(all).toBeVisible();
    const remove = (await menuOf(page, "cookie-editor")).getByRole("menuitem", { name: "Remove extension" });
    await expect(remove).toBeDisabled();
    await expect(remove).toHaveAccessibleDescription("It’s being updated. Remove it once that ends.");
    await page.keyboard.press("Escape");
  });

  test("Link to Web Store: the card says it links, not that it updates, and offers no Cancel", async ({ page }) => {
    await knobs(page, { __shardxMockExtStepMs: 700 });
    await openApp(page, { section: "extensions" });
    await pick(page, "metamask", "Link to Web Store…");
    await page.getByRole("dialog").getByRole("textbox").fill(MM);
    await page.getByRole("dialog").getByRole("button", { name: "Link" }).click();
    const status = card(page, "metamask").locator("[data-update-badge]");
    await expect(status).toHaveText("Linking to the Web Store…");
    // A read meanwhile (the backend sees it downloading) changes nothing.
    await emit(page, "store-changed", "extension-updates");
    await expect(status).toHaveText("Linking to the Web Store…");
    await page.getByRole("dialog").press("Escape").catch(() => {});
    expect(await items(page, "metamask")).toEqual(["Remove extension"]);
  });

  test("the backend's update refusals read in words", async ({ page }) => {
    await openApp(page);
    await appModule(page, "/src/shared/lib/errors.ts", "__e");
    const said = (m: string) => page.evaluate((m) => (window as unknown as { __e: { explainError(e: unknown): string } }).__e.explainError(m), m);
    expect(await said("the extension is being updated right now; try again in a minute")).toBe("The extension is being updated right now. Try again in a minute.");
    expect(await said("the extension is being updated; try again in a minute")).toBe("The extension is being updated right now. Try again in a minute.");
    expect(await said("the extension is not linked to the Web Store yet: link it first")).toBe("This extension isn’t linked to the Web Store yet. Link it first.");
    expect(await said("it is linked to the Web Store item ddkjiahejlhfcafbddmgiahcphecmpfh already")).toBe("It’s already linked to another Web Store item.");
    expect(await said("the Web Store did not answer about this extension")).toBe("Couldn’t reach the Web Store. Check your connection and try again.");
    expect(await said("the update was cancelled")).toBe("The update was canceled.");
    expect(await said("the extension's folder is in use (os error 32); the update is kept and goes in on the next try")).toBe("The extension’s folder is in use. The update is kept and goes in on the next try.");
    expect(await said("the update could not be unpacked: invalid zip")).toBe("The update couldn’t be unpacked. An antivirus may be in the way.");
    expect(await said("not offered for a team's extensions yet")).toBe("A team’s extensions don’t get updates here yet.");
  });

  test("the rail keeps the count: on the icon, and in the item's name", async ({ page }) => {
    await records(page, { "cookie-editor": AVAILABLE });
    await openApp(page);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    const item = page.locator("aside [data-nav='extensions']");
    await expect(item.locator("[data-update-count]")).toHaveText("1");
    await expect(item).toHaveAccessibleName("Extensions, 1 update available");
  });

  test("forced colors: each badge and the engine banner keep an edge", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await records(page, { "cookie-editor": { ...AVAILABLE, flags: ["malware"] }, ublock: { ...AVAILABLE, latest: "2025.2.1.900" } });
    await openApp(page, { section: "extensions" });
    const edge = (l: Locator) => l.evaluate((el) => getComputedStyle(el).borderTopStyle);
    expect(await edge(card(page, "cookie-editor").locator("[data-flagged]"))).toBe("solid");
    expect(await edge(badge(page, "ublock"))).toBe("solid");
    await emit(page, "runtime:failed", { stage: "swap", message: "x", running_browsers: 0, starting: 0, engine_kept: true, target: null, at_ms: 0, update_staged: true });
    expect(await edge(page.locator("[data-engine-update]"))).toBe("solid");
  });

  test("zh: access to every site reads without a stray space", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
    await records(page, { "cookie-editor": { ...AVAILABLE, state: "confirm", confirm: { reason: "permissions", grown: [{ kind: "host", value: "<all_urls>" }, { kind: "permission", value: "cookies" }] } } });
    await openApp(page, { section: "extensions" });
    await card(page, "cookie-editor").click({ button: "right" });
    await page.getByRole("menuitem").first().click();
    await expect(page.getByRole("dialog").locator("[data-grants] li")).toHaveText(["访问所有网站", "读取和更改 Cookie"]);
  });
});

// Every status in Russian and Chinese fits a card at its narrowest (minCardWidth 280).
for (const lang of ["ru", "zh"] as const) {
  test(`${lang}: each update status stays inside a 280 px card`, async ({ page }) => {
    // Three cards a row at 284 px: as narrow as the grid lets one be.
    await page.setViewportSize({ width: 1160, height: 800 });
    await page.addInitScript((l) => localStorage.setItem("shardx.lang", l), lang);
    await records(page, {
      ublock: { state: "waiting", latest: "2025.2.1.900", waiting_on: [], flags: ["malware"] },
      "cookie-editor": { state: "id_conflict", flags: ["potentially_uws"] },
      metamask: { state: "needs_engine", latest: "13.53.0", needs_engine: "160.0.8000.0" },
    });
    await openApp(page, { section: "extensions" });
    for (const [id, over] of [
      ["dup-1", { state: "waiting", latest: "2.0.0", waiting_on: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }, { id: "e", name: "E" }] }],
      ["dup-2", { state: "downloading", latest: "2.0.0", progress: { phase: "download", received: 5, total: 10 } }],
      ["dup-3", { state: "failed", latest: "2.0.0", error: "x" }],
      ["dup-4", { state: "available", latest: "2025.12.31.1103" }],
    ] as const) {
      await page.evaluate(([id, over]) => {
        const m = (window as unknown as Mock).__shardxMock;
        m.state.extensions.push({ id, name: `Long extension name ${id}`, version: "1.0.0", description: "", icon: "", path: `/x/${id}`, size_bytes: 1, added_at: "@1", source: { kind: "webstore", id: String.fromCharCode(98 + Number(id.slice(-1))).repeat(32) } } as never);
        (m.state.extUpdates ??= {})[id] = { id, installed: "1.0.0", latest: null, size: null, first_seen: null, ready_since: null, waiting_on: [], progress: null, error: null, checked_at: null, flags: [], allowlisted: null, skipped: null, needs_engine: null, ...over };
        m.emit("store-changed", "extensions");
      }, [id, over] as const);
    }
    await expect(card(page, "dup-4").locator("[data-update-badge]")).toBeVisible();
    for (const id of ["ublock", "cookie-editor", "metamask", "dup-1", "dup-2", "dup-3", "dup-4"]) {
      const tile = card(page, id);
      const box = (await tile.boundingBox())!;
      // The test is about the narrowest card: the window makes every card so.
      expect(box.width, id).toBeLessThan(300);
      expect(box.width, id).toBeGreaterThanOrEqual(279.5);
      const badges = tile.locator("[data-update-badge], [data-flagged]");
      await expect(badges.first(), id).toBeVisible();
      for (const b of await badges.all()) {
        const r = (await b.boundingBox())!;
        expect(r.x + r.width, `${id}: a badge ends inside its card`).toBeLessThanOrEqual(box.x + box.width + 0.5);
      }
      expect(await tile.locator("article").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), id).toBe(true);
      // The description stays two lines: a taller card beside it does not stretch it past its clamp.
      expect(await tile.locator("article p").evaluate((el) => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) * 2 + 1), id).toBe(true);
      for (const b of await tile.locator("[data-update-badge], [data-flagged]").all()) {
        expect(await b.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${id}: its text is not cut`).toBe(true);
      }
    }
  });
}
