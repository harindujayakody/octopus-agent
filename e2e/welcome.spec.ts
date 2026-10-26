import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp, reloadApp, seed } from "./support/app";

// Onboarding Task 4: the welcome. Three screens on a first install, once the
// engine gate is behind it and the profile list has loaded. Skip on every
// screen, Start tour on the last. `openApp(page, { onboarding: "fresh" })` is
// a first install; every other test starts with the welcome answered.

const KEY = "shardx.onboarding";
const welcome = (page: Page) => page.getByRole("dialog", { name: "Welcome to Octopus Agent" });
const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), KEY);
const tourCard = (page: Page) => page.locator("[data-tour-card]");
const empty = (page: Page) => page.addInitScript(() => { (window as unknown as { __shardxMockEmpty: boolean }).__shardxMockEmpty = true; });
/** The replay hint, in the toast region: where the tour is kept once the welcome is put away. */
const replayHint = (page: Page) => page.getByRole("region", { name: "Notifications" }).getByText("You can replay the tour from Settings");

test("a fresh install shows the welcome after the engine gate", async ({ page }) => {
  // The engine screen holds the app for a few seconds: the welcome is not on it.
  await page.addInitScript(() => Object.assign(window, { __shardxMockEngine: "update", __shardxMockEngineStepMs: 1500 }));
  await openApp(page, { onboarding: "fresh", idle: false });
  await expect(page.getByRole("heading", { name: "Updating the browser engine" })).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
  await expect(page.locator("main[data-section='profiles']")).toBeVisible({ timeout: 15_000 });
  const dialog = welcome(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading")).toHaveText("Every profile is its own browser");
  await expect(dialog.locator("[data-welcome-count]")).toHaveText("Screen 1 of 3");
  // What's new does not open on a first install.
  await expect(page.getByRole("dialog", { name: /What’s new/ })).toHaveCount(0);
});

test("three screens: Next and Back move between them, Skip is on every one, Start tour is on the last", async ({ page }) => {
  await openApp(page, { onboarding: "fresh" });
  const dialog = welcome(page);
  const heading = dialog.getByRole("heading");
  const count = dialog.locator("[data-welcome-count]");
  const button = (name: string) => dialog.getByRole("button", { name, exact: true });

  // The keyboard starts on the primary button.
  await expect(button("Next")).toBeFocused();
  await expect(heading).toHaveText("Every profile is its own browser");
  await expect(dialog).toContainText("Each profile keeps its own cookies, logins, proxy and fingerprint");
  await expect(dialog.locator("[data-welcome-picture]")).toHaveAttribute("data-welcome-picture", "profiles");
  await expect(count).toHaveText("Screen 1 of 3");
  await expect(button("Skip")).toBeVisible();
  await expect(button("Back")).toHaveCount(0);
  // The dialog is described by the screen's text, so a screen reader reads it as the welcome opens.
  const body = page.locator(`[id="${await dialog.getAttribute("aria-describedby")}"]`);
  await expect(body).toContainText("Each profile keeps its own cookies, logins, proxy and fingerprint");

  await button("Next").click();
  await expect(heading).toHaveText("Proxies and fingerprints");
  await expect(body).toContainText("A proxy hides your real IP address.");
  await expect(dialog).toContainText("A proxy hides your real IP address. A fingerprint makes each browser look like a different computer.");
  await expect(dialog.locator("[data-welcome-picture]")).toHaveAttribute("data-welcome-picture", "proxies");
  await expect(count).toHaveText("Screen 2 of 3");
  await expect(button("Skip")).toBeVisible();
  await expect(button("Back")).toBeVisible();

  await button("Next").click();
  await expect(heading).toHaveText("Take a 2-minute tour?");
  await expect(dialog.locator("[data-welcome-picture]")).toHaveAttribute("data-welcome-picture", "tour");
  await expect(count).toHaveText("Screen 3 of 3");
  await expect(button("Skip")).toBeVisible();
  await expect(button("Next")).toHaveCount(0);
  await expect(button("Start tour")).toBeVisible();

  await button("Back").click();
  await expect(heading).toHaveText("Proxies and fingerprints");
  await button("Back").click();
  await expect(heading).toHaveText("Every profile is its own browser");
  await expect(button("Back")).toHaveCount(0);
});

test("Skip closes it for good", async ({ page }) => {
  await openApp(page, { onboarding: "fresh" });
  await welcome(page).getByRole("button", { name: "Skip", exact: true }).click();
  await expect(welcome(page)).toHaveCount(0);
  expect(await stored(page)).toMatchObject({ welcomeDone: true, tour: "skipped" });
  // Skipped for good, and the toast says where the tour is kept.
  await expect(replayHint(page)).toBeVisible();
  // To the What's new gate the next start is a first install again; the answer still holds.
  await page.evaluate(() => localStorage.removeItem("shardx-patchlog-seen-version"));
  await reloadApp(page);
  await appModule(page, "/src/shared/model/whatsNew.ts", "__wn");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __wn: { useWhatsNew: { getState: () => { installKind: string | null } } } }).__wn.useWhatsNew.getState().installKind)).toBe("first");
  await expect(page.locator("main[data-section='profiles']")).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
});

test("Esc skips it too, from any screen", async ({ page }) => {
  await openApp(page, { onboarding: "fresh" });
  await welcome(page).getByRole("button", { name: "Next", exact: true }).click();
  await expect(welcome(page).getByRole("heading")).toHaveText("Proxies and fingerprints");
  await page.keyboard.press("Escape");
  await expect(welcome(page)).toHaveCount(0);
  expect(await stored(page)).toMatchObject({ welcomeDone: true, tour: "skipped" });
  await expect(replayHint(page)).toBeVisible();
});

test("Start tour starts the full tour", async ({ page }) => {
  await openApp(page, { onboarding: "fresh" });
  await expect(welcome(page)).toBeVisible();
  // The keyboard is enough: Enter, Enter, then Enter on Start tour.
  await page.keyboard.press("Enter");
  await expect(welcome(page).getByRole("heading")).toHaveText("Proxies and fingerprints");
  await page.keyboard.press("Enter");
  await expect(welcome(page).getByRole("heading")).toHaveText("Take a 2-minute tour?");
  await expect(welcome(page).getByRole("button", { name: "Start tour" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(welcome(page)).toHaveCount(0);
  await expect(tourCard(page)).toHaveAttribute("data-step", "sidebar");
  await expect(tourCard(page)).toContainText("1 of 16");
  // A full run has no "Don't show tips": that is for a page's tips.
  await expect(tourCard(page).getByRole("button", { name: "Don’t show tips" })).toHaveCount(0);
  // The welcome is answered; the tour records its own end.
  expect(await stored(page)).toMatchObject({ welcomeDone: true, tour: "never" });
  await page.keyboard.press("Escape");
  await expect(tourCard(page)).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).tour).toBe("skipped");
  await expect(welcome(page)).toHaveCount(0);
});

test("the welcome waits for the profile list", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __shardxMockFail: Record<string, number> }).__shardxMockFail = { profile_list: 1 }; });
  await openApp(page, { onboarding: "fresh" });
  await expect(page.getByText("Couldn’t load profiles")).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(welcome(page)).toBeVisible();
});

test("an existing user does not see it", async ({ page }) => {
  // An install from before the redesign: a version 1 record that is done, and an older version seen.
  await page.addInitScript(([k]) => {
    localStorage.setItem(k, JSON.stringify({ version: 1, state: "done" }));
    localStorage.setItem("shardx-patchlog-seen-version", "0.0.1");
  }, [KEY]);
  await openApp(page);
  // What's new opens, as after any update; the welcome does not.
  await expect(page.getByRole("dialog", { name: /What’s new/ })).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /What’s new/ })).toHaveCount(0);
  await expect(welcome(page)).toHaveCount(0);
});

test("an updated user with an unfinished setup gets What's new, not the welcome", async ({ page }) => {
  // A version 1 record whose setup was never finished (`active`) would open the welcome on its own; an update does not.
  await page.addInitScript(([k]) => {
    localStorage.setItem(k, JSON.stringify({ version: 1, state: "active" }));
    localStorage.setItem("shardx-patchlog-seen-version", "0.0.1");
  }, [KEY]);
  await openApp(page);
  const news = page.getByRole("dialog", { name: /What’s new/ });
  await expect(news).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(news).toHaveCount(0);
  await expect(page.locator("[role='row'][data-profile-id]").first()).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
  expect((await stored(page)).welcomeDone).toBe(false);
});

test("an updated user with an unfinished setup never gets the welcome, on that launch or the next", async ({ page }) => {
  // Seeded only while absent, so the second launch reads what the first one stored.
  await empty(page);
  await seed(page, KEY, { version: 1, state: "active" });
  await seed(page, "shardx-patchlog-seen-version", "0.0.1");
  await openApp(page);
  const news = page.getByRole("dialog", { name: /What’s new/ });
  await expect(news).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(news).toHaveCount(0);
  // The update is behind it: the record is still an unfinished setup, and not a first install.
  expect(await stored(page)).toMatchObject({ state: "active", welcomeDone: false, firstInstall: false });
  // The next start: the same version, so the gate calls it neither first nor an update.
  await reloadApp(page);
  await expect(page.getByText("No profiles yet")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(welcome(page)).toHaveCount(0);
  await expect(news).toHaveCount(0);
  expect(await stored(page)).toMatchObject({ state: "active", welcomeDone: false, firstInstall: false });
});

test("a first install that quits before answering is asked again on the next start", async ({ page }) => {
  await empty(page);
  await openApp(page, { onboarding: "fresh" });
  await expect(welcome(page)).toBeVisible();
  // Written the moment the gate knows: this computer's first launch.
  await expect.poll(async () => (await stored(page)).firstInstall).toBe(true);
  expect(await stored(page)).toMatchObject({ welcomeDone: false, tour: "never" });
  await reloadApp(page);
  // The gate calls the second start neither first nor an update; the record still owes the welcome.
  await expect(welcome(page)).toBeVisible();
  await welcome(page).getByRole("button", { name: "Skip", exact: true }).click();
  await expect(welcome(page)).toHaveCount(0);
  await reloadApp(page);
  await expect(page.getByText("No profiles yet")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(welcome(page)).toHaveCount(0);
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("its blocks come in 50 ms apart", async ({ page }) => {
    await openApp(page, { onboarding: "fresh" });
    await expect(welcome(page)).toBeVisible();
    const motion = () => page.evaluate(() => [...document.querySelectorAll("[data-welcome-screen] > *")].map((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, delay: s.animationDelay, duration: s.animationDuration };
    }));
    const blocks = await motion();
    expect(blocks.map((b) => b.name)).toEqual(["welcome-in", "welcome-in", "welcome-in"]);
    expect(blocks.map((b) => b.delay)).toEqual(["0s", "0.05s", "0.1s"]);
    expect(blocks.map((b) => b.duration)).toEqual(["0.2s", "0.2s", "0.2s"]);
    // A new screen brings its blocks in again.
    await welcome(page).getByRole("button", { name: "Next", exact: true }).click();
    await expect(welcome(page).getByRole("heading")).toHaveText("Proxies and fingerprints");
    expect((await motion()).map((b) => b.delay)).toEqual(["0s", "0.05s", "0.1s"]);
    // Reduce motion: no stagger and no rise (the shift is 0), a 150 ms fade for all three at once.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(async () => (await motion()).map((b) => b.delay)).toEqual(["0s", "0s", "0s"]);
    const reduced = await motion();
    expect(reduced.map((b) => b.name)).toEqual(["welcome-in", "welcome-in", "welcome-in"]);
    expect(reduced.map((b) => b.duration)).toEqual(["0.15s", "0.15s", "0.15s"]);
  });
});

for (const lang of ["en", "zh"] as const) {
  test(`all three screens fit at 1024 px in ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.addInitScript((l) => localStorage.setItem("shardx.lang", l), lang);
    await openApp(page, { onboarding: "fresh" });
    const dialog = page.getByRole("dialog", { name: lang === "en" ? "Welcome to Octopus Agent" : "欢迎使用 Octopus Agent" });
    await expect(dialog).toBeVisible();
    for (let screen = 0; screen < 3; screen++) {
      await expect(dialog.locator("[data-welcome-count]")).toHaveText(lang === "en" ? `Screen ${screen + 1} of 3` : `第 ${screen + 1} 页，共 3 页`);
      // Nothing runs past the dialog's edge, and the picture's parts stay inside the picture.
      const fit = await dialog.evaluate((el) => {
        const box = (e: Element) => e.getBoundingClientRect();
        const picture = el.querySelector("[data-welcome-picture]")!;
        const p = box(picture);
        const parts = [...picture.children].map(box);
        const footer = [...el.querySelectorAll("button")].map(box);
        return {
          panel: el.scrollWidth <= el.clientWidth,
          picture: parts.every((r) => r.left >= p.left - 1 && r.right <= p.right + 1),
          buttons: footer.every((r) => r.left >= box(el).left && r.right <= box(el).right),
        };
      });
      expect(fit).toEqual({ panel: true, picture: true, buttons: true });
      if (screen < 2) await dialog.getByRole("button").last().click();
    }
  });
}
