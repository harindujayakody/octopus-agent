import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, openEditForm } from "./support/app";

// Owner feedback 5n (2026-09-26, relayed by shard-64, screenshot of a
// Profiles row's Proxy cell: flag, "SOCKS5", "111:222"): "looks like we have
// different size texts here on the proxy label in the row." Cause: the type
// was `text-[10.5px] font-semibold` while the address next to it was mono
// `text-paragraph-xs` (12 px) — two sizes, two baselines. One shared look
// (src/shared/ui/ProxyAddress.tsx, ProxyKind) everywhere a proxy's type and
// address show, in one cell or two adjacent columns.
//
// The bulk importer (src/features/manage-proxies/ui/ProxyBulkImporter.tsx)
// also got this same look (its Badge swapped for ProxyKind). This spec does
// not check it there: a look-only change, covered by the type check and a
// manual read of the diff.

const profileRow = (page: Page, name: string) =>
  page.locator("[role='row'][data-profile-id]").filter({ has: page.locator("[data-cell='name']").getByText(name, { exact: true }) });
const proxyRow = (page: Page, name: string) => page.locator("[role='row'][data-proxy-id]", { hasText: name });

async function fontSize(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).fontSize);
}
async function bottomOf(locator: Locator): Promise<number> {
  return locator.evaluate((el) => el.getBoundingClientRect().bottom);
}
async function assertOneBaseline(kind: Locator, address: Locator) {
  expect(await fontSize(kind)).toBe("12px");
  expect(await fontSize(address)).toBe("12px");
  const [kindBottom, addressBottom] = [await bottomOf(kind), await bottomOf(address)];
  expect(Math.abs(kindBottom - addressBottom)).toBeLessThanOrEqual(1);
}

// F7 (Task 17): the Profiles row's Proxy cell names the proxy now; its type
// and address are in the cell's tooltip (row-details.spec.ts).

/** Where a text's own glyph box ends, not its element's (a chip adds padding). */
const textBottom = (l: Locator) =>
  l.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return [...range.getClientRects()].at(-1)!.bottom;
  });

test("Proxies row: the type chip's word and the address share one size and baseline, even though they stay separate cells", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const row = proxyRow(page, "DC Tokyo");
  // Live layer (Task 6): the type is a protocol chip now; its word keeps
  // the address's size and line.
  const kind = row.locator("[data-cell='type'] [data-pill='protocol']");
  const address = row.locator("[data-cell='address']");
  expect(await fontSize(kind)).toBe("12px");
  expect(await fontSize(address)).toBe("12px");
  expect(Math.abs((await textBottom(kind)) - (await textBottom(address)))).toBeLessThanOrEqual(1);
});

test("the profile form's new-proxy preview shares the same type look", async ({ page }) => {
  await openApp(page);
  // Sandbox has no proxy today. The form's Proxy tab keeps a pasted line for
  // its Save, and shows what it understood under the line.
  const form = await openEditForm(page, "Sandbox", "Proxy");
  await form.locator("[data-property='proxy'] button").click();
  await page.getByRole("button", { name: "Add a new proxy" }).click();
  const panel = page.getByRole("dialog", { name: "Add a new proxy" });
  await panel.getByRole("textbox", { name: "Proxy line" }).fill("socks5://1.2.3.4:1080");
  const kind = panel.locator("[data-role='proxy-kind']");
  await expect(kind).toHaveText("SOCKS5");
  expect(await fontSize(kind)).toBe("12px");
});
