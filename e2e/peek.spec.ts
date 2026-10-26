import { expect, test, type Page } from "@playwright/test";
import { expectScrollsInCard, openApp, pressCreate, seedATag } from "./support/app";

const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });
const peek = (page: Page) => page.locator("aside[data-peek]");
const calls = (page: Page, cmd: string) =>
  page.evaluate((c) => (window as unknown as { __shardxMock: { calls: Record<string, number> } }).__shardxMock.calls[c] ?? 0, cmd);
const SANDBOX = "f62a9d43";
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name, exact: true });
const peekSection = (page: Page, id: string) => peek(page).locator(`[data-peek-section='${id}']`);
/** The section's own Edit link (not the header's Edit button). */
const sectionEdit = (page: Page, id: string) => peekSection(page, id).getByRole("button", { name: "Edit", exact: true });

test("clicking a name opens Peek beside the list", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: Etsy craft shop");
  // F1: the cookie actions moved to the header's … menu (IFACE-12); the
  // Proxy and Extensions sections are rows of the Profile section (Task 14).
  for (const s of ["profile", "fingerprint", "activity"]) {
    await expect(peek(page).locator(`[data-peek-section='${s}']`)).toBeVisible();
  }
  // At 1280 px Peek pushes the list: its card ends before Peek, and the row
  // Peek shows keeps its Name and its row actions inside the card (a list
  // wider than its card scrolls inside it, owner decision 2026-09-26).
  const card = (await page.getByRole("treegrid", { name: "Profiles" }).boundingBox())!;
  const peekBox = (await peek(page).boundingBox())!;
  expect(card.x + card.width).toBeLessThanOrEqual(peekBox.x + 1);
  for (const id of ["name", "actions"]) {
    const b = (await row(page, "Etsy craft shop").locator(`[data-cell='${id}']`).boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(card.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(card.x + card.width + 1);
  }
});

test("Peek open at 1280 x 800: every column stays, the list scrolls inside its card with Name and the row actions pinned, and Name isn't truncated", async ({ page }) => {
  // Tags shows once a tag exists (Pair 27, F20): the six data columns, as before.
  await seedATag(page);
  await openApp(page);
  await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
  await expect(peek(page)).toBeVisible();
  const grid = page.getByRole("treegrid", { name: "Profiles" });
  // The select box, the six data columns and the actions.
  await expect(grid.locator("[role='row'][aria-rowindex='1'] [role='columnheader']")).toHaveCount(8);
  await expectScrollsInCard(page, grid, row(page, "Sandbox"), "Pin");
  // Name gives way last (controller ruling, Pair 31): every other column no
  // one sized goes to its minimum first, so the longest pinned name, with
  // its pin icon, stays whole at Name's own width.
  const name = row(page, "Amazon US seller").locator("[data-cell='name'] span.truncate");
  const nameWidths = await name.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(nameWidths.scrollWidth).toBeLessThanOrEqual(nameWidths.clientWidth);
});

/** The screen's pixels along one line `y` of the page, from `x0` to `x1`: their red channel (the surfaces here are gray). */
async function pixelsAlong(page: Page, y: number, x0: number, x1: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x: x0, y, width: x1 - x0, height: 1 } });
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const img = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const ctx = new OffscreenCanvas(img.width, img.height).getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, 1).data;
    return Array.from({ length: img.width }, (_, i) => d[i * 4]);
  }, png.toString("base64"));
}

// Owner bug (2026-09-28): with Peek open the list scrolls sideways, and on
// every resting row and on the header the row actions read as a darker,
// shadowed band; the hovered and Peek rows, whose hover strip covers the
// edge, did not. A resting row and the header are one surface across the
// pinned row actions: no edge shadow, no fill of their own.
for (const [theme, section] of [["dark", "profiles"], ["light", "profiles"], ["dark", "proxies"]] as const) {
  test(`with Peek open, a resting row and the header are one surface across the pinned row actions (${theme}, ${section})`, async ({ page }) => {
    await openApp(page, { theme, section });
    const rows = page.locator(section === "profiles" ? "[role='row'][data-profile-id]" : "[role='row'][data-proxy-id]");
    await rows.first().locator("[data-cell='name']").click();
    await expect(page.locator("aside[data-peek]")).toBeVisible();
    const grid = page.getByRole("treegrid");
    await expect(grid).toHaveAttribute("data-x-more", "");
    await page.mouse.move(0, 0);
    const card = (await grid.boundingBox())!;
    for (const r of [grid.locator("[role='row'][aria-rowindex='1']"), rows.last()]) {
      const box = (await r.boundingBox())!;
      const end = (await r.locator(".list-pin-end").boundingBox())!;
      // Near the row's top edge, clear of any text: from 16 px before the
      // pinned part to 40 px into it, stopping clear of the card's edge
      // (Proxies' pinned part is only the Columns button's 24 px since merge
      // point 3), against a point in the row's middle.
      const y = Math.round(box.y + 3);
      const [surface] = await pixelsAlong(page, y, Math.round(card.x + 120), Math.round(card.x + 121));
      const across = await pixelsAlong(page, y, Math.round(end.x - 16), Math.floor(Math.min(end.x + 40, card.x + card.width - 4)));
      expect(across.filter((v) => Math.abs(v - surface) > 1), `surface ${surface}: ${across.join(",")}`).toEqual([]);
    }
  });
}

test("panel shows values, no inputs", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  // The fingerprint rows come with the form.
  await expect(peek(page).locator("[data-property='os']")).toBeVisible();
  for (const role of ["textbox", "combobox", "searchbox", "spinbutton"] as const) {
    await expect(peek(page).getByRole(role), role).toHaveCount(0);
  }
  await expect(peek(page).locator("input, textarea, select")).toHaveCount(0);
  // The name is a heading, the values are text.
  await expect(peek(page).locator("[data-peek-header]").getByRole("heading", { level: 2 })).toHaveText("Sandbox");
  await expect(peekSection(page, "profile").locator("[data-property='notes']")).toContainText("Throwaway. Direct connection.");
  await expect(peekSection(page, "profile").locator("[data-property='folder']")).toContainText("No folder");
  await expect(peekSection(page, "fingerprint").locator("[data-property='timezone']")).toContainText("Auto (from proxy)");
  // Nothing was written by looking.
  expect(await calls(page, "profile_save")).toBe(0);
});

test("Edit opens the form, and opening Peek or the form writes nothing", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  const edit = peek(page).locator("[data-peek-header]").getByRole("button", { name: "Edit", exact: true });
  await expect(edit).toBeVisible();
  await edit.click();
  const d = dialog(page, "Edit Sandbox");
  await expect(d.getByRole("tab", { name: "Basics" })).toHaveAttribute("aria-selected", "true");
  await expect(d.getByRole("textbox", { name: "Name" })).toHaveValue("Sandbox");
  expect(await calls(page, "profile_save")).toBe(0);
  await d.getByRole("button", { name: "Cancel" }).click();
  await expect(d).toHaveCount(0);
  // Peek stays where it was.
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: Sandbox");
});

test("section Edit opens its tab; Proxy and Extensions values open theirs", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  const d = dialog(page, "Edit Sandbox");
  const cases: [() => ReturnType<Page["locator"]>, string][] = [
    [() => sectionEdit(page, "profile"), "Basics"],
    [() => sectionEdit(page, "fingerprint"), "Fingerprint"],
    [() => peekSection(page, "profile").locator("[data-property='proxy'] button"), "Proxy"],
    [() => peekSection(page, "profile").locator("[data-property='extensions'] button"), "Extensions"],
  ];
  for (const [open, tab] of cases) {
    await open().click();
    await expect(d.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
    await expect(peek(page)).toBeVisible();
  }
});

test("Edit fingerprint opens the Fingerprint tab and the list stays visible", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  await expect(peek(page).locator("[data-property='os']")).toBeVisible();
  await sectionEdit(page, "fingerprint").click();
  const d = dialog(page, "Edit Sandbox");
  await expect(d.getByRole("tab", { name: "Fingerprint" })).toHaveAttribute("aria-selected", "true");
  await expect(d.getByRole("heading", { name: "Hardware and screen" })).toBeVisible();
  // No widened panel: Peek keeps its place beside the list, which is still there.
  await expect(peek(page)).not.toHaveAttribute("data-expanded", /.*/);
  const grid = (await page.getByRole("treegrid", { name: "Profiles" }).boundingBox())!;
  const panel = (await peek(page).boundingBox())!;
  expect(panel.width).toBeLessThanOrEqual(421);
  expect(grid.x + grid.width).toBeLessThanOrEqual(panel.x + 1);
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
  await expect(page.getByRole("treegrid", { name: "Profiles" })).toBeVisible();
  await expect(peek(page)).toBeVisible();
});

test("arrow keys move Peek to the next profile, and nothing is written", async ({ page }) => {
  await openApp(page);
  await row(page, "Etsy craft shop").locator("[data-cell='name']").click();
  // With Peek beside it the list shows fewer columns; the status cell stays.
  await row(page, "Etsy craft shop").locator("[data-cell='status']").click();
  await page.keyboard.press("ArrowDown");
  await expect(peek(page)).toHaveAttribute("aria-label", "Peek: FB Ads acc-02");
  await expect(peekSection(page, "profile").locator("[data-property='notes']")).toBeVisible();
  expect(await calls(page, "profile_save")).toBe(0);
});

test("Start no longer waits for a flush", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  await peek(page).getByRole("button", { name: "Start" }).click();
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { __shardxMockLaunches?: { id: string; proxy_id: string | null }[] }).__shardxMockLaunches ?? [],
  )).toEqual([{ id: SANDBOX, proxy_id: null }]);
  expect(await calls(page, "profile_save")).toBe(0);
});

test("Enter opens Peek on the active row; Esc closes it and then clears the selection", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='checkbox'] input").check({ force: true });
  // The pointer makes it the target; a click would open Peek already (O5).
  await row(page, "Sandbox").locator("[data-cell='status']").hover();
  await row(page, "Sandbox").focus();
  await page.keyboard.press("Enter");
  await expect(peek(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(peek(page)).toHaveCount(0);
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("[role='row'][aria-selected='true']")).toHaveCount(0);
});

test("the Proxy value opens the form on the Proxy tab; Save binds it", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  await peek(page).locator("[data-property='proxy'] button").click();
  const d = dialog(page, "Edit Sandbox");
  await expect(d.getByRole("tab", { name: "Proxy", exact: true })).toHaveAttribute("aria-selected", "true");
  await d.locator("[data-property='proxy'] button").click();
  await page.getByRole("option", { name: /DC Tokyo/ }).click();
  // Picked in the form only: the profile is unchanged until Save.
  expect(await calls(page, "profile_save")).toBe(0);
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d).toHaveCount(0);
  await expect(row(page, "Sandbox").locator("[data-cell='proxy']")).toContainText("DC Tokyo", { timeout: 5000 });
  await expect(peek(page).locator("[data-property='proxy']")).toContainText("DC Tokyo");
});

// F1 (CRAFT-01): the note is the status pill's tooltip now, and read with it.
test("a running profile's Peek says changes apply at the next start", async ({ page }) => {
  await openApp(page);
  await row(page, "Amazon US seller").locator("[data-cell='name']").click();
  await peek(page).locator("[data-peek-run-status]").hover();
  await expect(page.getByRole("tooltip")).toHaveText("Changes apply the next time it starts.");
});

test("New profile in the header does the same, once the form creates it", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "New profile" }).click();
  await pressCreate(page);
  await expect(peek(page)).toHaveAttribute("aria-label", /Peek: Profile \d+/);
});

test("C opens the form on a new profile in the current Folder; Create profile opens it in Peek", async ({ page }) => {
  await openApp(page);
  await page.locator("aside [data-folder='Ads']").click();
  await page.locator("main").click({ position: { x: 600, y: 700 } });
  await page.keyboard.press("c");
  await pressCreate(page);
  await expect(peek(page)).toHaveAttribute("aria-label", /Peek: Profile \d+/);
  // No widened Peek: the new profile opens at the panel's own width.
  await expect(peek(page)).not.toHaveAttribute("data-expanded", /.*/);
  expect((await peek(page).boundingBox())!.width).toBeLessThanOrEqual(421);
  await expect(page.locator("aside [data-folder='Ads'] [data-count]")).toHaveText("4");
  const created = await page.evaluate(() => {
    const s = (window as unknown as { __shardxMock: { state: { order: string[]; profiles: Record<string, { name: string; _meta: { proxy_id: string | null; gpu_preset_id: string; folder: string } }> } } }).__shardxMock.state;
    return s.profiles[s.order[s.order.length - 1]];
  });
  expect(created._meta.proxy_id).toBeNull();
  expect(created._meta.folder).toBe("Ads");
  expect(created._meta.gpu_preset_id).toMatch(/^mac-/);
});

test("the header has no template dialog any more", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("main header").getByRole("combobox", { name: "Based on" })).toHaveCount(0);
});


test("a section title reads apart from the property labels under it", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  const section = peek(page).locator("[data-peek-section='profile']");
  const title = section.locator("h3");
  const label = section.locator("[data-property='folder']").getByText("Folder", { exact: true });
  const style = (l: typeof title) => l.evaluate((el) => {
    const c = getComputedStyle(el);
    return [c.color, c.fontSize, c.fontWeight, c.textTransform].join(" ");
  });
  expect(await style(title)).not.toBe(await style(label));
  // The section label is sentence case now (vf-c, merge point 12: no caps,
  // no positive tracking); its medium weight sets it apart.
  expect(await title.evaluate((el) => getComputedStyle(el).textTransform)).toBe("none");
  expect(await title.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("500");
  // "Proxy" is said once: its row's label.
  await expect(section.getByText("Proxy", { exact: true })).toHaveCount(1);
});

// Task 14: Copy ID is an item of the header's … menu, as in the row menu.
test("Copy ID in Peek's … menu copies the ID and says so", async ({ page }) => {
  await openApp(page);
  await row(page, "Sandbox").locator("[data-cell='name']").click();
  await peek(page).locator("[data-peek-header]").getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Copy ID" }).click();
  // The toast, not its live-region copy (C24).
  await expect(page.locator("[data-toast]").getByText("Copied profile ID")).toBeVisible();
});

// Merge point 4 ruling: the property sheet's label column is as wide as the
// longest label in the language shown, so none is cut ("Operating syst…");
// every row shares it, and a label wraps only past 40 % of the sheet.
for (const lang of ["en", "zh", "ru"] as const) {
  test(`Peek's property labels are never cut, one column for all (${lang})`, async ({ page }) => {
    if (lang !== "en") await page.addInitScript((l) => localStorage.setItem("shardx.lang", l), lang);
    await openApp(page);
    await row(page, "Etsy craft shop").focus();
    await page.keyboard.press("Enter");
    const labels = peek(page).locator("[data-property-label]");
    await expect(peek(page).locator("[data-property='os'] [data-property-label]")).toBeVisible();
    const boxes = await labels.evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.textContent, width: Math.round(r.width), height: Math.round(r.height), cut: el.scrollWidth > el.clientWidth };
    }));
    expect(boxes.filter((b) => b.cut || b.height > 32), "cut or wrapped labels").toEqual([]);
    expect(new Set(boxes.map((b) => b.width)).size, "one label column").toBe(1);
  });
}
