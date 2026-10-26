import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";

// Onboarding Task 1: the onboarding record remembers the welcome, the tour,
// the pages already toured and the tips switch (version 2), and the What's
// new gate tells a first install from an update before it records the
// version. `shouldWelcome()` reads both.

type Onboarding = {
  useOnboarding: { getState: () => Record<string, unknown> & {
    markPageSeen: (s: string) => void; setTour: (s: string) => void; resetTour: () => void;
  } };
  shouldWelcome: () => boolean;
};
type WhatsNew = { useWhatsNew: { getState: () => { installKind: string | null } } };

const KEY = "shardx.onboarding";
const SEEN_KEY = "shardx-patchlog-seen-version";

const stored = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), KEY);
const onboarding = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __ob: Onboarding }).__ob.useOnboarding.getState();
  return { state: s.state, welcomeDone: s.welcomeDone, tour: s.tour, pagesSeen: s.pagesSeen, tipsOff: s.tipsOff, firstInstall: s.firstInstall, storageOk: s.storageOk };
});
const shouldWelcome = (page: Page) => page.evaluate(() => (window as unknown as { __ob: Onboarding }).__ob.shouldWelcome());
const installKind = (page: Page) => page.evaluate(() => (window as unknown as { __wn: WhatsNew }).__wn.useWhatsNew.getState().installKind);

async function load(page: Page) {
  await appModule(page, "/src/features/onboarding/index.ts", "__ob");
  await appModule(page, "/src/shared/model/whatsNew.ts", "__wn");
}

test("a version 1 record migrates and keeps its state", async ({ page }) => {
  // An old record still carries `proxySkipped` (the removed setup checklist's): it is dropped.
  await page.addInitScript(([k, s]) => {
    localStorage.setItem(k, JSON.stringify({ version: 1, state: "done", proxySkipped: true }));
    localStorage.setItem(s, "2.0.3");
  }, [KEY, SEEN_KEY]);
  await openApp(page);
  await load(page);
  expect(await onboarding(page)).toEqual({
    state: "done", welcomeDone: false, tour: "never", pagesSeen: [], tipsOff: false, firstInstall: false, storageOk: true,
  });
  // Written back as version 2 with the new fields.
  expect(await stored(page)).toEqual({
    version: 2, state: "done", welcomeDone: false, tour: "never", pagesSeen: [], tipsOff: false, firstInstall: false,
  });
});

test("a version 2 record without firstInstall reads as false and owes no welcome on a later start", async ({ page }) => {
  // Written by an earlier build of version 2 (no such field), an unfinished setup, the current version seen.
  // No profiles, so the setup stays unfinished (the first profile would finish it).
  await page.addInitScript(() => { (window as unknown as { __shardxMockEmpty: boolean }).__shardxMockEmpty = true; });
  await page.addInitScript(([k, s]) => {
    localStorage.setItem(k, JSON.stringify({ version: 2, state: "active", welcomeDone: false, tour: "never", pagesSeen: [], tipsOff: false }));
    localStorage.setItem(s, "2.0.3");
  }, [KEY, SEEN_KEY]);
  await openApp(page);
  await load(page);
  expect((await onboarding(page)).firstInstall).toBe(false);
  expect(await shouldWelcome(page)).toBe(false);
  expect(await stored(page)).toMatchObject({ version: 2, state: "active", firstInstall: false });
});

test("resetTour clears pagesSeen", async ({ page }) => {
  await openApp(page);
  await load(page);
  await page.evaluate(() => {
    const s = (window as unknown as { __ob: Onboarding }).__ob.useOnboarding.getState();
    s.markPageSeen("proxies");
    s.markPageSeen("trash");
    s.markPageSeen("proxies");
    s.setTour("done");
  });
  expect((await onboarding(page)).pagesSeen).toEqual(["proxies", "trash"]);
  expect((await stored(page)).tour).toBe("done");
  await page.evaluate(() => (window as unknown as { __ob: Onboarding }).__ob.useOnboarding.getState().resetTour());
  const after = await onboarding(page);
  expect(after.tour).toBe("never");
  expect(after.pagesSeen).toEqual([]);
  const saved = await stored(page);
  expect(saved.tour).toBe("never");
  expect(saved.pagesSeen).toEqual([]);
});

test("shouldWelcome is true on a fresh install", async ({ page }) => {
  // No seen version: the What's new gate has never run here.
  await openApp(page, { onboarding: "fresh" });
  await load(page);
  await expect.poll(() => installKind(page)).toBe("first");
  expect(await shouldWelcome(page)).toBe(true);
  // This launch is remembered as the first install, in memory and in the record.
  await expect.poll(async () => (await onboarding(page)).firstInstall).toBe(true);
  expect((await stored(page)).firstInstall).toBe(true);
  // The gate records the version at once: the next start is no first install.
  expect(await page.evaluate((s) => localStorage.getItem(s), SEEN_KEY)).toBe("2.0.3");
});

test("false for an existing user after an update", async ({ page }) => {
  await page.addInitScript(([k, s]) => {
    localStorage.setItem(k, JSON.stringify({ version: 1, state: "done" }));
    localStorage.setItem(s, "0.0.1");
  }, [KEY, SEEN_KEY]);
  await openApp(page);
  await load(page);
  await expect.poll(() => installKind(page)).toBe("update");
  expect(await shouldWelcome(page)).toBe(false);
});

test("localStorage that throws gives storageOk false and no welcome", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Before any of the app's code runs (module scripts run once the document
  // is parsed), every read and write throws, as a blocked storage does.
  // openApp's own seeding runs first, so only the app meets it.
  await page.addInitScript(() => {
    document.addEventListener("readystatechange", () => {
      if (document.readyState !== "interactive") return;
      const blocked = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
      Storage.prototype.getItem = blocked;
      Storage.prototype.setItem = blocked;
    });
  });
  await openApp(page, { onboarding: "fresh" });
  await load(page);
  // The app works: the Profiles page is there.
  await expect(page.locator("main[data-section='profiles'] [data-page-title]")).toBeVisible();
  expect((await onboarding(page)).storageOk).toBe(false);
  expect(await shouldWelcome(page)).toBe(false);
  // The gate could not read the seen version: it claims neither kind.
  await page.waitForTimeout(300);
  expect(await installKind(page)).toBeNull();
  await expect(page.getByRole("dialog", { name: /What’s new/ })).toHaveCount(0);
  // No error on the way: every read and write the start makes is wrapped.
  expect(errors).toEqual([]);
});
