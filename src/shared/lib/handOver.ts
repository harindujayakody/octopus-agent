/// Values this window kept in its own storage that the backend keeps now.
/// They go over once: the keys are removed as soon as the backend has them.

/** The part of `localStorage` a hand-over uses. */
export type KeyStore = Pick<Storage, "getItem" | "removeItem">;

/** This window's storage, or null where it is blocked. */
export function windowStorage(): KeyStore | null {
  try { return window.localStorage; } catch { return null; }
}

/** Sends what is under `keys` (null where missing) if any is there, then removes them; true when sent.
 *  A failed send keeps the keys for the next start. */
export async function handOver(
  store: KeyStore | null,
  keys: readonly string[],
  send: (raw: Record<string, string | null>) => Promise<unknown>,
): Promise<boolean> {
  if (!store) return false;
  const raw: Record<string, string | null> = {};
  try {
    for (const key of keys) raw[key] = store.getItem(key);
  } catch { return false; }
  if (keys.every((key) => raw[key] === null)) return false;
  await send(raw);
  try {
    for (const key of keys) store.removeItem(key);
  } catch { /* blocked now: sent again next start, which the backend ignores */ }
  return true;
}
