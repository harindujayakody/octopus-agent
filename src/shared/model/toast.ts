import { create } from "zustand";
import type { ToastAction, ToastItem } from "../types";
import { t as tr } from "../i18n";
import { explainError } from "../lib/errors";

/// Every outcome the app reports without a surface of its own, and every one
/// closes on its own: a save 3 s; ok and info 5 s; an error, a warning and
/// any toast with an action 8 s; Undo 6 s (spec, overview 6.2; clarity fixes,
/// item 3). The same toast again replaces the first, restarts its time and
/// shows no count. At most three show; older plain toasts give way, an Undo
/// that is still running and an error never do, and the toast just raised
/// always shows (the oldest waits behind "N more"). A toast's time counts
/// only while it shows, and every timer waits while the pointer or the
/// keyboard is on the stack and while the window is hidden or in the
/// background (EMIL-17, A11Y-05, IFACE-06).
export const MAX_VISIBLE = 3;
const OK_MS = 5000;
const LONG_MS = 8000;
const UNDO_MS = 6000;
const SAVED_MS = 3000;
/** A toast that offers a next step stays long enough to take it. */
const lasts = (action?: ToastAction) => (action ? LONG_MS : OK_MS);

/** The toasts that show: the newest three. An Undo that is still running and
 *  a progress always show: they are the ones that expire or move, so hiding
 *  one behind three errors would lose it (Review focus 4). */
export function frontOf(live: ToastItem[]): ToastItem[] {
  const keep = (i: ToastItem) => !!i.onUndo || i.kind === "progress";
  const pinned = live.filter(keep).slice(-MAX_VISIBLE);
  const room = MAX_VISIBLE - pinned.length;
  const rest = room > 0 ? live.filter((i) => !keep(i)).slice(-room) : [];
  const ids = new Set([...pinned, ...rest].map((i) => i.id));
  return live.filter((i) => ids.has(i.id));
}

export type PauseReason = "pointer" | "focus" | "hidden" | "blur";
type Timer = { handle?: ReturnType<typeof setTimeout>; remaining: number; startedAt: number };
// The monotonic clock: it does not jump with the system time, and a test can
// move it with the page clock while Date stays fixed.
const tick = () => performance.now();

type ToastState = {
  items: ToastItem[];
  push: (item: Omit<ToastItem, "id" | "raised">, ms: number | null) => number;
  update: (id: number, patch: Partial<Omit<ToastItem, "id">>, ms?: number | null) => void;
  /** Starts its exit; the host removes it when the exit ends. */
  dismiss: (id: number) => void;
  remove: (id: number) => void;
  pause: (reason: PauseReason) => void;
  resume: (reason: PauseReason) => void;
  /** Runs the newest toast's Undo; false when no toast has one. */
  undoLatest: () => boolean;
};

let seq = 0;
const timers = new Map<number, Timer>();
const paused = new Set<PauseReason>();

export const useToastStore = create<ToastState>((set, get) => {
  const live = () => get().items.filter((i) => !i.leaving);
  // A timer runs only while its toast shows and nothing holds the stack; a
  // stopped one keeps the time it has left. Called after every change that
  // can move a toast into or out of the three that show.
  const sync = () => {
    const shown = new Set(frontOf(live()).map((i) => i.id));
    const now = tick();
    for (const [id, tm] of timers) {
      const go = paused.size === 0 && shown.has(id);
      if (go && tm.handle === undefined) {
        tm.startedAt = now;
        tm.handle = setTimeout(() => get().dismiss(id), tm.remaining);
      } else if (!go && tm.handle !== undefined) {
        clearTimeout(tm.handle);
        tm.handle = undefined;
        tm.remaining = Math.max(0, tm.remaining - (now - tm.startedAt));
      }
    }
  };
  const arm = (id: number, ms: number | null) => {
    clearTimeout(timers.get(id)?.handle);
    if (ms === null) timers.delete(id);
    else timers.set(id, { remaining: ms, startedAt: tick() });
    sync();
  };
  const same = (a: ToastItem, b: Omit<ToastItem, "id" | "raised">) =>
    a.kind === b.kind && a.title === b.title && a.detail === b.detail && !a.onUndo && !b.onUndo && a.kind !== "progress";

  return {
    items: [],
    push: (item, ms) => {
      const twin = live().find((i) => same(i, item));
      if (twin) {
        // The newest copy replaces the first, action included (its Open opens
        // the latest copy), and moves to the end, where the newest sits. Its
        // time starts again; nothing counts the repeats on screen.
        const merged = { ...item, id: twin.id, raised: twin.raised + 1 };
        set((s) => ({ items: [...s.items.filter((i) => i.id !== twin.id), merged] }));
        arm(twin.id, ms);
        return twin.id;
      }
      const id = ++seq;
      set((s) => ({ items: [...s.items, { ...item, id, raised: 1 }] }));
      // Past three, the oldest plain toast gives way (never an Undo, an error
      // or a progress, and never the toast just raised: with no older plain
      // one, the oldest waits behind "N more" instead).
      const showing = live();
      if (showing.length > MAX_VISIBLE) {
        const drop = showing.find((i) => i.id !== id && (i.kind === "ok" || i.kind === "info") && !i.onUndo);
        if (drop) get().dismiss(drop.id);
      }
      arm(id, ms);
      return id;
    },
    update: (id, patch, ms) => {
      set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
      // A progress that ends is no longer pinned: the three that show can change.
      if (ms !== undefined) arm(id, ms);
      else sync();
    },
    dismiss: (id) => {
      clearTimeout(timers.get(id)?.handle);
      timers.delete(id);
      set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, leaving: true } : i)) }));
      // A toast waiting behind "N more" moves up, and its time starts now.
      sync();
    },
    remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
    pause: (reason) => {
      paused.add(reason);
      sync();
    },
    resume: (reason) => {
      // Only a hold that is on ends: a second resume must not restart the
      // timers that already run with their full time.
      if (!paused.delete(reason)) return;
      sync();
    },
    undoLatest: () => {
      const item = [...live()].reverse().find((i) => i.onUndo);
      if (!item) return false;
      // Gone first: a second press must not undo twice.
      get().dismiss(item.id);
      item.onUndo!();
      return true;
    },
  };
});

/** How far up from the list column's bottom edge the stack reaches, with air
 *  above it, while it holds a long toast (an error or a warning, 8 s),
 *  in layout px; 0 otherwise. ToastHost measures it; the lists
 *  keep that much scroll room at their end, so every row can scroll clear of
 *  the stack (Pair 14 review). */
export const useToastReach = create<{ px: number }>(() => ({ px: 0 }));

/** The detail line of an error: explained when the failure is known (G3). */
const detailOf = explainError;

export type ToastProgress = {
  id: number;
  update: (done: number, title?: string) => void;
  /** `tone`: "info" when nothing failed but nothing was done either (no success mark). */
  done: (summary: { title: string; detail?: string; failed?: number; action?: ToastAction; tone?: "ok" | "info" }) => void;
};

// Titles are translated here: a toast is raised from stores and helpers as
// often as from a component, and `tr` only replaces a string the dictionary
// holds (a backend message passes through as it came).
const push = (item: Omit<ToastItem, "id" | "raised">, ms: number | null) => useToastStore.getState().push(item, ms);

export const toast = {
  ok: (title: string, opts?: { detail?: string; action?: ToastAction }) => push({ kind: "ok", title: tr(title), ...opts }, lasts(opts?.action)),
  info: (title: string, opts?: { detail?: string; action?: ToastAction }) => push({ kind: "info", title: tr(title), ...opts }, lasts(opts?.action)),
  /** Every save made by hand says so, briefly: "{name} saved", "Settings saved". */
  saved: (title: string) => push({ kind: "ok", title: tr(title) }, SAVED_MS),
  /** A raw error text. It closes after 8 s; G3 moves every caller to
   *  `fail`. The proxy-missing starts still pass their Assign action here. */
  err: (text: string, opts?: { detail?: string; action?: ToastAction }) => push({ kind: "err", title: tr(text), ...opts }, LONG_MS),
  /** What failed (a translated title naming the subject), why (the raw error as detail), what to do (an action). */
  fail: ({ title, detail, subject, action }: { title: string; detail?: unknown; subject?: string; action?: ToastAction }) =>
    push({ kind: "err", title: tr(title), detail: detailOf(detail), subject, action }, LONG_MS),
  /** Something worked, with a catch the user must see (a launcher warning).
   *  Closes after 8 s, like an error; drawn as a warning. */
  warn: ({ title, detail, action }: { title: string; detail?: unknown; action?: ToastAction }) =>
    push({ kind: "warn", title: tr(title), detail: detailOf(detail), action }, LONG_MS),
  /** "Deleted …" with an Undo button (and Cmd/Ctrl+Z) for about 6 s.
   *  `action` shows beside Undo ("Assign replacements…"). */
  undo: (title: string, onUndo: () => void, opts?: { detail?: string; action?: ToastAction }) =>
    push({ kind: "info", title: tr(title), detail: opts?.detail, action: opts?.action, onUndo }, UNDO_MS),
  /** One toast for a bulk action: it counts up in place, then becomes the result. */
  progress: ({ title, total }: { title: string; total: number }): ToastProgress => {
    const id = push({ kind: "progress", title: tr(title), progress: { done: 0, total } }, null);
    const store = useToastStore.getState();
    // Still on screen: not dismissed while it ran.
    const here = () => useToastStore.getState().items.some((i) => i.id === id && !i.leaving);
    return {
      id,
      update: (done, next) => { if (here()) store.update(id, { progress: { done, total }, ...(next ? { title: tr(next) } : {}) }); },
      done: ({ title: end, detail, failed = 0, action, tone = "ok" }) => {
        const result = { kind: failed > 0 ? "err" as const : tone, title: tr(end), detail, action, progress: undefined };
        const ms = failed > 0 ? LONG_MS : lasts(action);
        if (here()) store.update(id, result, ms);
        // Dismissed while it ran: a failure is still reported, as a new toast
        // (errors are never lost, Review focus 4).
        else if (failed > 0) push(result, ms);
      },
    };
  },
  dismiss: (id: number) => useToastStore.getState().dismiss(id),
};
