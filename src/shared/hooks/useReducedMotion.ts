import { useSyncExternalStore } from "react";
import { prefersReducedMotion } from "@proxyshard/shardx-ui-kit";

// One watcher for every reader: the OS setting and Settings' switch (which
// writes data-reduce-motion on <html>).
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stop) {
    const fire = () => { for (const l of listeners) l(); };
    const observer = new MutationObserver(fire);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduce-motion"] });
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    query?.addEventListener?.("change", fire);
    stop = () => { observer.disconnect(); query?.removeEventListener?.("change", fire); };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stop?.();
    stop = null;
  };
}

/// Whether Reduce motion is on (the OS or Settings), as a value a component
/// renders from: it changes the moment either one does, so a one-shot
/// motion cut short by it can be taken off rather than wait for an end
/// event that never comes.
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion);
}
