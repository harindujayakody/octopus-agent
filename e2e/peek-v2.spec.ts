import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";
import { boxOf } from "./support/geometry";

// F1: one Peek (UI-18, LAYOUT-12). Tasks 14 to 16 append.
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const profilePeek = (page: Page) => page.locator("aside[data-peek='profile']");
const proxyPeek = (page: Page) => page.locator("aside[data-peek='proxy']");
const fpPeek = (page: Page) => page.locator("aside[data-peek='fingerprint']");
const header = (aside: ReturnType<Page["locator"]>) => aside.locator("[data-peek-header]");
/** Peek's header height (PeekHeader.tsx): 40, its own since the owner found
 *  the list's 32 too tight (2026-10-01). */
const HEADER = 40;

async function openProfilePeek(page: Page, name: string) {
  await openApp(page);
  await row(page, name).locator("[data-cell='name']").click();
  await expect(profilePeek(page)).toBeVisible();
}
async function openProxyPeek(page: Page, name: string) {
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id]", { hasText: name }).locator("[data-cell='name']").click();
  await expect(proxyPeek(page)).toBeVisible();
}
async function openFingerprintPeek(page: Page, label: string) {
  await openApp(page, { section: "fingerprints" });
  await page.locator("[data-fingerprint-id]", { hasText: label }).first().click();
  await expect(fpPeek(page)).toBeVisible();
}

test("the three Peeks share one frame: a panel with no border, one header height, the same top (UI-18, LAYOUT-12)", async ({ page }) => {
  const tops: number[] = [];
  await openProfilePeek(page, "Sandbox");
  await expect(profilePeek(page)).toHaveCSS("border-top-width", "0px");
  expect((await boxOf(header(profilePeek(page)))).height).toBe(HEADER);
  tops.push((await boxOf(profilePeek(page))).y);
  await openProxyPeek(page, "DC Tokyo");
  await expect(proxyPeek(page)).toHaveCSS("border-top-width", "0px");
  expect((await boxOf(header(proxyPeek(page)))).height).toBe(HEADER);
  tops.push((await boxOf(proxyPeek(page))).y);
  await openFingerprintPeek(page, "macOS 14, Apple M1");
  await expect(fpPeek(page)).toHaveCSS("border-top-width", "0px");
  expect((await boxOf(header(fpPeek(page)))).height).toBe(HEADER);
  tops.push((await boxOf(fpPeek(page))).y);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
});

// Peek's header is 40 px, the list's column header 32 (owner, 2026-10-01):
// the two rules no longer line up (LAYOUT-03 is dropped for Peek), but the
// controls sit centered with about 8 px of air.
test("Peek's header centers its controls with room above and below", async ({ page }) => {
  await openProxyPeek(page, "DC Tokyo");
  const bar = await boxOf(header(proxyPeek(page)));
  const close = await boxOf(header(proxyPeek(page)).getByRole("button", { name: "Close Peek" }));
  expect(Math.abs(close.y - bar.y - (bar.y + bar.height - (close.y + close.height)))).toBeLessThanOrEqual(1.5);
  expect(close.y - bar.y).toBeGreaterThanOrEqual(7);
});

test("each Peek's main action sits in its header (LAYOUT-12)", async ({ page }) => {
  await openProfilePeek(page, "Sandbox");
  await expect(header(profilePeek(page)).getByRole("button", { name: "Start" })).toBeVisible();
  await openProxyPeek(page, "DC Tokyo");
  await expect(header(proxyPeek(page)).getByRole("button", { name: "Test now" })).toBeVisible();
  await openFingerprintPeek(page, "macOS 14, Apple M1");
  await expect(header(fpPeek(page)).getByRole("button", { name: "New profile with this fingerprint" })).toBeVisible();
});

test("each Peek has the object's actions in a … menu (IFACE-12)", async ({ page }) => {
  await openProfilePeek(page, "Sandbox");
  await header(profilePeek(page)).getByRole("button", { name: "More actions" }).click();
  for (const name of [/Export cookies/, /Import cookies/, /Move to Trash/]) await expect(page.getByRole("menuitem", { name })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(profilePeek(page).locator("[data-peek-section='cookies']")).toHaveCount(0);

  await openProxyPeek(page, "DC Tokyo");
  await header(proxyPeek(page)).getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Copy address" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Delete/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await openFingerprintPeek(page, "macOS 14, Apple M1");
  await header(fpPeek(page)).getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: /Remove fingerprint/ })).toBeVisible();
});

test("a running profile's note is its status tooltip, not a line (CRAFT-01)", async ({ page }) => {
  await openProfilePeek(page, "Amazon US seller");
  // No line: only the words a screen reader reads with the status.
  await expect(profilePeek(page).getByText("Changes apply the next time it starts.", { exact: true })).toHaveClass(/sr-only/);
  await header(profilePeek(page)).locator("[data-peek-run-status]").hover();
  await expect(page.getByRole("tooltip")).toHaveText("Changes apply the next time it starts.");
});

test("Peek's status is the list's pill: a word, and its state (Live layer)", async ({ page }) => {
  await openProfilePeek(page, "Amazon US seller");
  const pill = header(profilePeek(page)).locator("[data-pill='status']");
  await expect(pill).toHaveAttribute("data-state", "running");
  await expect(pill.locator("[data-status-label]")).toHaveText("Running");
  await openProxyPeek(page, "Old datacenter");
  const test = header(proxyPeek(page)).locator("[data-pill='proxy-test']");
  await expect(test).toHaveAttribute("data-state", "failed");
  await expect(test.locator("[data-status-label]")).toHaveText("Failed");
});

test("Proxy panel's password shows with an eye in its row, named once (LAYOUT-15, PC-073)", async ({ page }) => {
  await openProxyPeek(page, "DC Tokyo");
  const password = proxyPeek(page).locator("[data-property='password']");
  const eye = password.getByRole("button", { name: "Show password" });
  const r = await boxOf(password);
  const e = await boxOf(eye);
  expect(e.x + e.width).toBeLessThanOrEqual(r.x + r.width + 0.5);
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await expect(password).not.toContainText("mock-pass-4");
  await eye.click();
  await expect(password.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "true");
  await expect(password).toContainText("mock-pass-4");
});

// Pair 18 review, I2: one ring, never cut off. In the Edit proxy dialog the
// eye's ring is inside its box, and the field's own ring stands down while
// the eye has focus.
test("the password eye draws the one focus ring, inside the field", async ({ page }) => {
  await openProxyPeek(page, "DC Tokyo");
  await header(proxyPeek(page)).getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit DC Tokyo", exact: true });
  const field = dialog.getByLabel("Password", { exact: true });
  const eye = dialog.getByRole("button", { name: "Show password" });
  const f = await boxOf(field.locator("xpath=ancestor::*[contains(@class,'ring')][1]"));
  const e = await boxOf(eye);
  expect(e.x + e.width).toBeLessThanOrEqual(f.x + f.width + 0.5);
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await eye.click();
  await expect(eye).toHaveAttribute("aria-pressed", "true");
  await expect(field).toHaveAttribute("type", "text");
  await field.focus();
  await page.keyboard.press("Tab");
  await expect(eye).toBeFocused();
  await expect(field.locator("xpath=..")).toHaveCSS("outline-style", "none");
  await expect(eye).toHaveCSS("outline-offset", "-2px");
});

// Pair 18 review, M6: both cookie items open a file dialog, and Import says
// why a running profile can't take cookies before the click.
test("a running profile's Import cookies is off, and says why", async ({ page }) => {
  await openProfilePeek(page, "Amazon US seller");
  await header(profilePeek(page)).getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Export cookies" })).toBeEnabled();
  const item = page.getByRole("menuitem", { name: "Import cookies" });
  await expect(item).toHaveAttribute("aria-disabled", "true");
  await expect(item).toHaveAccessibleDescription("Stop the profile first");
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("Peek leaves the way it came (FEEL-02, PC-054)", async ({ page }) => {
    await openProfilePeek(page, "Sandbox");
    await page.keyboard.press("Escape");
    const leaving = await page.evaluate(() => new Promise<boolean>((done) =>
      requestAnimationFrame(() => done(document.querySelector("aside[data-peek][data-ending-style]") !== null))));
    expect(leaving).toBe(true);
    await expect(profilePeek(page)).toHaveCount(0);
  });

  test("Peek opened again while it leaves turns around where it is (craft item 6)", async ({ page }) => {
    await openProfilePeek(page, "Sandbox");
    await appModule(page, "/src/entities/profile/lib/useProfileUi.tsx", "__ui");
    // Settled in place after its way in.
    await expect.poll(() => profilePeek(page).evaluate((el) => Number.parseFloat(getComputedStyle(el).translate) || 0)).toBe(0);
    await profilePeek(page).evaluate((el) => { el.dataset.mark = "same"; });
    // The fastest each move may go, from the motion tokens: the way out is
    // --ease-out over --motion-base, steepest at its start; the turn-around is
    // the spring (--ease-spring over --motion-spring), steepest in its
    // steepest segment, and however the browser shortens a reversed
    // transition it covers at most --motion-nudge at that pace. px per ms.
    const pace = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const ms = (v: string) => (v.trim().endsWith("ms") ? Number.parseFloat(v) : Number.parseFloat(v) * 1000);
      const nudge = Number.parseFloat(cs.getPropertyValue("--motion-nudge"));
      const [x1, y1, x2, y2] = (cs.getPropertyValue("--ease-out").match(/[\d.]+/g) ?? []).map(Number);
      const outSlope = Math.max(y1 / x1, (1 - y2) / (1 - x2));
      const stops = (cs.getPropertyValue("--ease-spring").match(/-?[\d.]+/g) ?? []).map(Number);
      const springSlope = Math.max(...stops.slice(1).map((v, i) => v - stops[i])) * (stops.length - 1);
      return {
        nudge,
        out: (nudge * outSlope) / ms(cs.getPropertyValue("--motion-base")),
        back: (nudge * springSlope) / ms(cs.getPropertyValue("--motion-spring")),
      };
    });
    // Closed, opened again once it is visibly on its way out, and watched for
    // 30 frames with each frame's time. Judged against the time between two
    // samples, not per frame, so a slow frame (a busy machine) is not a jump:
    // it turns around from where it is (it never drops back faster than the
    // spring can carry it, so no snap to the open place, and never jumps back
    // to the way in's 8 px or past the way out's 4 px), and it is the same panel.
    const out = await page.evaluate(() => new Promise<{ ts: number[]; xs: number[]; reopenAt: number; leftAt: boolean }>((done) => {
      type Ui = { __ui: { useProfileUi: { getState: () => { closePeek: () => void; openPeek: (id: string) => void } } } };
      const ui = (window as unknown as Ui).__ui.useProfileUi;
      const xOf = () => {
        const el = document.querySelector<HTMLElement>("aside[data-peek]");
        return el ? Number.parseFloat(getComputedStyle(el).translate) || 0 : -1;
      };
      ui.getState().closePeek();
      const ts: number[] = [];
      const xs: number[] = [];
      let reopenAt = -1;
      let leftAt = false;
      const tick = (t: number) => {
        ts.push(t);
        xs.push(xOf());
        if (reopenAt < 0 && (xs.at(-1)! > 0.3 || xs.length === 20)) {
          leftAt = document.querySelector("aside[data-peek]")?.hasAttribute("data-ending-style") ?? false;
          reopenAt = xs.length - 1;
          ui.getState().openPeek("f62a9d43");
        }
        if (reopenAt < 0 || xs.length < reopenAt + 31) requestAnimationFrame(tick);
        else done({ ts, xs, reopenAt, leftAt });
      };
      requestAnimationFrame(tick);
    }));
    expect(out.leftAt).toBe(true);
    expect(out.xs[out.reopenAt]).toBeGreaterThan(0.3);
    expect(Math.min(...out.xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...out.xs)).toBeLessThanOrEqual(pace.nudge + 0.01);
    // Half a pixel for where a sample falls in its frame, or a frame of the
    // fastest way out: the browser starts a transition at the frame's own
    // time, which a sample may be a frame ahead of (seen on a production
    // build, where frames come quicker).
    const TOL = Math.max(0.5, pace.out * 16.7);
    for (let i = 1; i < out.xs.length; i++) {
      const dt = out.ts[i] - out.ts[i - 1];
      const up = out.xs[i] - out.xs[i - 1];
      const down = -up;
      // Outward only as fast as the way out goes (until the reopen lands).
      expect(up, `frame ${i}: out ${up.toFixed(2)} px in ${dt.toFixed(0)} ms`).toBeLessThanOrEqual(pace.out * dt + TOL);
      // Back no faster than the spring: before the reopen not at all.
      const back = i <= out.reopenAt ? 0 : pace.back * dt;
      expect(down, `frame ${i}: back ${down.toFixed(2)} px in ${dt.toFixed(0)} ms`).toBeLessThanOrEqual(back + TOL);
    }
    // Turned around: it ends nearer home than where the reopen caught it.
    expect(out.xs.at(-1)!).toBeLessThan(out.xs[out.reopenAt]);
    await expect(profilePeek(page)).toHaveAttribute("data-state", "open");
    await expect(profilePeek(page)).toHaveAttribute("data-mark", "same");
  });
});

// Task 14: Profile Peek as a property sheet (CRAFT-01, O4). Since manual
// save it only shows: Edit and the Proxy and Extensions values open the form.
const prop = (page: Page, id: string) => profilePeek(page).locator(`[data-property='${id}']`).first();

test("the title is the name, read only: a heading, no field (plan ruling 3)", async ({ page }) => {
  await openProfilePeek(page, "Sandbox");
  await expect(header(profilePeek(page)).getByRole("heading", { level: 2 })).toHaveText("Sandbox");
  await expect(profilePeek(page).getByRole("textbox")).toHaveCount(0);
});

test("Edit sits in the header before Start: secondary, with a pencil and the word", async ({ page }) => {
  await openProfilePeek(page, "Sandbox");
  const edit = header(profilePeek(page)).getByRole("button", { name: "Edit", exact: true });
  const start = header(profilePeek(page)).getByRole("button", { name: "Start" });
  await expect(edit).toBeVisible();
  await expect(edit.locator("svg")).toHaveCount(1);
  const e = await boxOf(edit);
  const st = await boxOf(start);
  expect(e.x + e.width).toBeLessThanOrEqual(st.x);
  // The icon takes its 14 px slot, never bigger.
  expect((await boxOf(edit.locator("svg"))).width).toBeCloseTo(14, 0);
});

test("the Profile section is rows of label and value (O4)", async ({ page }) => {
  await openProfilePeek(page, "Sandbox");
  const section = profilePeek(page).locator("[data-peek-section='profile']");
  for (const id of ["folder", "tags", "color", "proxy", "extensions", "notes"]) await expect(section.locator(`[data-property='${id}']`), id).toBeVisible();
  await expect(section.getByRole("textbox")).toHaveCount(0);
  await expect(prop(page, "notes")).toContainText("Throwaway. Direct connection.");
  // Every empty value is a state, never a verb (merge point 4 review, M2).
  await expect(prop(page, "folder")).toContainText("No folder");
  await expect(prop(page, "tags")).toContainText("No tags");
  // Folder, Tags, Color and Notes are text; Proxy and Extensions open the form.
  for (const id of ["folder", "tags", "color", "notes"]) await expect(prop(page, id).locator("button"), id).toHaveCount(0);
  await expect(prop(page, "proxy").locator("button")).toHaveAccessibleName("Proxy No proxy");
  // Every library extension loads into every profile: Extensions counts them all.
  await expect(prop(page, "extensions").locator("button")).toHaveAccessibleName(/^Extensions All \d+, pinned$/);
});

test("Extensions says every library extension is on, pinned", async ({ page }) => {
  await openProfilePeek(page, "Amazon US seller");
  await expect(prop(page, "extensions").locator("button")).toContainText(/^All \d+, pinned$/);
});

// Task 15: the Fingerprint rows and the activity rows.
test("at 1280 x 800 the Profile, Proxy and Fingerprint rows are all above the fold (CRAFT-01)", async ({ page }) => {
  await openProfilePeek(page, "Amazon US seller");
  for (const id of ["folder", "proxy", "os", "template", "timezone", "language"]) {
    const b = await boxOf(profilePeek(page).locator(`[data-property='${id}']`));
    expect(b.y + b.height, id).toBeLessThanOrEqual(800);
  }
});

test("the Fingerprint section is rows; no summary sentence repeats them (PC-056, CRAFT-32)", async ({ page }) => {
  await openProfilePeek(page, "Amazon US seller");
  const fp = profilePeek(page).locator("[data-peek-section='fingerprint']");
  await expect(fp.locator("[data-property='os']")).toContainText("Windows");
  await expect(fp.locator("[data-property='timezone']")).toContainText("Auto (from proxy)");
  await expect(fp.getByText(/^Windows, Windows/)).toHaveCount(0);
  await expect(fp.getByRole("button", { name: /^(OS|Operating system|Fingerprint|Timezone|Language)/ })).toHaveCount(0);
});

test("a larger stored screen size shows as it is (CRAFT-21)", async ({ page }) => {
  await openProfilePeek(page, "Amazon US seller");
  await expect(profilePeek(page).locator("[data-property='screen']")).toContainText("2560 × 1440, larger than this screen");
});

test("the header status follows the name, a long name still cuts", async ({ page }) => {
  await openProfilePeek(page, "Sandbox");
  await appModule(page, "/src/entities/profile/lib/useProfile.tsx", "__profileStore");
  const header = profilePeek(page).locator("[data-peek-header]");
  const name = header.getByRole("heading", { level: 2 });
  const pill = header.locator("[data-pill='status']");
  const gap = async () => (await boxOf(pill)).x - ((await boxOf(name)).x + (await boxOf(name)).width);
  expect(await gap()).toBeLessThan(12);
  await page.evaluate(() => {
    const store = (window as unknown as { __profileStore: { useProfile: { getState: () => { renameProfile: (id: string, name: string) => void } } } }).__profileStore;
    store.useProfile.getState().renameProfile("f62a9d43", "A very long profile name that has to be cut before it reaches the buttons on the right");
  });
  await expect(name).toContainText("A very long profile name");
  expect(await gap()).toBeLessThan(12);
  const close = header.getByRole("button", { name: "Close Peek" });
  expect((await boxOf(pill)).x + (await boxOf(pill)).width).toBeLessThanOrEqual((await boxOf(close)).x);
  // Edit and Start keep their words while the name gives way.
  await expect(header.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(header.getByRole("button", { name: "Start" })).toBeVisible();
});

test("activity is a stat strip over two label and value rows", async ({ page }) => {
  await openProfilePeek(page, "Amazon US seller");
  const activity = profilePeek(page).locator("[data-peek-section='activity']");
  await expect(activity.locator("[data-property='created']")).toContainText(/^Created\s*\w{3} \d/);
  await expect(activity.locator("[data-property='last-run']")).toContainText(/^Last run\s*\w{3} \d/);
  // The total is a stat (owner, "more air"): whole hours, the unit apart, never "212h 0m".
  await expect(activity.locator("[data-peek-stat='total-time']")).toContainText(/^Total time\s*212\s*h$/);
  await openProfilePeek(page, "Sandbox");
  await expect(profilePeek(page).locator("[data-peek-section='activity'] [data-property='last-run']")).toContainText(/^Last run\s*Never$/);
});
