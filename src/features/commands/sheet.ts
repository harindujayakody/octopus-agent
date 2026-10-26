import { t } from "../../shared/i18n";
import { commandsOf, isSequence, keyCaps, keyWorksOn, type CommandArea, type CommandGroup } from "../../shared/commands";
import { useKeyPrefs } from "../../shared/model/keyPrefs";
import type { Section } from "../../shared/types";

export type SheetKey = { caps: string[]; sequence: boolean };
export type SheetRow = {
  /** The commands this row names: one, or a pair that shares a key. */
  ids: string[];
  label: string;
  keys: SheetKey[];
  /** "or": alternatives ("Enter / Space"); "to": a range ("⌘1–⌘9"); "and": side by side ("↑ ↓"). */
  join: "or" | "to" | "and";
  /** A page-wide single key (C, /, ?, G): the Single-key shortcuts switch turns it off. */
  singleKey: boolean;
  /** That single key while the switch is off: the sheet says "Off" (O14). */
  off: boolean;
};
export type SheetSection = { area: CommandArea; title: string; rows: SheetRow[] };

/** The sheet orders an area's rows by these groups, then as defined. */
export const SHEET_GROUP_ORDER: readonly CommandGroup[] = [
  "create", "open", "run", "organize", "danger", "select", "move", "help", "view", "navigate",
];

const TITLES: Partial<Record<CommandArea, () => string>> = {
  profiles: () => t("shortcuts.groupList"),
  proxies: () => t("shortcuts.groupProxies"),
  trash: () => t("shortcuts.groupTrash"),
  bookmarks: () => t("shortcuts.groupBookmarks"),
  app: () => t("shortcuts.groupGeneral"),
  palette: () => t("shortcuts.groupPalette"),
};

/// A command's keys as the sheet prints them. Two bindings that print the
/// same cap are one: Delete and Backspace are both "⌫" on macOS.
function sheetKeys(keys: readonly string[]): SheetKey[] {
  const out: SheetKey[] = [];
  for (const k of keys) {
    const caps = keyCaps(k);
    if (!out.some((o) => o.caps.join(" ") === caps.join(" "))) out.push({ caps, sequence: isSequence(k) });
  }
  return out;
}

/// An area's rows: every command with a key and the sheet surface. Commands
/// that share their first key are one row, their names joined ("Start /
/// Stop", ruling 5), so the sheet and the menus print the same words.
function rowsOf(area: CommandArea, section: Section): SheetRow[] {
  const singleOn = useKeyPrefs.getState().singleKeys;
  // A page's own app key (Save on Settings) shows on its page only.
  const keyed = commandsOf(area, "sheet").filter((c) => c.keys && c.keys.length > 0 && (area !== "app" || keyWorksOn(c, section)));
  const ordered = SHEET_GROUP_ORDER.flatMap((g) => keyed.filter((c) => c.group === g));
  const rows: (SheetRow & { first: string })[] = [];
  for (const c of ordered) {
    const same = rows.find((r) => r.first === c.keys![0]);
    if (same) {
      same.ids.push(c.id);
      same.label = `${same.label} / ${c.label(1)}`;
      continue;
    }
    rows.push({
      first: c.keys![0],
      ids: [c.id],
      label: c.label(1),
      keys: sheetKeys(c.keys!),
      join: c.keysJoin ?? "and",
      singleKey: !!c.singleKey,
      off: !!c.singleKey && !singleOn,
    });
  }
  return rows.map(({ first: _first, ...row }) => row);
}

/// The sheet for a page: its own list first (IFACE-11: `?` is page-aware),
/// then the app's keys and the palette's, then the other list, under its
/// own title, as its keys work only on its page. The registry's page scope
/// says which list is this page's, as it says where the palette prints a key.
/// The Trash's keys show on the Trash only (F25b): elsewhere they are noise.
/// So do the Bookmarks page's (its C makes a bookmark there only).
export function sheetSections(section: Section): SheetSection[] {
  const lists: CommandArea[] = ["profiles", "proxies", "trash", "bookmarks"];
  const own = lists.filter((a) => commandsOf(a).some((c) => c.page === section));
  const others = lists.filter((a) => !own.includes(a) && a !== "trash" && a !== "bookmarks");
  return [...own, "app" as const, "palette" as const, ...others]
    .map((area) => ({ area, title: TITLES[area]?.() ?? "", rows: rowsOf(area, section) }))
    .filter((s) => s.rows.length > 0);
}
