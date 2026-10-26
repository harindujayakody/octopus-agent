import { applies, commandsOf, isSequence, matchesChord, parseChord, type Command, type Subject } from "../../shared/commands";
import { profileActive, profileTargets, proxyActive, proxyTargets } from "./subject";
import { runCommand } from "./surfaces";

type ListArea = "profiles" | "proxies";

/** A list's key commands: the keys that work in the list and that the registry runs. */
function listKeyed(area: ListArea): Command[] {
  return commandsOf(area).filter((c) => c.keys && c.run && !c.keyOwner && (c.keyWhere ?? "list") === "list");
}

const hits = (e: KeyboardEvent, c: Command) => c.keys!.some((k) => !isSequence(k) && matchesChord(e, parseChord(k)));

/// What a list key's command acts on. A one-row command (X, E, Enter) acts
/// on the row the keyboard is on, whatever is selected: X on a second row
/// selects it, never unselects the first. Every other command acts on the
/// selection, else the active row (IFACE-05).
function subjectOf(c: Command, area: ListArea): Subject {
  if (c.scope === "active") {
    const active = area === "profiles" ? profileActive() : proxyActive();
    return { ids: active ? [active] : [] };
  }
  return area === "profiles" ? profileTargets() : proxyTargets();
}

/// The command a key runs in a list now: the first one bound to it that
/// applies to the list's targets (S starts the idle ones, else stops them).
/// Null when none applies.
export function commandForKey(e: KeyboardEvent, area: ListArea): Command | null {
  for (const c of listKeyed(area)) {
    if (!hits(e, c)) continue;
    const s = subjectOf(c, area);
    if ((c.scope === "selection" || c.scope === "active") && s.ids.length === 0) continue;
    if (applies(c, s)) return c;
  }
  return null;
}

/// Runs a list key from the registry. True when the key belongs to a list
/// command (the caller prevents its default), even when nothing ran: a held
/// key acts once (PC-038), and a command that cannot run now does nothing.
/// The selection stays as it was (runCommand never narrows it).
export function dispatchListKey(e: KeyboardEvent, area: ListArea): boolean {
  const c = commandForKey(e, area);
  if (!c) return listKeyed(area).some((x) => hits(e, x));
  const s = subjectOf(c, area);
  if (e.repeat || c.disabled?.(s)) return true;
  void runCommand(c, s, { from: "keys" });
  return true;
}
