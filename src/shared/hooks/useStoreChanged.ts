import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

// Reload when the backend signals an out-of-band store change: a profile or
// proxy created, edited or removed through the automation API or MCP writes
// straight to disk, so the React state never hears about it on its own. The
// backend emits "store-changed" with the kind that changed as its payload
// ("profiles", "proxies", "extensions", "bookmarks", "trash", "automation").
// `topics` limits a listener to the kinds it shows (PERF-22); a payload that
// is not a string still reloads. Bursts (MCP adding many proxies in a loop)
// are coalesced into one reload.
export function useStoreChanged(onChange: () => void, topics?: readonly string[]) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const wanted = useRef(topics);
  wanted.current = topics;
  useEffect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    listen<unknown>("store-changed", (e) => {
      const topic = typeof e.payload === "string" ? e.payload : null;
      if (topic && wanted.current && !wanted.current.includes(topic)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), 200);
    }).then((fn) => {
      if (disposed) fn();
      else un = fn;
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      un?.();
    };
  }, []);
}
