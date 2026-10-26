import { expect, test, type Page } from "@playwright/test";
import { appModule, openApp } from "./support/app";

// Audit Phase G3 (WRITE-02): a danger confirm asks a question that names the
// object, says what happens and whether it can be undone, and its button is
// verb plus object. Stores open the confirms here, so the test does not
// depend on which button or menu leads to them. Deletes wait behind an Undo
// toast that names the object (F37, F38).
const ask = (page: Page) => page.getByRole("alertdialog");
type TrashStore = { getState(): { items: { name: string }[]; purge(e: unknown): Promise<void>; empty(): Promise<void> } };

test("Delete for good names the profile and says it can’t be undone", async ({ page }) => {
  await openApp(page, { section: "trash" });
  await appModule(page, "/src/entities/trash/index.ts", "__tr");
  const name = await page.evaluate(() => {
    const s = (window as unknown as { __tr: { useTrash: TrashStore } }).__tr.useTrash.getState();
    void s.purge(s.items[0]);
    return s.items[0].name;
  });
  await expect(ask(page)).toHaveAccessibleName(`Delete “${name}” for good?`);
  await expect(ask(page)).toHaveAccessibleDescription(/cookies, logins and site storage are deleted\. You can’t undo this\./i);
  await expect(ask(page).getByRole("button", { name: "Delete for good" })).toBeVisible();
});

test("Empty Trash says how many and that it can’t be undone", async ({ page }) => {
  await openApp(page, { section: "trash" });
  await appModule(page, "/src/entities/trash/index.ts", "__tr");
  const n = await page.evaluate(() => {
    const s = (window as unknown as { __tr: { useTrash: TrashStore } }).__tr.useTrash.getState();
    void s.empty();
    return s.items.length;
  });
  await expect(ask(page)).toHaveAccessibleName("Empty Trash?");
  await expect(ask(page)).toHaveAccessibleDescription(n === 1 ? /1 profile is deleted for good/ : new RegExp(`${n} profiles are deleted for good`));
  await expect(ask(page).getByRole("button", { name: "Empty Trash" })).toBeVisible();
});

test("regenerating one fingerprint names the profile", async ({ page }) => {
  await openApp(page);
  await appModule(page, "/src/entities/profile/index.ts", "__p");
  await page.evaluate(() => {
    const s = (window as unknown as { __p: { useProfile: { getState(): { profiles: { id: string; name: string }[]; regenerateFingerprints(ids: string[]): Promise<number> } } } }).__p.useProfile.getState();
    void s.regenerateFingerprints([s.profiles.find((p) => p.name === "Sandbox")!.id]);
  });
  const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog"));
  await expect(dialog).toHaveAccessibleName("Regenerate the fingerprint of “Sandbox”?");
  await expect(dialog.getByRole("button", { name: "Regenerate fingerprint" })).toBeVisible();
});

test("a name with quotes and markup shows as typed in the Undo toast", async ({ page }) => {
  const odd = "Tom’s <b>shop</b> \"EU\"";
  await openApp(page);
  await appModule(page, "/src/entities/profile/index.ts", "__p");
  await page.evaluate((name) => {
    const s = (window as unknown as { __p: { useProfile: { getState(): { profiles: { id: string; name: string }[]; renameProfile(id: string, n: string): Promise<unknown> } } } }).__p.useProfile.getState();
    return s.renameProfile(s.profiles.find((p) => p.name === "Sandbox")!.id, name);
  }, odd);
  const row = page.locator("[role='row'][data-profile-id]", { hasText: "Tom’s <b>shop</b>" });
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await expect(page.locator("[data-toast]").filter({ hasText: `Moved “${odd}” to Trash` })).toBeVisible();
  await expect(page.locator("[data-toast] b")).toHaveCount(0);
});
