// Cross-store refresh signal. Two stores own the proxy list; importing one
// from the other would close a cycle, so they meet here instead. Each event
// says who raised it, so a store can skip its own echo: its change is
// already on screen (PERF-13).
/// "trash": profiles went into the Trash or came out of it from outside the
/// Trash store (Move to Trash, its Undo, another window), so its copy is stale.
type Topic = "proxies" | "profiles" | "extensions" | "fingerprints" | "trash";
/** A store (by the topic it owns), the Trash, or the UI. */
export type Origin = Topic | "trash" | "ui";

const subs: Record<Topic, Set<(from: Origin) => void>> = {
  proxies: new Set(),
  profiles: new Set(),
  extensions: new Set(),
  fingerprints: new Set(),
  trash: new Set(),
};

export const storeBus = {
  on(topic: Topic, fn: (from: Origin) => void): () => void {
    subs[topic].add(fn);
    return () => subs[topic].delete(fn);
  },
  emit(topic: Topic, from: Origin = "ui"): void {
    for (const fn of subs[topic]) fn(from);
  },
};
