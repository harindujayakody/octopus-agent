/// Rows that just arrived (a new, imported, cloned or restored profile, an
/// added proxy) are marked for their one slide-in (Live layer, spec 6.2), and
/// unmarked once it has played, so a row a list mounts again later (scrolled
/// back into view) never replays it. Each list keeps its marks in its own
/// store, as id -> the time it arrived.

/** A duration token as the page resolves it ("450ms", "1s"), in ms; 0 when
 *  the kit's stylesheet is not there to read. */
function tokenMs(name: string): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return v.endsWith("ms") ? n : v.endsWith("s") ? n * 1000 : 0;
}

/** How long a new row counts as arriving: until its slide (--motion-spring)
 *  and its tint (--motion-tint) have both played, read from the tokens, so a
 *  longer token never takes the class off mid-tint (Tasks 5-6 review, M3).
 *  A timer is not a frame clock: --motion-slow of slack lets the last frame
 *  paint first. */
export function arrivalMs(): number {
  return Math.max(tokenMs("--motion-spring"), tokenMs("--motion-tint")) + tokenMs("--motion-slow");
}

/** Marks `ids` as arrived now in the marks `read` returns and `write` stores,
 *  and takes them off once they have played. */
export function markArrived(
  read: () => Record<string, number>,
  write: (next: Record<string, number>) => void,
  ids: readonly string[],
) {
  if (ids.length === 0) return;
  // A monotonic clock, not the wall clock (which the tests hold still).
  const at = performance.now();
  write({ ...read(), ...Object.fromEntries(ids.map((id) => [id, at])) });
  setTimeout(() => {
    // By time, not by id: a row that took its real id meanwhile moved its mark.
    const now = read();
    const done = Object.keys(now).filter((id) => now[id] <= at);
    if (done.length === 0) return;
    const next = { ...now };
    for (const id of done) delete next[id];
    write(next);
  }, arrivalMs());
}

/** How far into its slide a row the list mounts now is: a row scrolled into
 *  view partway through picks the slide up where it is (a negative delay). */
export function slideDelayOf(arrivedAt: number | undefined): number {
  return arrivedAt === undefined ? 0 : Math.max(0, performance.now() - arrivedAt);
}
