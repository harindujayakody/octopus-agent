import { toast, useToastStore } from "../model/toast";

/** `failTitle` may be worked out when the delete fails (a bulk delete names
 *  only what failed). */
type FailTitle = string | (() => string);
type Pending = { commit: () => Promise<void>; restore: () => void; failTitle: FailTitle; running?: Promise<void> };
const pending = new Map<string, Pending>();

/// Whether `key` is hidden and waiting for its toast (reloads keep it hidden).
export const isPendingDelete = (key: string) => pending.has(key);

function run(key: string): Promise<void> {
  const p = pending.get(key);
  if (!p) return Promise.resolve();
  p.running ??= p.commit().then(
    () => { pending.delete(key); },
    (e) => {
      pending.delete(key);
      p.restore();
      toast.fail({ title: typeof p.failTitle === "function" ? p.failTitle() : p.failTitle, detail: e });
    },
  );
  return p.running;
}

/// Runs one pending delete now (an action that needs it gone first).
export const flushDelete = (key: string) => run(key);
/// Runs every pending delete now: the window is going away.
export const flushDeletes = () => Promise.all([...pending.keys()].map(run)).then(() => {});

/// A delete that can be taken back (ruling 18): `hide` at once, a toast with
/// Undo for 6 s, and `commit` (the real delete command) when the toast goes
/// without Undo, when `flushDelete` asks, or when the window hides. A failed
/// commit puts the thing back and says so.
export function deferDelete(o: {
  key: string;
  title: string;
  detail?: string;
  failTitle: FailTitle;
  hide: () => void;
  restore: () => void;
  commit: () => Promise<void>;
  action?: { label: string; run: () => void };
}): void {
  if (pending.has(o.key)) return;
  const entry: Pending = { commit: o.commit, restore: o.restore, failTitle: o.failTitle };
  pending.set(o.key, entry);
  o.hide();
  let undone = false;
  const id = toast.undo(o.title, () => {
    undone = true;
    if (entry.running) return; // already running: too late to take back
    pending.delete(o.key);
    o.restore();
  }, {
    detail: o.detail,
    // The action needs the delete done first; it runs after a failure too
    // (the toast has said so), and works on what really went.
    action: o.action && { label: o.action.label, run: () => { void run(o.key).then(() => o.action!.run()); } },
  });
  // The toast leaving without Undo commits. Undo (button or Cmd/Ctrl+Z)
  // dismisses first and calls onUndo in the same task, so decide a microtask later.
  const stop = useToastStore.subscribe((s) => {
    const item = s.items.find((i) => i.id === id);
    if (item && !item.leaving) return;
    stop();
    queueMicrotask(() => { if (!undone) void run(o.key); });
  });
}

// A window that closes may end the process before the command returns; the
// delete is then lost, never half-done (the thing stays).
if (typeof window !== "undefined") window.addEventListener("pagehide", () => { void flushDeletes(); });
