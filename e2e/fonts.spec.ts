import { expect, test } from "@playwright/test";
import { openApp } from "./support/app";

// Mono is read on Proxies, whose Host:Port column is mono: the Profiles
// Proxy cell names the proxy since F17 (Pairs 22+23), so its seed shows none.
test("the app ships its own Inter and JetBrains Mono", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const loaded = await page.evaluate(async () => [
    (await document.fonts.load('14px "Inter Variable"')).length > 0,
    (await document.fonts.load('12px "JetBrains Mono Variable"')).length > 0,
  ]);
  expect(loaded).toEqual([true, true]);
  const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(body.startsWith('"Inter Variable"')).toBe(true);
  const mono = await page.locator(".text-mono").first().evaluate((el) => getComputedStyle(el).fontFamily);
  expect(mono.startsWith('"JetBrains Mono Variable"')).toBe(true);
});

// Owner request 5g: UI text is 13 px now (secondary 12 px), the html root
// stays 14 px at every window width (spacing is px since audit Phase B, O1).
test("UI text is 13 px, secondary text 12 px, the html root stays 14 px", async ({ page }) => {
  await openApp(page);
  const fontSize = (locator: ReturnType<typeof page.locator>) =>
    locator.first().evaluate((el) => getComputedStyle(el).fontSize);

  await expect.poll(() => fontSize(page.locator("body"))).toBe("13px");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("14px");

  // A kit component's own type scale (NavItem's label) and a small kit Button.
  await expect.poll(() => fontSize(page.locator("[data-nav='profiles']"))).toBe("13px");
  await expect.poll(() => fontSize(page.locator("button", { hasText: "Filters" }))).toBe("13px");

  // The secondary size stays 12 px.
  await expect.poll(() => fontSize(page.locator(".text-secondary"))).toBe("12px");
});

test("zh UI text is 13 px too (CJK stays at or above 12 px)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
  await openApp(page);
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "命令面板" });
  await expect(palette).toBeVisible();
  const item = palette.locator(".text-body").first();
  await expect.poll(() => item.evaluate((el) => getComputedStyle(el).fontSize)).toBe("13px");
});

test("Inter draws the arrows and key symbols itself, not a system font (TYPE-04)", async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => {
    const s = document.createElement("span");
    s.id = "glyph-probe";
    s.textContent = "→ ⌘ ✓ ≠";
    document.body.appendChild(s);
    await document.fonts.ready;
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", {});
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#glyph-probe" });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.map((f) => `${f.familyName} custom=${f.isCustomFont}`)).toEqual(fonts.map((f) => `${f.familyName} custom=true`));
});

test("both font files are preloaded (PERF-17)", async ({ page }) => {
  await openApp(page);
  const hrefs = await page.locator('link[rel="preload"][as="font"]').evaluateAll((els) => els.map((el) => (el as HTMLLinkElement).href));
  expect(hrefs.some((h) => /InterVariable.*\.woff2/.test(h))).toBe(true);
  expect(hrefs.some((h) => /jetbrains-mono-latin-wght-normal.*\.woff2/.test(h))).toBe(true);
});

test("base type: 13 px text, 500 emphasis, mono without ligatures, tabular grids, brand selection", async ({ page }) => {
  await openApp(page, { section: "proxies" });
  const body = await page.evaluate(() => { const cs = getComputedStyle(document.body); return [cs.fontSize, cs.lineHeight]; });
  expect(body).toEqual(["13px", "20px"]);
  expect(await page.locator(".text-mono").first().evaluate((el) => getComputedStyle(el).fontVariantLigatures)).toBe("none");
  expect(await page.getByRole("treegrid").evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
  const selection = await page.evaluate(() => getComputedStyle(document.body, "::selection").backgroundColor);
  const tint = await page.evaluate(() => {
    const p = document.createElement("span");
    p.style.color = "var(--primary-tint-hover)";
    document.body.appendChild(p);
    const v = getComputedStyle(p).color;
    p.remove();
    return v;
  });
  expect(selection).toBe(tint);
  await openApp(page, { section: "settings" });
  // The emphasis is read in API & MCP ("MCP" in its help): Profile defaults'
  // rows carry no <strong> since F30 (Pair 34).
  await page.getByRole("tablist", { name: "Settings sections" }).getByRole("tab", { name: "API & MCP" }).click();
  // API & MCP's help has no <strong> since F31 (Pair 35): the base rule is read on one of its own.
  expect(await page.locator("main").evaluate((el) => {
    const strong = el.appendChild(document.createElement("strong"));
    const weight = getComputedStyle(strong).fontWeight;
    strong.remove();
    return weight;
  })).toBe("500");
  // The `.mono` utility (CopyField, the proxy IPs, the GPU line) is the mono face without ligatures too.
  const mono = page.locator(".mono").first();
  await expect(mono).toBeVisible();
  expect(await mono.evaluate((el) => { const cs = getComputedStyle(el); return [cs.fontFamily.startsWith('"JetBrains Mono Variable"'), cs.fontVariantLigatures]; })).toEqual([true, "none"]);
});

test("Chinese text has a CJK face after Inter, not the engine's guess (TYPE-03)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shardx.lang", "zh"));
  await openApp(page);
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family.startsWith('"Inter Variable"')).toBe(true);
  expect(family).toContain("PingFang SC");
  expect(family).toContain("Microsoft YaHei");
});
