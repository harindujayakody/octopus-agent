import type { Section } from "../types";
import type { Command, CommandArea, Subject, Surface } from "./types";

const map = new Map<string, Command>();

/// Adds commands. A definition module calls this once when it loads; a second
/// call with the same id replaces the entry (Vite's hot reload runs a module
/// again), so one id is always one command.
export function defineCommands(list: readonly Command[]): void {
  for (const c of list) map.set(c.id, c);
}

export function findCommand(id: string): Command | undefined {
  return map.get(id);
}

export function command(id: string): Command {
  const c = map.get(id);
  if (!c) throw new Error(`No command "${id}"`);
  return c;
}

/** An area's commands in the order they were defined, optionally only those a surface lists. */
export function commandsOf(area: CommandArea, surface?: Surface): Command[] {
  return [...map.values()].filter((c) => c.area === area && (!surface || c.surfaces.includes(surface)));
}

export function allCommands(): Command[] {
  return [...map.values()];
}

/** Whether a command applies to a subject. */
export function applies(c: Command, s: Subject): boolean {
  return !c.when || c.when(s);
}

/// Whether a command's key works on this page, so a surface prints it only
/// there: an app key works on every page; a page or list key works only on
/// the command's own page (C makes a profile on Profiles, nowhere else).
export function keyWorksOn(c: Command, section: Section): boolean {
  if (!c.keys?.length) return false;
  return c.keyWhere === "app" || !c.page || c.page === section;
}
