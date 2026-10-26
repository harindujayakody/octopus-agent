import { useEffect, useState, useSyncExternalStore } from "react";

/// The current time in ms, ticking every `intervalMs` (one minute by
/// default) while mounted. Call this once in a list and pass the value down
/// to its rows, so "12 min ago" stays true while the app stays open without
/// a timer per row.
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// The minute clock: one time, one timer, for everything that reads it (the
// Profiles list's rows, its order and filters, its keys and selection), so
// they all move on the same tick. The timer runs while something on screen
// reads the clock.
let minute = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      minute = Date.now();
      for (const l of listeners) l();
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    clearInterval(timer);
    timer = undefined;
  };
}

/// The minute clock's time, ms. While nothing reads it on screen the timer
/// is off, and a read takes the time again, so a list that mounts shows the
/// time now (as `useNow` does); reads within the same second get the same
/// value, as React needs from a store.
export function minuteNow(): number {
  if (listeners.size === 0 && Math.abs(Date.now() - minute) >= 1000) minute = Date.now();
  return minute;
}

/// Reads the minute clock through `select`. A component renders again only
/// when what it selects changes: one that does not need the time on this
/// render selects a constant and skips the tick.
export function useMinuteClock<T>(select: (now: number) => T): T {
  return useSyncExternalStore(subscribe, () => select(minuteNow()));
}
