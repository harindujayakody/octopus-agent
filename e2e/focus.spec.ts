import { expect, test, type Locator, type Page } from "@playwright/test";
import { openApp, openEditForm, type Theme } from "./support/app";

// Audit Phase B, B2 (ruling 7): focus is a 2 px outline in the focus color,
// drawn at once, on every stop. Task 7 adds the same checks in forced colors.

type Ring = { name: string; style: string; width: string; offset: string; color: string; transition: string; duration: string };

/** The outline that shows the focus: on the focused element, or on its field wrapper (focus-ring-within). */
async function focusRing(page: Page): Promise<Ring> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const target = (el.matches("input, textarea") && el.closest<HTMLElement>(".focus-ring-within")) || el;
    const cs = getComputedStyle(target);
    return {
      name: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? el.tagName,
      style: cs.outlineStyle,
      width: cs.outlineWidth,
      offset: cs.outlineOffset,
      color: cs.outlineColor,
      transition: cs.transitionProperty,
      duration: cs.transitionDuration,
    };
  });
}

/** What fades: the transition's properties that have a duration (the two
 *  lists pair up, the shorter one repeating). An element with no transition
 *  reads `all` at 0s, the initial value, and fades nothing. */
const fading = (r: Ring) => {
  const durations = r.duration.split(/,\s*/);
  return r.transition.split(/,\s*/).filter((_, i) => parseFloat(durations[i % durations.length]) > 0);
};

/** The focus rings of the next `count` Tab stops. */
async function tabStops(page: Page, count: number): Promise<Ring[]> {
  const rings: Ring[] = [];
  for (let i = 0; i < count; i++) {
    await page.keyboard.press("Tab");
    rings.push(await focusRing(page));
  }
  return rings;
}

/** A color as the page computes it; in forced colors `forced-color-adjust:
 *  none` keeps an author color (the focus color) from being repainted. */
const resolve = (page: Page, css: string) =>
  page.evaluate((c) => {
    const probe = document.createElement("span");
    probe.style.color = c;
    probe.style.forcedColorAdjust = "none";
    document.body.appendChild(probe);
    const v = getComputedStyle(probe).color;
    probe.remove();
    return v;
  }, css);

type Outline = { style: string; width: string; offset: string; color: string };
const outlineOf = (l: Locator): Promise<Outline> =>
  l.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { style: cs.outlineStyle, width: cs.outlineWidth, offset: cs.outlineOffset, color: cs.outlineColor };
  });

/** The Profile color swatches in the profile form, opened on Sandbox: the
 *  form's Color row (Basics) opens the shared picker. */
async function colorSwatches(page: Page): Promise<Locator> {
  const form = await openEditForm(page, "Sandbox");
  await form.locator("[data-property='color'] button").click();
  const group = page.getByRole("radiogroup", { name: "Color" });
  await expect(group).toBeVisible();
  return group;
}

/** Etsy craft shop's Folder chip in the list and a Tag chip (seeded) in its Peek. */
async function labelChips(page: Page, theme?: Theme): Promise<Locator[]> {
  await page.addInitScript(() => localStorage.setItem("shardx.tags", JSON.stringify({
    version: 1, tags: [{ id: "t-blue", name: "blue", color: "blue" }], byProfile: { aed41005: ["t-blue"] },
  })));
  await openApp(page, { theme });
  const row = page.locator("[role='row'][data-profile-id='aed41005']");
  const folder = row.locator("[data-cell='folder'] [data-folder-chip]");
  await expect(folder).toBeVisible();
  await row.locator("[data-cell='name']").click();
  const tag = page.locator("aside[data-peek] [data-tag='t-blue']");
  await expect(tag).toBeVisible();
  return [folder, tag];
}
/** Preflight gives every element a 0 px solid border; the edge is its width. */
const edgeOf = (l: Locator) => l.evaluate((el) => getComputedStyle(el).borderTopWidth);

for (const theme of ["light", "dark"] as Theme[]) {
  test(`the first six Tab stops each draw the focus outline, at once (${theme})`, async ({ page }) => {
    await openApp(page, { theme });
    const focus = await resolve(page, "var(--focus)");
    const rings = await tabStops(page, 6);
    expect(rings).toHaveLength(6);
    for (const r of rings) {
      expect(r.style, r.name).toBe("solid");
      expect(r.width, r.name).toBe("2px");
      expect(r.color, r.name).toBe(focus);
      expect(fading(r).filter((p) => p === "all" || p.startsWith("outline")), `${r.name}: ${r.transition} ${r.duration}`).toEqual([]);
    }
  });

  test(`a row reached with the arrow keys draws its ring inside the row (${theme})`, async ({ page }) => {
    await openApp(page, { theme });
    await page.locator("[role='row'][data-profile-id]").first().focus();
    await page.keyboard.press("ArrowDown");
    const r = await focusRing(page);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("row");
    expect(r).toMatchObject({ style: "solid", width: "2px", offset: "-2px", color: await resolve(page, "var(--focus)") });
  });

  test(`the filter field draws the ring on its frame (${theme})`, async ({ page }) => {
    await openApp(page, { theme });
    await page.keyboard.press("/");
    await expect(page.locator("main header").getByRole("searchbox")).toBeFocused();
    const r = await focusRing(page);
    expect(r).toMatchObject({ style: "solid", width: "2px", offset: "-1px", color: await resolve(page, "var(--focus)") });
  });
}

test("a switch in Settings draws the ring on the switch", async ({ page }) => {
  await openApp(page, { section: "settings" });
  await page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name: "Appearance" }).click();
  await page.getByLabel("Reduce motion").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const r = await focusRing(page);
  expect(r).toMatchObject({ style: "solid", width: "2px" });
});

test("a row's More button draws its ring inside the row, which would clip it", async ({ page }) => {
  await openApp(page);
  const more = page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).getByRole("button", { name: "More actions" });
  await more.focus();
  expect(await focusRing(page)).toMatchObject({ style: "solid", width: "2px", offset: "-2px" });
});

test("a colour swatch reached from the keyboard draws the focus outline", async ({ page }) => {
  await openApp(page);
  const swatches = await colorSwatches(page);
  // A radio group: one Tab stop (the chosen one, Automatic for Sandbox), arrows move.
  await swatches.getByRole("radio", { name: "Automatic, from the profile name" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(swatches.getByRole("radio", { name: "Blue" })).toBeFocused();
  expect(await focusRing(page)).toMatchObject({ style: "solid", width: "2px", color: await resolve(page, "var(--focus)") });
});

test("Folder and Tag chips draw no edge outside forced colors", async ({ page }) => {
  for (const chip of await labelChips(page, "light")) expect(await edgeOf(chip)).toBe("0px");
});

// Windows contrast themes: these run in the `forced-colors` project.
test("forced colors: the first six Tab stops and a row still draw a ring", { tag: "@forced" }, async ({ page }) => {
  await openApp(page);
  for (const r of await tabStops(page, 6)) {
    expect(r.style, r.name).not.toBe("none");
    expect(parseFloat(r.width), r.name).toBeGreaterThanOrEqual(2);
  }
  await page.locator("[role='row'][data-profile-id]").first().focus();
  await page.keyboard.press("ArrowDown");
  expect((await focusRing(page)).style).toBe("solid");
});

test("forced colors: a checkbox is the native control and a field keeps its frame", { tag: "@forced" }, async ({ page }) => {
  await openApp(page);
  const box = page.getByRole("treegrid").locator("[role='row'][aria-rowindex='1'] input[type='checkbox']");
  expect(await box.evaluate((el) => getComputedStyle(el).appearance)).toBe("auto");
  // The field was Peek's until the panel became read only (peek-v2, plan
  // ruling 3: "a heading, no field"), so the fields live in the form now.
  const name = (await openEditForm(page)).getByRole("textbox", { name: "Name" });
  const frame = name.locator("xpath=..");
  expect(await frame.evaluate((el) => {
    const cs = getComputedStyle(el);
    return [cs.borderTopStyle, cs.borderTopWidth];
  })).toEqual(["solid", "1px"]);
  // The frame carries the edge and hides the text box's own outline-hidden,
  // which the system would otherwise paint as a ring at rest (frame.ts).
  expect(await name.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
});

test("forced colors: Folder color swatches keep their color, the current section is highlighted", { tag: "@forced" }, async ({ page }) => {
  await openApp(page);
  await page.locator("aside").getByRole("button", { name: "New folder" }).click();
  const violet = page.getByRole("dialog", { name: /New folder/ }).getByRole("radio", { name: "Violet" });
  expect(await violet.evaluate((el) => getComputedStyle(el).forcedColorAdjust)).toBe("none");
  await page.keyboard.press("Escape");
  const current = page.locator("aside [aria-current='page']");
  const highlight = await page.evaluate(() => {
    const p = document.createElement("span");
    p.style.backgroundColor = "Highlight";
    document.body.appendChild(p);
    const v = getComputedStyle(p).backgroundColor;
    p.remove();
    return v;
  });
  expect(await current.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(highlight);
  // Its focus ring is a system color, not the theme's focus color.
  await current.focus();
  expect((await outlineOf(current)).color).toBe(await resolve(page, "CanvasText"));
});

test("forced colors: a focused colour swatch and the chosen one draw their outlines", { tag: "@forced" }, async ({ page }) => {
  await openApp(page);
  const swatches = await colorSwatches(page);
  const chosen = swatches.getByRole("radio", { name: "Violet" });
  const colorRow = page.getByRole("dialog", { name: "Edit Sandbox", exact: true }).locator("[data-property='color'] button");
  // A click picks and closes the picker (Pair 21's Color row): open it again.
  await chosen.click();
  await colorRow.click();
  await expect(chosen).toHaveAttribute("aria-checked", "true");
  await chosen.focus();
  // A radio group: the arrows move the choice and the focus together, and
  // the picker stays open.
  await page.keyboard.press("ArrowRight");
  const focused = swatches.getByRole("radio", { name: "Magenta" });
  await expect(focused).toBeFocused();
  await expect(focused).toHaveAttribute("aria-checked", "true");
  const canvasText = await resolve(page, "CanvasText");
  expect(await outlineOf(swatches.getByRole("radio", { name: "Blue" }))).toMatchObject({ style: "solid", width: "1px", color: canvasText });
  // Focused and chosen: the focus outline wins over the chosen one.
  expect(await outlineOf(focused)).toMatchObject({ style: "solid", width: "2px", offset: "2px", color: await resolve(page, "var(--focus)") });
  await swatches.getByRole("radio", { name: "Blue" }).click();
  await colorRow.click();
  // Chosen, without the focus: the chosen outline.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  expect(await outlineOf(swatches.getByRole("radio", { name: "Blue" }))).toMatchObject({ style: "solid", width: "2px", offset: "2px", color: canvasText });
});

test("forced colors: Folder and Tag chips draw an edge", { tag: "@forced" }, async ({ page }) => {
  for (const chip of await labelChips(page)) expect(await edgeOf(chip)).toBe("1px");
});

// Live layer (spec 4.4): the tint falls away, so every status, test and
// protocol pill draws a 1 px system edge and keeps its word. On the pills'
// test page (e2e/kit/pills.tsx) until the rows adopt them.
test("forced colors: status, test and protocol pills draw an edge and keep their word", { tag: "@forced" }, async ({ page }) => {
  await page.goto("/e2e/kit/pills.html");
  const pills = page.locator("[data-pill]");
  await expect(pills.first()).toBeVisible();
  expect(await pills.count()).toBeGreaterThanOrEqual(14);
  for (const p of await pills.all()) {
    expect(await p.evaluate((el) => {
      const cs = getComputedStyle(el);
      return [cs.borderTopStyle, cs.borderTopWidth, cs.borderTopColor === cs.color];
    })).toEqual(["solid", "1px", true]);
    expect((await p.innerText()).trim()).not.toBe("");
  }
});

/** The system colors the forced-colors palette resolves to. */
const system = (page: Page) =>
  page.evaluate(() => {
    const p = document.createElement("span");
    p.style.backgroundColor = "Highlight";
    p.style.color = "HighlightText";
    document.body.appendChild(p);
    const cs = getComputedStyle(p);
    const v = { highlight: cs.backgroundColor, highlightText: cs.color };
    p.remove();
    return v;
  });

// Tailwind's outline-hidden keeps a transparent 2 px outline in forced
// colors, which the system paints: a control carrying it would wear a ring
// at rest (Task 6 keeps it off focus-ring controls; a field's frame hides
// its text box's).
test("forced colors: at rest no row, control or field draws a ring", { tag: "@forced" }, async ({ page }) => {
  const ringed = async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    return page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("button, input, textarea, [role='row'], [tabindex]")]
        // A swatch keeps its color and an edge on purpose (forced-content).
        .filter((el) => { const cs = getComputedStyle(el); return cs.outlineStyle !== "none" && cs.forcedColorAdjust !== "none"; })
        .map((el) => el.getAttribute("aria-label") ?? el.tagName));
  };
  await openApp(page);
  // The list's rows and Peek's controls. Peek's fingerprint rows come with
  // the form: wait for them, so the sweep reads the panel it shows and not
  // its loading skeleton.
  await page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" }).locator("[data-cell='name']").click();
  await expect(page.locator("aside[data-peek] [data-property='os']")).toBeVisible();
  expect(await ringed()).toEqual([]);
  // Then the fields. Peek held them until the panel became read only
  // (peek-v2, plan ruling 3) and the list's filter field stays folded away
  // until `/`, so the fields on screen are the profile form's.
  await expect((await openEditForm(page)).getByRole("textbox", { name: "Name" })).toBeVisible();
  expect(await ringed()).toEqual([]);
});

test("forced colors: a checked row is the system highlight, its pinned cells and its text too", { tag: "@forced" }, async ({ page }) => {
  await openApp(page);
  const r = page.locator("[role='row'][data-profile-id]", { hasText: "Sandbox" });
  await r.hover();
  await r.locator("[data-cell='checkbox'] input").check();
  await expect(r).toHaveAttribute("aria-selected", "true");
  await page.mouse.move(0, 0);
  const sys = await system(page);
  expect(await r.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(sys.highlight);
  // Highlight over Canvas: the row's own color, even where Highlight is translucent.
  for (const cls of ["list-pin-check", "list-pin-name", "list-pin-end"]) {
    expect(await r.locator(`.${cls}`).evaluate((el) => getComputedStyle(el, "::before").backgroundImage), cls).toContain(`linear-gradient(${sys.highlight}, ${sys.highlight})`);
  }
  expect(await r.locator("[data-cell='name'] span.truncate").evaluate((el) => getComputedStyle(el).color)).toBe(sys.highlightText);
});

test("forced colors: a filled status dot in a checked row keeps its own color", { tag: "@forced" }, async ({ page }) => {
  await openApp(page);
  const dot = "[data-cell='status'] [data-tone]:not([data-tone='outline'])";
  const r = page.locator("[role='row'][data-profile-id]").filter({ has: page.locator(dot) }).first();
  await r.hover();
  await r.locator("[data-cell='checkbox'] input").check();
  await expect(r).toHaveAttribute("aria-selected", "true");
  await page.mouse.move(0, 0);
  expect(await r.locator(dot).evaluate((el) => getComputedStyle(el).forcedColorAdjust)).toBe("none");
});

// The system puts a Canvas backplate behind the text it repaints. Behind a
// selected item's inherited HighlightText that was a white box hiding the
// current page's name and a checked row's name (the held state-*-forced
// shots, B17a). What a selected item holds stays opted out and draws in
// HighlightText on the fill; a chip inside gives its own fill up, and the
// row actions' backing still covers the Notes text under it.
test("forced colors: a selected item's text draws on its fill, with no backplate", { tag: "@forced" }, async ({ page }) => {
  await openApp(page);
  const sys = await system(page);
  const look = (l: Locator) =>
    l.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { adjust: cs.forcedColorAdjust, color: cs.color, fill: cs.backgroundColor };
    });
  const label = page.locator("aside [aria-current='page']").getByText("All profiles", { exact: true });
  expect(await look(label)).toEqual({ adjust: "none", color: sys.highlightText, fill: "rgba(0, 0, 0, 0)" });
  const r = page.locator("[role='row'][data-profile-id]", { hasText: "Amazon US seller" });
  await r.hover();
  await r.locator("[data-cell='checkbox'] input").check();
  await expect(r).toHaveAttribute("aria-selected", "true");
  await page.mouse.move(0, 0);
  expect(await look(r.locator("[data-cell='name'] span.truncate"))).toEqual({ adjust: "none", color: sys.highlightText, fill: "rgba(0, 0, 0, 0)" });
  expect(await look(r.locator("[data-cell='folder'] [data-folder-chip]"))).toEqual({ adjust: "none", color: sys.highlightText, fill: "rgba(0, 0, 0, 0)" });
  expect(await r.locator("[data-row-backing]").evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(`linear-gradient(${sys.highlight}, ${sys.highlight})`);
  // The select box stays the system's native control.
  expect(await r.locator("[data-cell='checkbox'] input").evaluate((el) => getComputedStyle(el).forcedColorAdjust)).toBe("auto");
  // A kit Tabs user too (Pair 1 review, Minor 4): Settings' current section
  // is the Highlight fill with its label on it.
  await openApp(page, { section: "settings" });
  const tab = page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { selected: true });
  expect(await look(tab)).toEqual({ adjust: "none", color: sys.highlightText, fill: sys.highlight });
});

// Pair 1 review, Minor 3: a Folder's icon took its color inline, which beat
// forced-selected's HighlightText on the current Folder.
test("forced colors: the current Folder's colored icon draws on its fill", { tag: "@forced" }, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.folderMeta", JSON.stringify({ Shops: { color: "green", icon: "cart" } })));
  await openApp(page);
  const sys = await system(page);
  await page.locator("aside [data-folder='Shops']").click();
  await expect(page.locator("aside [data-folder='Shops']")).toHaveAttribute("aria-current", "page");
  const icon = page.locator("aside [data-folder='Shops'] [data-folder-icon]");
  expect(await icon.evaluate((el) => getComputedStyle(el).color)).toBe(sys.highlightText);
});

// Pair 3 review, Minor 4: the row line is scoped to the Profiles and
// Proxies rows; Windows contrast themes still draw it on both, in
// CanvasText, and on no other row.
test("forced colors: the Profiles and Proxies rows keep their line, and no other row gets one", { tag: "@forced" }, async ({ page }) => {
  for (const [section, sel] of [["profiles", "[role='row'][data-profile-id]"], ["proxies", "[role='row'][data-proxy-id]"]] as const) {
    await openApp(page, { section });
    const line = await page.locator(sel).first().evaluate((el) => getComputedStyle(el, "::after").backgroundColor);
    expect(line, section).toBe(await resolve(page, "CanvasText"));
  }
  const other = await page.evaluate(() => {
    const el = document.createElement("div");
    el.setAttribute("role", "row");
    el.setAttribute("aria-selected", "false");
    document.querySelector("main")!.append(el);
    const content = getComputedStyle(el, "::after").content;
    el.remove();
    return content;
  });
  expect(other).toBe("none");
});

test("forced colors: a menu's choice item reached with the keys draws a ring", { tag: "@forced" }, async ({ page }) => {
  await openApp(page);
  await page.getByRole("treegrid").getByRole("button", { name: "Columns" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  const item = page.locator(":focus");
  expect(await item.getAttribute("role")).toMatch(/^menuitem(checkbox|radio)$/);
  // Inside the item, so it never meets the panel's edge or overshoots its
  // inner radius (owner feedback 5u).
  expect(await outlineOf(item)).toMatchObject({ style: "solid", offset: "-2px" });
});

// Merge point 1: the palette's search is bare (C15), and its text box's
// outline crossed the panel's top edge. Its frame marks the focus instead,
// 2 px inside itself, clear of the panel's edge and corners.
test("forced colors: the palette's bare search marks its focus inside itself", { tag: "@forced" }, async ({ page }) => {
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.getByRole("dialog", { name: "Command palette" }).getByRole("combobox", { name: "Search commands" });
  await expect(search).toBeFocused();
  expect((await outlineOf(search)).style).toBe("none");
  expect(await outlineOf(search.locator("xpath=.."))).toMatchObject({ style: "solid", width: "2px", offset: "-4px" });
});

test("Increase contrast: darker secondary text and a 3 px ring", async ({ page }) => {
  await openApp(page, { theme: "light" });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-contrast", value: "more" }] });
  const soft = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--text-soft-400").trim());
  expect(soft).toBe("#404040");
  const r = (await tabStops(page, 1))[0];
  expect(r.width).toBe("3px");
});
