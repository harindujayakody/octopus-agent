/// Runs `fn` when the browser has nothing else to do. WKWebView (macOS) has
/// no requestIdleCallback, so a short timer stands in there. Returns a cancel.
export function whenIdle(fn: () => void, timeout = 500): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const handle = w.requestIdleCallback(fn, { timeout });
    return () => w.cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(fn, 150);
  return () => clearTimeout(handle);
}
