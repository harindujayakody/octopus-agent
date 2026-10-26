import { useLayoutEffect, useRef, useState } from "react";

const NONE: ReadonlySet<string> = new Set();

/// The ids that joined a store's list after its first load (a create, an
/// import, one added through the API), for the kit DataList's one slide-in
/// (`arrived`, Live layer). Read from the store's own items, never from what
/// a search or a filter shows, so clearing a filter slides nothing in; and
/// nothing counts until `ready`, since the first load is the list itself.
/// Set in a layout effect: the row gets its mark before the frame is painted.
export function useArrivedIds(ids: readonly string[], ready: boolean): ReadonlySet<string> {
  const known = useRef<Set<string> | null>(null);
  const [arrived, setArrived] = useState<ReadonlySet<string>>(NONE);
  const key = ids.join("\n");
  useLayoutEffect(() => {
    if (!ready) return;
    const now = key ? key.split("\n") : [];
    if (!known.current) {
      known.current = new Set(now);
      return;
    }
    const seen = known.current;
    const fresh = now.filter((id) => !seen.has(id));
    for (const id of fresh) seen.add(id);
    if (fresh.length > 0) setArrived((prev) => new Set([...prev, ...fresh]));
  }, [key, ready]);
  return arrived;
}
