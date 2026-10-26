/** Surfaces that replace each other. When one opens, a member of its group
 *  that is still leaving goes at once (ANIM-02: a handoff is instant). */
export type PresenceGroup = 'overlay' | 'tooltip'

const leaving: Record<PresenceGroup, Set<() => void>> = { overlay: new Set(), tooltip: new Set() }
// The members that opened in the current task (one user action, one or more
// React commits), so a member that starts leaving in that same action hands
// off too, whatever the effect order. A member never hands off to itself: a
// surface mounted open and closed again before the task ends still leaves.
const openedNow: Record<PresenceGroup, Set<object>> = { overlay: new Set(), tooltip: new Set() }

function mark(g: PresenceGroup, member: object) {
  const opened = openedNow[g]
  if (opened.size === 0) queueMicrotask(() => opened.clear())
  opened.add(member)
}

/** A member opened: members still leaving go now. An overlay also clears tooltips. */
export function presenceOpened(group: PresenceGroup, member: object): void {
  for (const g of group === 'overlay' ? (['overlay', 'tooltip'] as const) : (['tooltip'] as const)) {
    mark(g, member)
    for (const finish of [...leaving[g]]) finish()
  }
}

/** A member started leaving; returns the unregister function. */
export function presenceLeaving(group: PresenceGroup, member: object, finish: () => void): () => void {
  for (const opener of openedNow[group]) {
    if (opener !== member) { finish(); return () => {} }
  }
  leaving[group].add(finish)
  return () => { leaving[group].delete(finish) }
}
