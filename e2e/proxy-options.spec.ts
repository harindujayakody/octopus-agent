import { expect, test, type Page } from "@playwright/test";
import { openApp, openDisplay, openEditForm, reloadApp, row, seed, titles } from "./support/app";
import { composite, contrast, parseColor } from "./support/color";

// Owner item 11 (2026-10-07): Proxy is an always-shown column, and proxies in
// a picker are told apart: three "standart resi" with the same name showed no
// difference, and rows without a flag shifted their names.

type Proxy = { id: string; name: string; kind: string; host: string; port: number; username: string; password: string; country: string; notes: string };
type Mock = {
  __shardxMock: {
    state: { proxies: Proxy[]; profiles: Record<string, { _meta: { proxy_id: string | null } }> };
    save: () => void;
  };
};
const SANDBOX = "f62a9d43";
const cellOf = (page: Page, name: string, id: string) => row(page, name).locator(`[data-cell='${id}']`);

/** Three proxies with one name, and one named proxy with no country; Sandbox on the last. */
async function seedProxies(page: Page, { sandboxOn }: { sandboxOn?: string } = {}) {
  await page.evaluate((on) => {
    const mock = (window as unknown as Mock).__shardxMock;
    const base = mock.state.proxies[0];
    mock.state.proxies.push(
      { ...base, id: "px-sr-1", name: "standart resi", host: "198.51.100.21", port: 8000, country: "US" },
      { ...base, id: "px-sr-2", name: "standart resi", host: "198.51.100.22", port: 8000, country: "DE" },
      { ...base, id: "px-sr-3", name: "standart resi", host: "198.51.100.23", port: 8000, country: "" },
      { ...base, id: "px-nc", name: "Unflagged", host: "198.51.100.30", port: 9000, country: "" },
    );
    if (on) mock.state.profiles["f62a9d43"]._meta.proxy_id = on;
    mock.save();
  }, sandboxOn);
  await reloadApp(page);
}

async function openCellPicker(page: Page, name = "Sandbox") {
  const proxy = cellOf(page, name, "proxy");
  await proxy.hover({ position: { x: 4, y: 18 } });
  await proxy.getByRole("button", { name: `Edit proxy for ${name}` }).click();
  const picker = page.getByRole("dialog", { name: "Proxy", exact: true });
  await expect(picker).toBeVisible();
  return picker;
}

test("Proxy is \"Always shown\" and cannot be hidden", async ({ page }) => {
  await openApp(page);
  const display = await openDisplay(page);
  const box = display.getByRole("checkbox", { name: "Proxy", exact: true });
  await expect(box).toBeChecked();
  await expect(box).toBeDisabled();
  await expect(box).toHaveAccessibleDescription("Always shown");
});

test("a layout saved with Proxy hidden shows it again", async ({ page }) => {
  await seed(page, "shardx.profiles.layout", { v: 2, order: ["name", "status", "folder", "tags", "proxy", "notes"], hidden: ["proxy", "folder"], widths: {} });
  await openApp(page);
  const shown = await titles(page);
  expect(shown).toContain("Proxy");
  expect(shown).not.toContain("Folder");
});

test("three proxies named \"standart resi\" show distinct hints", async ({ page }) => {
  await openApp(page);
  await seedProxies(page);
  const picker = await openCellPicker(page);
  await picker.getByRole("combobox", { name: "Proxy", exact: true }).fill("standart");
  const options = page.getByRole("option", { name: /standart resi/ });
  await expect(options).toHaveCount(3);
  // Address and country code when it is known; the address alone when it is not.
  await expect(options.nth(0)).toContainText("198.51.100.21:8000, US");
  await expect(options.nth(1)).toContainText("198.51.100.22:8000, DE");
  await expect(options.nth(2)).toContainText("198.51.100.23:8000");
  await expect(options.nth(2)).not.toContainText(", ");
  // A name that is unique keeps its plain address hint.
  await picker.getByRole("combobox", { name: "Proxy", exact: true }).fill("Tokyo");
  await expect(page.getByRole("option", { name: /DC Tokyo/ })).toContainText("203.0.113.90:1080");
  await expect(page.getByRole("option", { name: /DC Tokyo/ })).not.toContainText("JP");
});

test("the profile form's proxy picker tells same-name proxies apart too", async ({ page }) => {
  await openApp(page);
  await seedProxies(page);
  const form = await openEditForm(page, "Sandbox", "Proxy");
  await form.locator("[data-property='proxy'] button").click();
  const options = page.getByRole("option", { name: /standart resi/ });
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toContainText("198.51.100.21:8000, US");
  await expect(options.nth(1)).toContainText("198.51.100.22:8000, DE");
  await expect(options.nth(2)).toContainText("198.51.100.23:8000");
});

test("the profile form's proxy picker keeps \"Used by N profiles\" beside the address of a same-name proxy", async ({ page }) => {
  await openApp(page);
  // Three profiles other than Sandbox: one on the first "standart resi", two on the second.
  await page.evaluate(() => {
    const mock = (window as unknown as Mock).__shardxMock;
    const others = Object.keys(mock.state.profiles).filter((id) => id !== "f62a9d43");
    mock.state.profiles[others[0]]._meta.proxy_id = "px-sr-1";
    mock.state.profiles[others[1]]._meta.proxy_id = "px-sr-2";
    mock.state.profiles[others[2]]._meta.proxy_id = "px-sr-2";
  });
  await seedProxies(page);
  const form = await openEditForm(page, "Sandbox", "Proxy");
  await form.locator("[data-property='proxy'] button").click();
  const options = page.getByRole("option", { name: /standart resi/ });
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toContainText("198.51.100.21:8000, US, Used by 1 profile");
  await expect(options.nth(1)).toContainText("198.51.100.22:8000, DE, Used by 2 profiles");
  // Free: the address alone.
  await expect(options.nth(2)).toContainText("198.51.100.23:8000");
  await expect(options.nth(2)).not.toContainText("Used by");
});

test("option labels line up with and without a flag", async ({ page }) => {
  await openApp(page);
  await seedProxies(page);
  const picker = await openCellPicker(page);
  const labelX = async (name: RegExp) => {
    const label = page.getByRole("option", { name }).locator("span.truncate").first();
    return (await label.boundingBox())!.x;
  };
  const flagged = await labelX(/^DC Tokyo/);
  expect(await labelX(/^No proxy/)).toBeCloseTo(flagged, 0);
  expect(await labelX(/^Unflagged/)).toBeCloseTo(flagged, 0);
  // A proxy with no country has the globe in the flag's place.
  await expect(page.getByRole("option", { name: /^Unflagged/ }).locator("[data-flag-fallback]")).toBeVisible();
  await expect(page.getByRole("option", { name: /^DC Tokyo/ }).locator("[data-flag]")).toBeVisible();
  await expect(picker).toBeVisible();
});

test("a proxy with no country shows a globe in the cell, and its name lines up with a flagged one", async ({ page }) => {
  await openApp(page);
  await seedProxies(page, { sandboxOn: "px-nc" });
  const cell = cellOf(page, "Sandbox", "proxy");
  await expect(cell).toContainText("Unflagged");
  await expect(cell.locator("[data-flag-fallback]")).toBeVisible();
  await expect(cell.locator("[data-flag]")).toHaveCount(0);
  const flagged = page.locator("[data-cell='proxy']", { has: page.locator("[data-flag]") }).first().locator("[data-proxy-name]");
  const x = (await cell.locator("[data-proxy-name]").boundingBox())!.x;
  expect(x).toBeCloseTo((await flagged.boundingBox())!.x, 0);
});

test("the cell picker ends with Add a new proxy, which opens the profile form on the Proxy tab", async ({ page }) => {
  await openApp(page);
  const picker = await openCellPicker(page);
  await picker.getByRole("button", { name: "Add a new proxy" }).click();
  await expect(picker).toHaveCount(0);
  const form = page.getByRole("dialog", { name: "Edit Sandbox", exact: true });
  await expect(form).toBeVisible();
  await expect(form.getByRole("tab", { name: "Proxy", exact: true })).toHaveAttribute("aria-selected", "true");
});

// Review M1: the icon slot follows all the options, not the rows a query leaves.
test("the labels do not move when a query filters out every flagged proxy", async ({ page }) => {
  await openApp(page);
  await seedProxies(page);
  const picker = await openCellPicker(page);
  const labelX = async (name: RegExp) => (await page.getByRole("option", { name }).locator("span.truncate").first().boundingBox())!.x;
  const before = await labelX(/^No proxy/);
  await picker.getByRole("combobox", { name: "Proxy", exact: true }).fill("no proxy");
  await expect(page.getByRole("option")).toHaveCount(1);
  expect(await labelX(/^No proxy/)).toBeCloseTo(before, 0);
  await picker.getByRole("combobox", { name: "Proxy", exact: true }).fill("");
  await expect(page.getByRole("option").nth(1)).toBeVisible();
  expect(await labelX(/^No proxy/)).toBeCloseTo(before, 0);
});

// Review I1: on a highlighted option the globe is the sub icon gray, 3:1 on the row's fill (dark).
test("dark: the globe keeps 3:1 on a highlighted option", async ({ page }) => {
  await openApp(page, { theme: "dark" });
  await seedProxies(page);
  const picker = await openCellPicker(page);
  const option = page.getByRole("option", { name: /^Unflagged/ });
  await option.hover();
  await expect(option).toHaveAttribute("data-highlighted", "");
  const { popover, rowFill, icon } = await option.evaluate((el) => ({
    popover: getComputedStyle(el.closest("[role='dialog']")!).backgroundColor,
    rowFill: getComputedStyle(el).backgroundColor,
    icon: getComputedStyle(el.querySelector("[data-flag-fallback]")!).color,
  }));
  const onRow = composite(parseColor(rowFill), parseColor(popover).slice(0, 3) as [number, number, number]);
  expect(contrast(parseColor(icon).slice(0, 3) as [number, number, number], onRow)).toBeGreaterThanOrEqual(3);
  await expect(picker).toBeVisible();
});
