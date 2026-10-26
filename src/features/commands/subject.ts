import type { Command, CommandArea, Subject } from "../../shared/commands";
import { selectVisible, useProfile, useProfileUi } from "../../entities/profile";
import { selectedVisibleIds, useProxy, visibleProxyIds } from "../../entities/proxy";
import { trashShown, useTrash } from "../../entities/trash";

const NONE: Subject = { ids: [] };

/** The selection the Profiles list shows. */
export function profileSelection(): Subject {
  const ui = useProfileUi.getState();
  const { indexById } = selectVisible(ui);
  return { ids: [...ui.selected].filter((id) => indexById.has(id)) };
}

/** The Profiles list's active row, when the list shows it. */
export function profileActive(): string | null {
  const ui = useProfileUi.getState();
  return ui.activeId && selectVisible(ui).indexById.has(ui.activeId) ? ui.activeId : null;
}

/// What a list key acts on: the selection the list shows, else the active
/// row, the one the pointer rests on included (IFACE-05, O5). The palette
/// reads `profileContext` instead, which the pointer never sets.
export function profileTargets(): Subject {
  const sel = profileSelection();
  if (sel.ids.length > 0) return sel;
  const active = profileActive();
  return active ? { ids: [active] } : NONE;
}

/// What the palette's first group acts on: the selection, else the row the
/// keyboard (or a press) made active, else the row Peek shows. A row the
/// pointer only passed over never counts, so a resting mouse never changes
/// what the palette offers (Pair 44 ruling); the list's keys still act on it (O5).
export function profileContext(): Subject {
  const sel = profileSelection();
  if (sel.ids.length > 0) return sel;
  const ui = useProfileUi.getState();
  const active = profileActive();
  if (active && !ui.activeByPointer) return { ids: [active] };
  const peek = ui.peekId;
  return peek && useProfile.getState().profiles.some((p) => p.id === peek) ? { ids: [peek] } : NONE;
}

/// A row's menu: the whole selection when the row is part of it, else that
/// row alone (ruling 4: the Finder and Linear rule).
export function profileRowSubject(id: string): Subject {
  const sel = profileSelection();
  return sel.ids.length > 1 && sel.ids.includes(id) ? sel : { ids: [id] };
}

/** The selection the Proxies list shows. */
export function proxySelection(): Subject {
  return { ids: selectedVisibleIds() };
}

/** The Proxies list's active row, when the list shows it. */
export function proxyActive(): string | null {
  const { activeId } = useProxy.getState();
  return activeId && visibleProxyIds().includes(activeId) ? activeId : null;
}

/** What a Proxies list key acts on, by `profileTargets`' rule. */
export function proxyTargets(): Subject {
  const sel = proxySelection();
  if (sel.ids.length > 0) return sel;
  const active = proxyActive();
  return active ? { ids: [active] } : NONE;
}

/** The palette's first group on Proxies, by `profileContext`'s rule. */
export function proxyContext(): Subject {
  const sel = proxySelection();
  if (sel.ids.length > 0) return sel;
  const { activeByPointer, peekId, proxies } = useProxy.getState();
  const active = proxyActive();
  if (active && !activeByPointer) return { ids: [active] };
  return peekId && proxies.some((p) => p.id === peekId) ? { ids: [peekId] } : NONE;
}

export function proxyRowSubject(id: string): Subject {
  const sel = proxySelection();
  return sel.ids.length > 1 && sel.ids.includes(id) ? sel : { ids: [id] };
}

/// The Trash page's picks it shows (a search hides some; those stay picked
/// but are not acted on, as its Delete key does). The Trash's list keeps
/// its active row to itself, so this is the selection only.
export function trashSelection(): Subject {
  const { items, search, selected } = useTrash.getState();
  return { ids: trashShown(items, search).filter((e) => selected.has(e.id)).map((e) => e.id) };
}

/** The selection of an area that has one. */
export function selectionOf(area: CommandArea): Subject {
  if (area === "profiles") return profileSelection();
  if (area === "proxies") return proxySelection();
  if (area === "trash") return trashSelection();
  return NONE;
}

/** Whether a subject is exactly the selection its area shows. */
export function isSelectionOf(area: CommandArea, s: Subject): boolean {
  const sel = selectionOf(area).ids;
  return sel.length > 0 && sel.length === s.ids.length && s.ids.every((id) => sel.includes(id));
}

/// The subject a command gets from a base subject: a one-row command takes the
/// active row when the base is several rows (E renames the active row even
/// while three are selected).
export function subjectFor(cmd: Command, base: Subject, activeId: string | null): Subject {
  if (cmd.scope !== "active" || base.ids.length <= 1) return base;
  return activeId ? { ids: [activeId] } : NONE;
}
