import { expect, test, type Page } from "@playwright/test";
import { openApp, openEditForm, waitForIdle } from "./support/app";
import { pickOption } from "./support/select";

// The browser's own interface language (#81): this computer's unless the
// profile asks for its own, and only that choice is written into the profile.
type Stored = { ui_language?: string; name: string };
type Mock = { __shardxMock: { state: { order: string[]; profiles: Record<string, Stored> } } };
const SANDBOX = "f62a9d43";
const FIELD = "Browser interface language";
const stored = (page: Page, id: string) => page.evaluate((i) => (window as unknown as Mock).__shardxMock.state.profiles[i], id);
const lastId = (page: Page) => page.evaluate(() => { const s = (window as unknown as Mock).__shardxMock.state; return s.order[s.order.length - 1]; });

test("a new profile takes the system language and writes nothing", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New profile" }).first().click();
  const d = page.getByRole("dialog", { name: "New profile", exact: true });
  await expect(d.getByRole("textbox", { name: "Name" })).toHaveValue(/^Profile \d+$/);
  await d.getByRole("tab", { name: "Fingerprint", exact: true }).click();
  await expect(d.getByRole("combobox", { name: FIELD, exact: true })).toContainText("System language");
  await expect(d.getByText("The browser’s menus, settings and dialogs are in this computer’s language.", { exact: false })).toBeVisible();
  await d.getByRole("button", { name: "Create profile" }).click();
  await expect(d).toHaveCount(0);
  await waitForIdle(page);
  const created = await stored(page, await lastId(page));
  expect(created).not.toHaveProperty("ui_language");
});

test("Same as the profile language is saved, kept on reopen, and System takes it out again", async ({ page }) => {
  await openApp(page);
  expect(await stored(page, SANDBOX)).not.toHaveProperty("ui_language");

  let d = await openEditForm(page, "Sandbox", "Fingerprint");
  await expect(d.getByRole("combobox", { name: FIELD, exact: true })).toContainText("System language");
  await pickOption(d, FIELD, "Same as the profile language");
  await expect(d.getByText("The browser’s menus, settings and dialogs are in the profile’s language too.")).toBeVisible();
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d).toHaveCount(0);
  expect((await stored(page, SANDBOX)).ui_language).toBe("profile");

  // Reopened, the choice is still there.
  d = await openEditForm(page, "Sandbox", "Fingerprint");
  await expect(d.getByRole("combobox", { name: FIELD, exact: true })).toContainText("Same as the profile language");

  // Back to System: the field goes, not "system", so the profile reads as before.
  await pickOption(d, FIELD, "System language");
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d).toHaveCount(0);
  expect(await stored(page, SANDBOX)).not.toHaveProperty("ui_language");
});

test("an unrelated edit leaves an old profile without the field", async ({ page }) => {
  await openApp(page);
  const d = await openEditForm(page, "Sandbox");
  await d.getByRole("textbox", { name: "Name" }).fill("Sandbox two");
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d).toHaveCount(0);
  const after = await stored(page, SANDBOX);
  expect(after.name).toBe("Sandbox two");
  expect(after).not.toHaveProperty("ui_language");
});
