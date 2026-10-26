import { expect, test, type Locator, type Page } from "@playwright/test";
import { appModule, openApp, row } from "./support/app";

// The guided walk through the real New profile form: seven steps, each on a
// part of the form, the tabs switched by the tour. The form stays usable
// under it (the scrim lets presses through to the highlighted part only),
// and nothing is created unless Create profile is pressed.

type Mock = {
  __shardxMock: {
    log: { cmd: string; args: Record<string, unknown> }[];
    state: { order: string[] };
  };
};
type TourApi = {
  startProfileTour: () => Promise<void>;
  profileTour: { id: string; formTab?: string; target: string | null }[];
  fullTour: unknown[];
  useTour: { getState: () => { run: unknown; start: (steps: unknown[], kind: "full") => void; ended: { reason: string; kind: string } | null } };
};
/** The registry's plain data (functions do not cross to the test). */
const tourApi = (page: Page) => page.evaluate(() => (window as unknown as { __tour: TourApi }).__tour);
/** How the last run ended. */
const endedOf = (page: Page) => page.evaluate(() => (window as unknown as { __tour: TourApi }).__tour.useTour.getState().ended);

/** The seven steps, in order: the card's title, the tab the tour shows, the part it frames. */
const STEPS = [
  { id: "name", title: "Name your profile", tab: "Basics", target: "form-name" },
  { id: "organize", title: "Folder and tags", tab: "Basics", target: "form-organize" },
  { id: "proxy", title: "Choose a proxy", tab: "Proxy", target: "form-proxy" },
  { id: "fingerprint", title: "Pick a fingerprint", tab: "Fingerprint", target: "form-fingerprint" },
  { id: "locale", title: "Timezone and language", tab: "Fingerprint", target: "form-locale" },
  { id: "extensions", title: "Add extensions", tab: "Extensions", target: "form-extensions" },
  { id: "create", title: "Create the profile", tab: "Extensions", target: "form-create" },
];

const card = (page: Page) => page.locator("[data-tour-card]");
const layer = (page: Page) => page.locator("[data-tour-layer]");
const scrim = (page: Page) => page.locator("[data-tour-scrim]");
const form = (page: Page) => page.getByRole("dialog", { name: "New profile", exact: true });
const nameField = (page: Page) => form(page).getByRole("textbox", { name: "Name" });
const count = (page: Page) => page.evaluate(() => (window as unknown as Mock).__shardxMock.state.order.length);
const created = (page: Page) => page.evaluate(() => (window as unknown as Mock).__shardxMock.log
  .filter((c) => c.cmd === "profile_save" && !(c.args.payload as { _meta: { id: string } })._meta.id).length);
const toastText = (page: Page, text: string) => page.locator("[data-toast]").getByText(text, { exact: true });
const emptyInstall = (page: Page) => page.addInitScript(() => { (window as unknown as { __shardxMockEmpty: boolean }).__shardxMockEmpty = true; });

/** Opens the form and starts the walk, as the end card does. */
async function startWalk(page: Page) {
  await appModule(page, "/src/features/tour/index.ts", "__tour");
  await page.evaluate(() => (window as unknown as { __tour: TourApi }).__tour.startProfileTour());
}

/** The walk is on step `id`, landed. */
async function expectStep(page: Page, id: string) {
  await expect(card(page)).toHaveAttribute("data-step", id);
  await expect(card(page)).not.toHaveAttribute("data-entering");
}

/** The box a step frames, in layout px: a `data-tour` part, or the form's Create profile button. */
const boxOf = (page: Page, key: string) => page.evaluate((k) => {
  const el = k === "form-create"
    ? document.querySelector('form:has([data-profile-form]) button[type="submit"]')
    : document.querySelector(`[data-tour="${k}"]`);
  if (!el) return null;
  const html = document.documentElement;
  const z = html.getBoundingClientRect().width / html.offsetWidth || 1;
  const r = el.getBoundingClientRect();
  return [r.left / z, r.top / z, r.width / z, r.height / z];
}, key);

/** The cut-out sits 8 px round the part. */
async function expectHoleAround(page: Page, key: string) {
  await expect.poll(async () => {
    const got = (await scrim(page).getAttribute("data-cutout"))?.split(" ").map(Number) ?? [];
    const box = await boxOf(page, key);
    if (!box || got.length !== 5) return false;
    const want = [box[0] - 8, box[1] - 8, box[2] + 16, box[3] + 16];
    return want.every((v, i) => Math.abs(v - got[i]) <= 1);
  }, { message: `the cut-out sits around ${key}` }).toBe(true);
}

const inCard = (page: Page) => card(page).evaluate((el) => el.contains(document.activeElement));
const centre = async (loc: Locator) => { const b = (await loc.boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

test("the walk opens the form and visits all 7 steps, switching the tabs itself", async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page);
  await appModule(page, "/src/features/tour/index.ts", "__tour");
  // Nothing may ever light the sidebar: the walk stays in the form.
  await page.evaluate(() => {
    const w = window as unknown as { __beat: boolean };
    w.__beat = false;
    new MutationObserver(() => { if (document.querySelector("[data-beat]")) w.__beat = true; })
      .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-beat"] });
  });
  expect((await tourApi(page)).profileTour.map((s) => s.id)).toEqual(STEPS.map((s) => s.id));
  const before = await count(page);
  await startWalk(page);
  const d = form(page);
  await expect(d).toBeVisible();
  for (const [i, s] of STEPS.entries()) {
    await expectStep(page, s.id);
    await expect(card(page)).toContainText(new RegExp(`(?<!\\d)${i + 1} (?:of|/) 7(?!\\d)`));
    await expect(card(page).getByRole("heading", { name: s.title })).toBeVisible();
    // The page line names the form; this run is neither a tip nor a tour of pages.
    await expect(card(page).locator("[data-tour-page]")).toHaveText("New profile");
    await expect(card(page).getByRole("button", { name: "Don’t show tips" })).toHaveCount(0);
    await expect(d.getByRole("tab", { name: new RegExp(`^${s.tab}`) })).toHaveAttribute("aria-selected", "true");
    await expectHoleAround(page, s.target);
    await card(page).getByRole("button", { name: i === STEPS.length - 1 ? "Finish" : "Next" }).click();
  }
  // Finish leaves the form open and creates nothing.
  await expect(layer(page)).toHaveCount(0);
  await expect(d).toBeVisible();
  expect(await count(page)).toBe(before);
  expect(await created(page)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __beat: boolean }).__beat), "no sidebar beat").toBe(false);
  expect(await endedOf(page)).toMatchObject({ reason: "done", kind: "form" });
});

test("Back returns to the earlier step and its tab", async ({ page }) => {
  await openApp(page);
  await startWalk(page);
  await expectStep(page, "name");
  await expect(card(page).getByRole("button", { name: "Back" })).toHaveCount(0);
  await card(page).getByRole("button", { name: "Next" }).click();
  await expectStep(page, "organize");
  await card(page).getByRole("button", { name: "Next" }).click();
  await expectStep(page, "proxy");
  await expect(form(page).getByRole("tab", { name: /^Proxy/ })).toHaveAttribute("aria-selected", "true");
  await card(page).getByRole("button", { name: "Back" }).click();
  await expectStep(page, "organize");
  await expect(form(page).getByRole("tab", { name: /^Basics/ })).toHaveAttribute("aria-selected", "true");
  await expectHoleAround(page, "form-organize");
});

test("typing in Name during step 1 works: the press goes through to the field, not to the rest of the form", async ({ page }) => {
  await openApp(page);
  await startWalk(page);
  await expectStep(page, "name");
  const name = nameField(page);
  // A real press at the field: it is in the cut-out, so it lands (Playwright checks what receives it).
  await name.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Shop one");
  await expect(name).toHaveValue("Shop one");
  // The field keeps its keys: arrows move the caret, they do not move the tour, and Home does not either.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await expect(card(page)).toContainText("1 of 7");
  await expect(name).toBeFocused();
  // The card sits beside the field, not over it.
  const c = (await card(page).boundingBox())!;
  const n = (await name.boundingBox())!;
  const apart = c.y >= n.y + n.height || c.y + c.height <= n.y || c.x >= n.x + n.width || c.x + c.width <= n.x;
  expect(apart, "the card does not cover the field").toBe(true);
  // A press anywhere else on the form does nothing: Cancel is behind the scrim.
  const cancel = await centre(form(page).getByRole("button", { name: "Cancel" }));
  await page.mouse.click(cancel.x, cancel.y);
  await page.waitForTimeout(200);
  await expect(form(page)).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(card(page)).toContainText("1 of 7");
  // What was typed is still there on the next step and back.
  await card(page).getByRole("button", { name: "Next" }).click();
  await expectStep(page, "organize");
  await card(page).getByRole("button", { name: "Back" }).click();
  await expectStep(page, "name");
  await expect(name).toHaveValue("Shop one");
});

test("a picker opened from the highlighted part works: pick a Folder, and Esc in the list closes only the list", async ({ page }) => {
  await openApp(page);
  await startWalk(page);
  await card(page).getByRole("button", { name: "Next" }).click();
  await expectStep(page, "organize");
  const d = form(page);
  await d.locator("[data-property='folder'] button").click();
  const list = page.getByRole("dialog", { name: "Folder", exact: true });
  await expect(list).toBeVisible();
  // Esc belongs to the list: it closes, the walk goes on.
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(card(page)).toContainText("2 of 7");
  await expect(layer(page)).toHaveCount(1);
  // The list is above the scrim: its options take presses.
  await d.locator("[data-property='folder'] button").click();
  await page.getByRole("option", { name: "Ads", exact: true }).click();
  await expect(d.locator("[data-property='folder']")).toContainText("Ads");
  await expect(card(page)).toContainText("2 of 7");
});

test("Skip leaves the form open with what was typed", async ({ page }) => {
  await openApp(page);
  await startWalk(page);
  await expectStep(page, "name");
  await nameField(page).fill("Kept name");
  await card(page).getByRole("button", { name: "Skip tour" }).click();
  await expect(layer(page)).toHaveCount(0);
  await expect(form(page)).toBeVisible();
  await expect(nameField(page)).toHaveValue("Kept name");
  expect(await count(page)).toBe(8);
  expect(await created(page)).toBe(0);
  expect(await endedOf(page)).toMatchObject({ reason: "skip", kind: "form" });
  // The keyboard did not fall to the page behind the form: it is in the form.
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("[data-profile-form]"))).toBe(true);
});

test("Esc ends the walk and leaves the form as it is; the form's own Esc rules still apply", async ({ page }) => {
  await openApp(page);
  await startWalk(page);
  await expectStep(page, "name");
  await nameField(page).fill("Esc name");
  await page.keyboard.press("Escape");
  await expect(layer(page)).toHaveCount(0);
  await expect(form(page)).toBeVisible();
  await expect(nameField(page)).toHaveValue("Esc name");
  await expect(toastText(page, "You can see this again from “Show me around” in the form")).toBeVisible();
  // The next Esc is the form's: it has changes, so it asks.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog", { name: "Discard your changes?" })).toBeVisible();
  expect(await count(page)).toBe(8);
});

test("Create profile during the walk makes the profile once and ends the tour", async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page);
  await startWalk(page);
  await expectStep(page, "name");
  await nameField(page).fill("Walked profile");
  for (const s of STEPS.slice(0, -1)) {
    await expectStep(page, s.id);
    await card(page).getByRole("button", { name: "Next" }).click();
  }
  await expectStep(page, "create");
  const create = form(page).getByRole("button", { name: "Create profile" });
  await expectHoleAround(page, "form-create");
  // Nothing exists yet.
  expect(await count(page)).toBe(8);
  await create.click();
  await expect(layer(page)).toHaveCount(0);
  await expect(form(page)).toHaveCount(0);
  await expect(row(page, "Walked profile")).toHaveCount(1);
  await expect(toastText(page, "Walked profile created")).toBeVisible();
  expect(await count(page)).toBe(9);
  expect(await created(page)).toBe(1);
  expect(await endedOf(page)).toMatchObject({ kind: "form" });
});

const saves = (page: Page) => page.evaluate(() => (window as unknown as Mock).__shardxMock.log.filter((c) => c.cmd === "profile_save").length);

test("Enter in the Name field goes to the next step: it does not submit the form", async ({ page }) => {
  await openApp(page);
  await startWalk(page);
  await expectStep(page, "name");
  const name = nameField(page);
  await name.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Typed then Enter");
  const before = await saves(page);
  await page.keyboard.press("Enter");
  await expectStep(page, "organize");
  await expect(card(page)).toContainText("2 of 7");
  // Nothing was saved, and the form is open with what was typed.
  await page.waitForTimeout(200);
  expect(await saves(page)).toBe(before);
  expect(await count(page)).toBe(8);
  await expect(form(page)).toBeVisible();
  await expect(name).toHaveValue("Typed then Enter");
  // Outside a walk Enter is the form's own: it creates the profile.
  await card(page).getByRole("button", { name: "Skip tour" }).click();
  await expect(layer(page)).toHaveCount(0);
  await name.focus();
  await page.keyboard.press("Enter");
  await expect(form(page)).toHaveCount(0);
  expect(await created(page)).toBe(1);
  expect(await count(page)).toBe(9);
});

test("on the last step Enter does what Create profile does, once", async ({ page }) => {
  test.setTimeout(60_000);
  await openApp(page);
  await appModule(page, "/src/features/profile-form/model/useProfileForm.ts", "__pf");
  await startWalk(page);
  await expectStep(page, "name");
  await nameField(page).fill("Entered at the end");
  for (const s of STEPS.slice(0, -1)) {
    await expectStep(page, s.id);
    await card(page).getByRole("button", { name: "Next" }).click();
  }
  await expectStep(page, "create");
  // The keyboard goes from the card to the part it frames: Create profile.
  await page.keyboard.press("Tab");
  await expect(form(page).getByRole("button", { name: "Create profile" })).toBeFocused();
  // Enter in a line of the form is the form's own here, not a step: on Basics, in Name, it creates.
  await page.evaluate(() => (window as unknown as { __pf: { setProfileFormTab: (t: string) => void } }).__pf.setProfileFormTab("basics"));
  await expect(nameField(page)).toBeVisible();
  await nameField(page).focus();
  expect(await count(page)).toBe(8);
  await page.keyboard.press("Enter");
  await expect(layer(page)).toHaveCount(0);
  await expect(form(page)).toHaveCount(0);
  await expect(row(page, "Entered at the end")).toHaveCount(1);
  expect(await created(page)).toBe(1);
  expect(await count(page)).toBe(9);
});

test("the end card's New profile starts the walk, not just the form", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/features/tour/index.ts", "__tour");
  await page.evaluate(() => {
    const t = (window as unknown as { __tour: TourApi }).__tour;
    t.useTour.getState().start(t.fullTour.slice(15), "full");
  });
  await expect(card(page)).toHaveAttribute("data-step", "help");
  await expect(card(page)).not.toHaveAttribute("data-entering");
  await card(page).getByRole("button", { name: "Finish" }).click();
  const end = page.getByRole("dialog", { name: "You’re all set." });
  await expect(end).toBeVisible();
  await end.getByRole("button", { name: "New profile" }).click();
  await expect(end).toHaveCount(0);
  await expect(page.locator("main[data-section='profiles']")).toBeVisible();
  await expect(form(page)).toBeVisible();
  await expectStep(page, "name");
  await expect(card(page)).toContainText("1 of 7");
  // The keyboard is on the card's Next, as in every run.
  await expect(card(page).getByRole("button", { name: "Next" })).toBeFocused();
  expect(await created(page)).toBe(0);
});

test("Create your first profile on the end card starts the walk", async ({ page }) => {
  await emptyInstall(page);
  await openApp(page);
  await appModule(page, "/src/features/tour/index.ts", "__tour");
  await page.evaluate(() => {
    const t = (window as unknown as { __tour: TourApi }).__tour;
    t.useTour.getState().start(t.fullTour.slice(15), "full");
  });
  await expect(card(page)).toHaveAttribute("data-step", "help");
  await expect(card(page)).not.toHaveAttribute("data-entering");
  await card(page).getByRole("button", { name: "Finish" }).click();
  const end = page.getByRole("dialog", { name: "You’re all set." });
  await end.getByRole("button", { name: "Create your first profile" }).click();
  await expect(form(page)).toBeVisible();
  await expectStep(page, "name");
  await expect(card(page)).toContainText("1 of 7");
});

test("the form's Show me around link starts the walk on the open form, keeping what was typed", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New profile" }).first().click();
  const d = form(page);
  await expect(nameField(page)).toBeFocused();
  await page.keyboard.type("Typed first");
  await d.getByRole("tab", { name: /^Fingerprint/ }).click();
  // A quiet link in the form, not a button in the footer.
  const link = d.getByRole("button", { name: "Show me around" });
  await expect(link).toBeVisible();
  await link.click();
  await expectStep(page, "name");
  await expect(d.getByRole("tab", { name: /^Basics/ })).toHaveAttribute("aria-selected", "true");
  await expect(nameField(page)).toHaveValue("Typed first");
  await card(page).getByRole("button", { name: "Skip tour" }).click();
  await expect(layer(page)).toHaveCount(0);
  // The keyboard goes back to the link it started from.
  await expect(link).toBeFocused();
  // Edit has no such link: the walk is about creating a profile.
  await d.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("alertdialog", { name: "Discard your changes?" }).getByRole("button", { name: "Discard" }).click();
  await row(page, "Sandbox").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit Sandbox", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show me around" })).toHaveCount(0);
});

test("keyboard: Tab reaches the field and the card, and the form's trap does not fight the card's", async ({ page }) => {
  await openApp(page);
  await startWalk(page);
  await expectStep(page, "name");
  const next = card(page).getByRole("button", { name: "Next" });
  await expect(next).toBeFocused();
  // Next, Tab: the highlighted field. Tab again: back into the card.
  await page.keyboard.press("Tab");
  await expect(nameField(page)).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await inCard(page)).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect(nameField(page)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await inCard(page)).toBe(true);
  // Round and round: the keyboard is always in the field or the card, never on the page or the rest of the form.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const where = await page.evaluate(() => {
      const a = document.activeElement;
      return a?.closest("[data-tour-card]") ? "card" : a?.closest("[data-tour='form-name']") ? "field" : "elsewhere";
    });
    expect(where, `Tab ${i + 1}`).not.toBe("elsewhere");
  }
  // From the card the arrows still walk; from the field they are the field's.
  await next.focus();
  await page.keyboard.press("ArrowRight");
  await expectStep(page, "organize");
  expect(await inCard(page)).toBe(true);
  await page.keyboard.press("ArrowLeft");
  await expectStep(page, "name");
  // Enter on Next presses it once.
  await next.focus();
  await page.keyboard.press("Enter");
  await expectStep(page, "organize");
  // Tab from the card goes to the part this step frames (Folder), and the field is usable by keyboard.
  await card(page).getByRole("button", { name: "Next" }).focus();
  await page.keyboard.press("Tab");
  await expect(form(page).locator("[data-property='folder'] button")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: "Folder", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(form(page).locator("[data-property='folder'] button")).toBeFocused();
  await expect(card(page)).toContainText("2 of 7");
});

test("in Chinese at 1024×680 no text overflows, in the card or in the form", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1024, height: 680 });
  await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
  await openApp(page);
  await startWalk(page);
  const d = page.getByRole("dialog", { name: "新建配置", exact: true });
  await expect(d).toBeVisible();
  for (const [i, s] of STEPS.entries()) {
    await expectStep(page, s.id);
    await expect(card(page)).toContainText(`${i + 1} / 7`);
    await expect(card(page).locator("[data-tour-page]")).toHaveText("新建配置");
    const fit = await card(page).evaluate((el) => {
      const arrow = el.querySelector<HTMLElement>("[data-tour-arrow]");
      if (arrow) arrow.style.display = "none";
      const r = el.getBoundingClientRect();
      const result = {
        card: el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight,
        texts: [...el.querySelectorAll("h2, p, button")].filter((t) => {
          if (t instanceof HTMLButtonElement) {
            const b = t.getBoundingClientRect();
            return [...t.children].some((c) => { const r = c.getBoundingClientRect(); return r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1; });
          }
          return !(t.scrollWidth <= t.clientWidth && t.scrollHeight <= t.clientHeight);
        }).map((t) => t.textContent),
        inside: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      };
      if (arrow) arrow.style.display = "";
      return result;
    });
    expect(fit, `step ${s.id}`).toEqual({ card: true, texts: [], inside: true });
    // The form under it: no sideways scroll, the link and the tabs on one line inside the dialog.
    const formFit = await d.evaluate((el) => {
      const body = el.querySelector<HTMLElement>("[data-profile-form]")!.parentElement!;
      const link = [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "带我看看");
      const r = el.getBoundingClientRect();
      const l = link?.getBoundingClientRect();
      return { sideways: body.scrollWidth > body.clientWidth, link: !!l && l.left >= r.left && l.right <= r.right };
    });
    expect(formFit, `the form at step ${s.id}`).toEqual({ sideways: false, link: true });
    await card(page).getByRole("button", { name: /^(下一步|完成)$/ }).click();
  }
  await expect(layer(page)).toHaveCount(0);
});
