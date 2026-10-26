import { useCallback, useEffect, useRef, useState } from "react";

/** For `.scrollbar-on-scroll`: `data-scrolling` while the list scrolls and 700 ms after.
 *  Spread `props` on the scroll box. */
export function useScrollingFlag() {
  const [scrolling, setScrolling] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onScroll = useCallback(() => {
    setScrolling(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setScrolling(false), 700);
  }, []);
  return { "data-scrolling": scrolling ? "" : undefined, onScroll } as const;
}
