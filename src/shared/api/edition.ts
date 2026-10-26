/// The edition of the space on screen, and the one a write was asked in. No imports, so
/// node tests and the write queues read it as it is.

let edition: number | undefined;
let pinned: number | undefined;
const moved = new Set<() => void>();

/** The edition of the space the interface shows; undefined before the first read. */
export function spaceEpoch(): number | undefined {
  return edition;
}

/** The space store's read of `space_state`; a new edition runs `onSpaceMoved`. */
export function setSpaceEpoch(next: number | undefined): void {
  if (next === undefined || next === edition) return;
  const was = edition;
  edition = next;
  if (was !== undefined) for (const fn of [...moved]) fn();
}

/** Runs `fn` each time the interface learns the launcher works in another space. */
export function onSpaceMoved(fn: () => void): () => void {
  moved.add(fn);
  return () => moved.delete(fn);
}

/** The edition a write sent now carries: the one `withEpoch` pinned, else the space's. */
export function epochForWrite(): number | undefined {
  return pinned ?? edition;
}

/** Runs `call` so the writes it sends at once carry `epoch`, the space they were asked in:
 *  one that lands after a switch is then refused, never written to the new space. */
export function withEpoch<T>(epoch: number | undefined, call: () => T): T {
  const was = pinned;
  pinned = epoch;
  try {
    return call();
  } finally {
    pinned = was;
  }
}
