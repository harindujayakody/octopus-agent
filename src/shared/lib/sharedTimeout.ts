/// Timers of one length started in one pass (one commit's effects run
/// together) share one task: their callbacks run back to back, in the order
/// they were started, and no other task (an IPC reply, a render) can land
/// between them. Returns a cancel for this callback alone.
const open = new Map<number, Set<() => void>>();

export function sharedTimeout(ms: number, fn: () => void): () => void {
  let batch = open.get(ms);
  if (!batch) {
    const fresh = new Set<() => void>();
    open.set(ms, fresh);
    // The pass ends with this task: a timer started later gets its own.
    queueMicrotask(() => { if (open.get(ms) === fresh) open.delete(ms); });
    setTimeout(() => { for (const f of [...fresh]) if (fresh.has(f)) f(); }, ms);
    batch = fresh;
  }
  const mine = batch;
  mine.add(fn);
  return () => { mine.delete(fn); };
}
