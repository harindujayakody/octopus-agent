import { expect, test, type Page } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { appModule, openApp } from "./support/app";

// One command, one name, one key, everywhere (IFACE gap 1, UI-29): the row
// menu, the bulk bar, the list keys, the palette and the sheet read one
// registry, and nothing else lists an action by hand.
type Described = { id: string; label: string; cap: string | null; aria: string | null };
type Cmd = { id: string; area: string; keys?: string[]; keyOwner?: string; surfaces: string[]; scope: string };
type Api = {
  describe: (surface: string, area: string, ids: string[]) => Described[];
  allCommands: () => Cmd[];
  sheetSections: (section: string) => { rows: { ids: string[]; label: string; keys: { caps: string[] }[] }[] }[];
  commandForKey: (e: KeyboardEvent, area: string) => { id: string } | null;
};
const load = async (page: Page) => {
  await openApp(page);
  await appModule(page, "/src/features/commands/index.ts", "__cmds");
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const row = (page: Page, name: string) => page.locator("[role='row'][data-profile-id]", { hasText: name });

test("the row menu, the bulk bar and the sheet print each command with the same name and key", async ({ page }) => {
  await load(page);
  for (const name of ["Etsy craft shop", "FB Ads acc-02"]) await row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
  const ids = ["aed41005", "c31d92f1"];
  const described = await page.evaluate((ids) => {
    const a = (window as unknown as { __cmds: Api }).__cmds;
    return {
      menu: a.describe("rowMenu", "profiles", ids),
      bar: a.describe("bulkBar", "profiles", ids),
      // The sheet names a command as it acts on one row ("Change proxy").
      single: a.describe("rowMenu", "profiles", ["f62a9d43"]),
      sheet: a.sheetSections("profiles"),
    };
  }, ids);

  // The row menu of a selected row lists the selection's commands.
  await row(page, "FB Ads acc-02").click({ button: "right" });
  const items = page.getByRole("menu").getByRole("menuitem");
  await expect(items).toHaveCount(described.menu.length);
  for (const [i, d] of described.menu.entries()) {
    await expect(items.nth(i)).toHaveAccessibleName(new RegExp(`^${esc(d.label)}`));
    if (d.aria) await expect(items.nth(i)).toHaveAttribute("aria-keyshortcuts", d.aria);
  }
  await page.keyboard.press("Escape");

  // The bar: the same labels and keys for the commands it shares with the menu.
  const bar = page.getByRole("toolbar", { name: /selected/ });
  for (const d of described.bar) {
    await expect(bar.locator(`[data-command='${d.id}']`)).toHaveAccessibleName(d.label);
    const inMenu = described.menu.find((m) => m.id === d.id);
    if (inMenu) expect(inMenu.label, d.id).toBe(d.label);
  }

  // The sheet: every command with a key, on a row that names it.
  const sheetRows = described.sheet.flatMap((s) => s.rows);
  for (const d of described.single.filter((x) => x.cap)) {
    const r = sheetRows.find((x) => x.ids.includes(d.id));
    expect(r, `${d.id} is on the sheet`).toBeTruthy();
    expect(r!.label.split(" / "), d.id).toContain(d.label);
  }
});

test("every list key the registry lists is the key the list runs", async ({ page }) => {
  await load(page);
  // Sandbox: idle, not pinned, in no Folder; the row the keys act on.
  await row(page, "Sandbox").focus();
  const wrong = await page.evaluate(() => {
    const a = (window as unknown as { __cmds: Api }).__cmds;
    // A pair answers with whichever applies: S on an idle row is Start.
    const PAIR: Record<string, string> = { "profile.stop": "profile.start" };
    const out: string[] = [];
    for (const c of a.allCommands()) {
      if (c.area !== "profiles" || !c.keys || c.keyOwner) continue;
      if ((c as { keyWhere?: string }).keyWhere && (c as { keyWhere?: string }).keyWhere !== "list") continue;
      const parts = c.keys[0].split("+");
      const key = parts.pop()!;
      const e = new KeyboardEvent("keydown", {
        key: key.length === 1 ? key.toLowerCase() : key === "Space" ? " " : key,
        code: /^[A-Z]$/.test(key) ? `Key${key}` : key,
        metaKey: parts.includes("Mod"),
        shiftKey: parts.includes("Shift"),
      });
      const got = a.commandForKey(e, "profiles")?.id ?? null;
      if (got !== c.id && got !== PAIR[c.id]) out.push(`${c.id} got ${got}`);
    }
    return out;
  });
  expect(wrong).toEqual([]);
});

test("the palette prints a command's key as the sheet does", async ({ page }) => {
  await load(page);
  const sheet = await page.evaluate(() => (window as unknown as { __cmds: Api }).__cmds.sheetSections("profiles").flatMap((s) => s.rows));
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  for (const [query, id] of [["proxies", "nav.proxies"], ["new profile", "profile.new"], ["shortcuts", "app.shortcuts"]] as const) {
    await palette.getByRole("combobox", { name: "Search commands" }).fill(query);
    const r = sheet.find((x) => x.ids.includes(id))!;
    const option = palette.getByRole("option", { name: new RegExp(`^${esc(r.label)}`) });
    await expect(option.locator("kbd")).toHaveText(r.keys[0].caps);
  }
});

// E10's row (ORDER R12: written here, where the file is created).
test("the palette's first group prints the row menu's names and keys for the same selection", async ({ page }) => {
  await load(page);
  for (const name of ["Etsy craft shop", "FB Ads acc-02"]) await row(page, name).locator("[data-cell='checkbox'] input").check({ force: true });
  const want = await page.evaluate(() => {
    const a = (window as unknown as { __cmds: Api }).__cmds;
    // The first group is what acts on the selection; the page's own commands
    // (New profile, Import) sit under Actions (Pair 44).
    const acts = new Set(a.allCommands().filter((c) => c.scope === "selection" || c.scope === "active").map((c) => c.id));
    return a.describe("palette", "profiles", ["aed41005", "c31d92f1"]).filter((d) => acts.has(d.id));
  });
  await page.keyboard.press("ControlOrMeta+k");
  const options = page.getByRole("dialog", { name: "Command palette" }).getByRole("group").first().getByRole("option");
  await expect(options).toHaveCount(want.length);
  for (const [i, d] of want.entries()) {
    await expect(options.nth(i)).toHaveAccessibleName(new RegExp(`^${esc(d.label)}`));
    if (d.aria) await expect(options.nth(i)).toHaveAttribute("aria-keyshortcuts", d.aria);
  }
});

// The source scan: nothing outside the registry writes a key cap, an
// aria-keyshortcuts value or a menu of actions by hand.
//
// Still built by hand, listed (ORDER R19), because the registry has no
// commands for their areas yet: the Trash header's "Restore all", the
// Fingerprints header menu and "Add extension" (F3), Fingerprint Peek's menu (F12a), and
// the Bookmarks, Extensions and Fingerprints row and card menus (F26, F27).
// None of them prints a key.
// Read from the repo root, where Playwright runs (as security.spec does).
const SRC = join(process.cwd(), "src");
const ALLOWED = [/^features\/commands\//, /^shared\/commands\//, /^dev\//];
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

test("no component lists a key or an action by hand", () => {
  const found: string[] = [];
  for (const file of files(SRC)) {
    const rel = relative(SRC, file);
    if (ALLOWED.some((re) => re.test(rel))) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      const at = `${rel}:${i + 1}`;
      if (/\bshortcut\s*[:=]\s*\{?\s*["'`]/.test(line)) found.push(`${at} hand-written shortcut`);
      if (/aria-keyshortcuts\s*=\s*["'`]/.test(line)) found.push(`${at} hand-written aria-keyshortcuts`);
      if (/<Kbd[^>]*>[^<{]+<\/Kbd>/.test(line)) found.push(`${at} a literal key cap`);
      if (/\b(modShortcut|deleteKeyLabel|SHORTCUT_GROUPS|useCommands)\b/.test(line)) found.push(`${at} a retired helper`);
      if (/t\("profileRow\.menu|t\("profileBulkBar\.(start|stop|tags|trash|moveToFolder|assignProxies)|t\("shortcuts\.(startStop|trash|rename|tags|proxy)/.test(line)) found.push(`${at} an action label outside the registry`);
    });
  }
  expect(found).toEqual([]);
});
