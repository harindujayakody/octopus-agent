/// What the palette has run, so what is used comes first (EMIL-16). Frontend
/// only, in this window's storage: { [result id]: { n: runs, last: ms } }.
export const RECENT_KEY = "shardx.palette.recent";
/** A use loses half its weight a week (ruling 12). */
const HALF_LIFE_MS = 7 * 86_400_000;
/** At most this many ids are kept, the least recent dropped. */
const MAX = 50;

type Entry = { n: number; last: number };

function read(): Record<string, Entry> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, Entry> = {};
    for (const [id, e] of Object.entries(value as Record<string, Partial<Entry>>)) {
      if (typeof e?.n === "number" && typeof e?.last === "number") out[id] = { n: e.n, last: e.last };
    }
    return out;
  } catch {
    return {};
  }
}

/// Stored newest first; the one just used goes ahead of any used at the same
/// moment, so a tie in weight goes to the latest (a frozen test clock, two
/// runs in one millisecond).
export function recordUse(id: string, now = Date.now()): void {
  const { [id]: was, ...rest } = read();
  const used: [string, Entry] = [id, { n: (was?.n ?? 0) + 1, last: now }];
  const kept = [used, ...Object.entries(rest)].sort((a, b) => b[1].last - a[1].last).slice(0, MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(Object.fromEntries(kept))); } catch { /* private mode: not remembered */ }
}

/** Each used id's weight now: its runs, halved for every week since the last; newest first. */
export function recentWeights(now = Date.now()): Map<string, number> {
  return new Map(Object.entries(read()).map(([id, e]) => [id, e.n * 0.5 ** ((now - e.last) / HALF_LIFE_MS)]));
}
