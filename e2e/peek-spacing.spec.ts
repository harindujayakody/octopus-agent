import { expect, test, type Locator } from "@playwright/test";
import { openApp, openEditForm } from "./support/app";

// Owner feedback 5h (2026-09-26): "peek with editing profiles or other
// stuff must have a bit more spacing between elements so it's not so
// crushed together." Measuring outer wrapper/control boxes (via role or
// label) is enough here since the fields don't overlap. Peek only shows
// since manual save; the fields are in the profile form and the Edit proxy
// dialog.
const bottom = async (loc: Locator) => (await loc.boundingBox())!.y + (await loc.boundingBox())!.height;
const top = async (loc: Locator) => (await loc.boundingBox())!.y;

test("Profile Peek: each property is a row of its own, Notes too", async ({ page }) => {
  await openApp(page);
  await page.locator("[role='row'][data-profile-id]", { hasText: "Amazon US seller" })
    .locator("[data-cell='name']").click();
  const peek = page.locator("aside[data-peek]");
  await expect(peek).toBeVisible();
  const section = peek.locator("[data-peek-section='profile']");

  // Task 14 (CRAFT-01): label and value rows, 32 px each, none overlapping.
  const rows = section.locator("[data-property]");
  let last = 0;
  for (let i = 0; i < (await rows.count()); i++) {
    const b = (await rows.nth(i).boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(32 - 0.5);
    expect(b.y).toBeGreaterThanOrEqual(last - 0.5);
    last = b.y + b.height;
  }
  // Notes is the sheet's last row, shown as text (nothing to type into here)
  // that is as tall as its text (merge point 4 review, I7).
  const notes = section.locator("[data-property='notes']");
  await expect(rows.last()).toHaveAttribute("data-property", "notes");
  await expect(section.locator("input, textarea")).toHaveCount(0);
  const [noteRow, noteText] = [(await notes.boundingBox())!, (await notes.locator("span").last().boundingBox())!];
  expect(noteText.y + noteText.height).toBeLessThanOrEqual(noteRow.y + noteRow.height + 0.5);
});

test("Edit proxy: fields have room", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  await page.locator("[role='row'][data-proxy-id]", { hasText: "DC Tokyo" })
    .locator("[data-cell='name']").click();
  await page.locator("aside[data-peek='proxy'] [data-peek-header]").getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit DC Tokyo", exact: true });
  // Measured once it has scaled in (it opens from 0.96).
  await expect(dialog).toHaveAttribute("data-state", "open");

  // Between the Name field's control and the Type/Country row: the dialogs'
  // field gap, gap-4, which is 14 px at the launcher's 14 px root (the New
  // folder dialog's body holds the same 14, density.spec.ts). Peek's own
  // 16 px (owner feedback 5h) went with its fields.
  const nameControl = dialog.getByLabel("Name", { exact: true });
  const typeLabel = dialog.getByText("Type", { exact: true });
  const gap = (await top(typeLabel)) - (await bottom(nameControl));
  expect(gap).toBeGreaterThanOrEqual(14 - 0.5);

  // Fix round 1 (I1): the kit-labelled Name field is 6px too
  // (Field.tsx's `wrapperClassName="gap-[6px]"` applies here as well).
  const nameLabel = dialog.getByText("Name", { exact: true });
  const kitLabelGap = (await top(nameControl)) - (await bottom(nameLabel));
  expect(kitLabelGap).toBeGreaterThanOrEqual(6 - 0.5);
  expect(kitLabelGap).toBeLessThanOrEqual(6 + 0.5);
});

// The widened editor's three columns are gone: the profile form's Fingerprint
// tab stacks its three groups in one column. The label-to-control distance
// of its fields is what stays.
test("Profile form, Fingerprint tab: a field's label sits 6 px over its control", async ({ page }) => {
  await openApp(page);
  const form = await openEditForm(page, "Amazon US seller", "Fingerprint");
  // Measured once it has scaled in (it opens from 0.96).
  await expect(form).toHaveAttribute("data-state", "open");

  // A field's label-to-control distance: the OS field (a plain app-level
  // label, not a kit Input) is 6px.
  const osLabel = form.getByText("Operating system", { exact: true });
  const osControl = form.getByRole("radiogroup", { name: "Operating system" });
  const labelGap = (await top(osControl)) - (await bottom(osLabel));
  expect(labelGap).toBeGreaterThanOrEqual(6 - 0.5);
  expect(labelGap).toBeLessThanOrEqual(6 + 0.5);
  // The three groups follow one another down one column, none beside another.
  const headings = ["Hardware and screen", "Locale and noise", "Privacy and media"].map((name) => form.getByRole("heading", { name }));
  const boxes: { x: number; y: number }[] = [];
  for (const h of headings) boxes.push((await h.boundingBox())!);
  for (const b of boxes.slice(1)) expect(Math.abs(b.x - boxes[0].x)).toBeLessThanOrEqual(0.5);
  expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
  expect(boxes[2].y).toBeGreaterThan(boxes[1].y);
});
