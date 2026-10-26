import { expect, test, type Locator } from "@playwright/test";
import { openApp } from "./support/app";

// Owner feedback (2026-09-26): a Profiles row's selection checkbox sat above
// the row's middle. Cause: the kit Checkbox root is an inline-flex <label>
// at the default `vertical-align: baseline`, so the checkbox cell's line box
// adds descender space under it, pushing the checkbox's own center up
// (measured 2.5px high in a 36px row). `align-top` on the label removes
// that added space so the outer row's `align-items: center` centers the
// checkbox for real.

const VIEWPORTS = [
  { name: "default window", size: null as { width: number; height: number } | null },
  { name: "1728 x 1117, a wide window", size: { width: 1728, height: 1117 } },
];

async function verticalCenter(loc: Locator): Promise<number> {
  const box = await loc.boundingBox();
  if (!box) throw new Error("element has no bounding box (not rendered?)");
  return box.y + box.height / 2;
}

/** Asserts `checkboxInput`'s vertical center matches `rowEl`'s, within 0.5px. */
async function expectCheckboxCentered(rowEl: Locator, checkboxInput: Locator) {
  const rowCenter = await verticalCenter(rowEl);
  const boxCenter = await verticalCenter(checkboxInput);
  expect(Math.abs(rowCenter - boxCenter)).toBeLessThanOrEqual(0.5);
}

for (const { name, size } of VIEWPORTS) {
  test(`Profiles: header and first three row checkboxes center on their row (${name})`, async ({ page }) => {
    await openApp(page);
    if (size) await page.setViewportSize(size);

    const header = page.locator("[role='row'][aria-rowindex='1']");
    await expectCheckboxCentered(header, header.locator("input[type='checkbox']"));

    const rows = page.locator("[role='row'][data-profile-id]");
    for (let i = 0; i < 3; i++) {
      const row = rows.nth(i);
      await expectCheckboxCentered(row, row.locator("input[type='checkbox']"));
    }
  });

  test(`Proxies: header and first two row checkboxes center on their row (${name})`, async ({ page }) => {
    await openApp(page, { section: "proxies" });
    if (size) await page.setViewportSize(size);

    const header = page.locator("[role='row'][aria-rowindex='1']");
    await expectCheckboxCentered(header, header.locator("input[type='checkbox']"));

    const rows = page.locator("[role='row'][data-proxy-id]");
    for (let i = 0; i < 2; i++) {
      const row = rows.nth(i);
      await expectCheckboxCentered(row, row.locator("input[type='checkbox']"));
    }
  });
}
