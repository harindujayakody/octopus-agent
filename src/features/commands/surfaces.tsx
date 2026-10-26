import type { MenuItem } from "@proxyshard/shardx-ui-kit";
import { t } from "../../shared/i18n";
import { useNav } from "../../shared/model/navigation";
import { useKeyPrefs } from "../../shared/model/keyPrefs";
import {
  applies, ariaKeys, command, commandsOf, keyCaps, keyWorksOn,
  type Command, type CommandArea, type CommandGroup, type RunContext, type Subject, type Surface,
} from "../../shared/commands";

/** Menus list their groups in this order, with a separator between two. */
export const MENU_GROUP_ORDER: readonly CommandGroup[] = [
  "run", "open", "organize", "copy", "create", "select", "navigate", "settings", "view", "help", "move", "danger",
];

/// A page-wide single key while the Single-key shortcuts switch is off: no
/// surface prints or declares it, as it does nothing (O14).
export const keyOff = (c: Command): boolean => !!c.singleKey && !useKeyPrefs.getState().singleKeys;
/** The cap a surface prints for a command: its first binding ("⌘K", "G P", "⌫"). */
export const capOf = (c: Command): string | undefined => (!keyOff(c) && c.keys?.[0] ? keyCaps(c.keys[0]).join(" ") : undefined);
/** `aria-keyshortcuts` for a command. */
export const ariaOf = (c: Command): string | undefined => (!keyOff(c) && c.keys ? ariaKeys(c.keys) : undefined);
/** A command's label, for surfaces outside the registry's adapters (a header button, a toolbar). */
export const labelOf = (id: string, n = 1): string => command(id).label(n);

/// A command's icon as every surface draws it: 14 px (owner rule), with a
/// stable `data-icon` named after the command ("profile.openPeek" is
/// "open-peek"), so a test can tell a menu item and a hover button draw the
/// same glyph. The one place a registry icon is rendered.
export function iconOf(c: Command, className = "size-3.5") {
  const Icon = c.icon;
  if (!Icon) return undefined;
  const name = (c.id.split(".").pop() ?? c.id).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  return <Icon className={className} data-icon={name} />;
}

/** A one-row command has exactly one row to act on. */
const fits = (c: Command, s: Subject): boolean => c.scope !== "active" || s.ids.length === 1;

/** What a selection command says with nothing to act on. */
function selectFirst(area: CommandArea): string {
  if (area === "profiles") return t("commands.selectProfileFirst");
  if (area === "proxies") return t("commands.selectProxyFirst");
  return t("commands.selectFirst");
}

/// Why a command cannot run on this subject now, or null. A selection
/// command with nothing selected and no active row says so and never runs
/// on nothing: Move to folder… for no profile would open the create-only
/// Folder dialog, and Assign or Edit tags an empty picker (Pair 37 review, I1).
export function reasonOf(c: Command, s: Subject): string | null {
  if (c.scope === "selection" && s.ids.length === 0) return selectFirst(c.area);
  return c.disabled?.(s) ?? null;
}

/// What a surface lists for a subject, in menu order: the commands that apply;
/// one-row commands only when the subject is one row (ruling 4).
export function commandsFor(surface: Surface, area: CommandArea, s: Subject): Command[] {
  const list = commandsOf(area, surface).filter((c) => fits(c, s) && applies(c, s));
  return MENU_GROUP_ORDER.flatMap((g) => list.filter((c) => c.group === g));
}

/// A kit menu for a surface: the commands grouped with separators, each with
/// its icon (14 px, owner rule), key cap and `aria-keyshortcuts` (UI-29,
/// CRAFT-10). A key prints only on a page where it works (the Pinned menu
/// opens on every page; S starts a profile on Profiles only). One that
/// cannot run now is disabled with its reason as the hint (EMIL-05).
/// `onRun` sees each command just before it runs, for a surface that must
/// act first (a Pinned item hands the keyboard on before Unpin removes it).
export function menuItemsFor(
  surface: Surface, area: CommandArea, s: Subject, { onRun }: { onRun?: (c: Command) => void } = {},
): MenuItem[] {
  const section = useNav.getState().section;
  const items: MenuItem[] = [];
  let group: CommandGroup | null = null;
  for (const c of commandsFor(surface, area, s)) {
    if (group !== null && c.group !== group) items.push({ type: "separator" });
    group = c.group;
    const reason = reasonOf(c, s);
    const keyed = keyWorksOn(c, section);
    items.push({
      label: c.menuLabel?.(s) ?? c.label(s.ids.length),
      icon: iconOf(c),
      shortcut: keyed ? capOf(c) : undefined,
      ariaKeyShortcuts: keyed ? ariaOf(c) : undefined,
      danger: c.danger,
      disabled: reason !== null,
      hint: reason ?? undefined,
      onSelect: () => { onRun?.(c); void runCommand(c, s, { from: surface }); },
    });
  }
  return items;
}

/// A bulk bar's commands, in the order they were defined. A bar keeps its
/// shape: it ignores `when` and draws what cannot run as disabled (ruling 3).
/// Clear selection is the bar's close button, not one of these.
export function barCommands(area: CommandArea): Command[] {
  return commandsOf(area, "bulkBar").filter((c) => !c.keyOwner);
}

/// Runs a command, when it applies and can run now. The selection stays
/// exactly as it was, whatever failed: failures are reported by toast (each
/// store action names what failed, and the start toast offers "Select
/// failed", which replaces the selection only when pressed). The ids a run
/// answers with are those failures; nothing here narrows or clears the
/// selection with them (owner rule: bulk actions keep the selection; ORDER
/// R26 a strikes the plan's narrowing to failed ids).
export async function runCommand(c: Command, s: Subject, ctx: RunContext): Promise<void> {
  if (!c.run || !fits(c, s) || !applies(c, s) || reasonOf(c, s) !== null) return;
  await c.run(s, ctx);
}

/// What a surface draws for a subject, in order, as tests read it: the id, the
/// label, the printed cap and `aria-keyshortcuts` (Task 8's parity test).
export function describe(surface: Surface, area: CommandArea, ids: string[]) {
  const s = { ids };
  const list = surface === "bulkBar" ? barCommands(area) : commandsFor(surface, area, s);
  return list.map((c) => ({ id: c.id, label: c.label(ids.length), cap: capOf(c) ?? null, aria: ariaOf(c) ?? null }));
}
