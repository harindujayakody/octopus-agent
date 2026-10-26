import { useLayoutEffect, useRef, type RefObject } from "react";

// Scroll offsets by place, for this session only: a relaunch starts at the
// top (6.2), a page switch does not (WIG-06). Keys name one list on one page:
// `profiles:<folder>:<view>`, `proxies`, `trash`, `settings:<tab>` and so on.
const offsets = new Map<string, number>();
/** Places still being restored (their content is loading), by key. */
const pending = new Map<string, () => void>();

/// Keeps a scroll box's place per `key`: saved as it scrolls (once a frame),
/// put back when the box mounts or its key changes (a Folder, a View, a tab).
/// Content that arrives later (a list that loads) is waited for, until the
/// user scrolls; an empty key keeps nothing.
export function useScrollMemory(ref: RefObject<HTMLElement | null>, key: string): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || key === "") return;
    let target = offsets.get(key) ?? 0;
    // Where this hook last put the box, so its own move is not taken for the user's.
    let placed = -1;
    const grow = new ResizeObserver(() => restore());
    const stop = () => { target = 0; grow.disconnect(); pending.delete(key); };
    const restore = () => {
      if (!target) return;
      el.scrollTop = target;
      placed = el.scrollTop;
      if (placed >= target - 1) stop();
    };
    // A place with nothing kept starts at the top (a Folder seen for the first time).
    if (!target) el.scrollTop = 0;
    restore();
    if (target) {
      pending.set(key, stop);
      grow.observe(el);
      for (const child of Array.from(el.children)) grow.observe(child);
    }
    // The offset as the last scroll event saw it. The cleanup never reads the
    // box: on a change of place (a Folder with fewer rows) the new rows are
    // already in, and the browser has cut the old offset down.
    let last = el.scrollTop;
    let frame = 0;
    const onScroll = () => {
      last = el.scrollTop;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // The user's own scroll wins over a place still being restored.
        if (target && last !== placed) stop();
        if (!target) offsets.set(key, last);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      // A place not reached yet stays as it was saved.
      if (!target) offsets.set(key, last);
      stop();
    };
  }, [ref, key]);
}

/** A place that should start at the top next time (a new search). */
export function forgetScroll(key: string): void {
  offsets.delete(key);
  pending.get(key)?.();
}

/// A new search, filter or order starts at the top of `key`'s place. The
/// first render does not, nor a change of place that brings its own query
/// (a View brings its filters and order): that place comes back. Call it
/// before `useScrollMemory`, so the memory reads what this forgot.
export function useScrollReset(ref: RefObject<HTMLElement | null>, key: string, query: readonly unknown[]): void {
  const last = useRef<{ key: string; query: readonly unknown[] } | null>(null);
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { key, query };
    if (!prev || prev.key !== key || prev.query.every((v, i) => Object.is(v, query[i]))) return;
    forgetScroll(key);
    if (ref.current) ref.current.scrollTop = 0;
  });
}
