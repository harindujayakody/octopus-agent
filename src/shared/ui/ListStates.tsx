import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button, Card, EmptyState } from "@proxyshard/shardx-ui-kit";
import { AlertIcon } from "../icons";
import { useT } from "../i18n";
import { SKELETON_DELAY_MS } from "../hooks/useHeldLoading";
import { sharedTimeout } from "../lib/sharedTimeout";
import { listStop, pageTitle, useFocusHandOff } from "../lib/focus";

/// Centers a list's empty, no-match or error state in the list's own visible
/// area (its scroll container's client box, or a flex-filled box standing in
/// for one), not wherever it lands in a wider or shorter content wrapper.
/// `flex-1` fills a flex-column ancestor (Trash, Bookmarks…); `h-full w-full`
/// fills an absolutely positioned overlay (ProfileTable, ProxyList).
export function ListStateCenter({ children }: { children: ReactNode }) {
  return <div className="flex h-full w-full flex-1 items-center justify-center">{children}</div>;
}

/// A list's first load: placeholder rows where the rows will be, never a
/// "nothing yet" that turns out to be wrong a moment later. They wait
/// `delay` ms first, so a quick answer shows none (WIG-12); screen readers
/// hear "Loading" at once. The wait starts in a layout effect, in the same
/// commit as `useHeldLoading`'s clock and in the same task, and the rows
/// commit the moment it ends, so the list's hold counts from when they
/// really show. `card` frames
/// them in a card of their own (a card grid's first load), drawn only with
/// the rows: an empty frame during the wait would itself flicker. They never
/// claim `aria-busy` themselves: the list's own element does (the treegrid
/// or list, A11Y-22, PC-122). `inGrid`: they sit inside that list, so they
/// are hidden from screen readers and say nothing. Their lines take no layout, and the last draws none, so it never
/// doubles the card's edge (PC-123).
export function LoadingRows({ rows = 6, rowHeight = 36, delay = SKELETON_DELAY_MS, card = false, inGrid = false }: { rows?: number; rowHeight?: number; delay?: number; card?: boolean; inGrid?: boolean }) {
  const t = useT();
  const [shown, setShown] = useState(delay <= 0);
  useLayoutEffect(() => {
    if (shown) return;
    return sharedTimeout(delay, () => flushSync(() => setShown(true)));
  }, [shown, delay]);
  if (!shown) return inGrid ? null : <div><span className="sr-only">{t("listStates.loading")}</span></div>;
  const placeholders = (
    <div data-loading aria-hidden={inGrid || undefined} className="flex flex-col">
      {!inGrid && <span className="sr-only">{t("listStates.loading")}</span>}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex items-center px-3 shadow-[inset_0_-1px_0_var(--color-stroke-soft-200)] last:shadow-none" style={{ height: rowHeight }}>
          <div className="h-[8px] rounded-full bg-bg-weak-50 animate-pulse reduced:animate-none" style={{ width: `${60 - (i % 3) * 12}%` }} />
        </div>
      ))}
    </div>
  );
  return card ? <Card>{placeholders}</Card> : placeholders;
}

/// A card grid's first load: blocks where the cards will be (LAYOUT-21), not
/// rows in a card. The one card width every grid uses (the kit DataList's
/// 240; `minWidth` for a grid whose cards are wider), the same gap. `height`:
/// the cards' own, so nothing jumps when they arrive. They wait `delay` ms and are held as `LoadingRows`
/// are (WIG-12, `useHeldLoading`), so a quick answer shows none. The busy
/// flag is the list's (DataList's busy `list`), not theirs.
export function LoadingCards({ count = 6, minWidth = 240, height = 88, delay = SKELETON_DELAY_MS }: { count?: number; minWidth?: number; height?: number; delay?: number }) {
  const t = useT();
  const [shown, setShown] = useState(delay <= 0);
  useLayoutEffect(() => {
    if (shown) return;
    return sharedTimeout(delay, () => flushSync(() => setShown(true)));
  }, [shown, delay]);
  if (!shown) return <div><span className="sr-only">{t("listStates.loading")}</span></div>;
  return (
    <div data-loading className="grid gap-[10px]" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))` }}>
      <span className="sr-only">{t("listStates.loading")}</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden="true" className="rounded-tile bg-bg-weak-50 animate-pulse reduced:animate-none" style={{ height }} />
      ))}
    </div>
  );
}

/// A list that failed to load: what failed, why, and Retry. Its title is an
/// h2 under the page title; pass 3 inside a panel or card with its own h2.
/// `className` reaches the state (a dialog that keeps its height takes the
/// state's own top and bottom room away).
export function LoadError({ what, error, onRetry, headingLevel, className }: {
  what: string;
  error: string | null;
  onRetry: () => void;
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const t = useT();
  // Retry takes the error away, and Retry with it: the list's row, or the
  // page title while it loads, takes the keyboard; inside a dialog or Peek,
  // their first control (PC-121).
  const retry = useRef<HTMLSpanElement>(null);
  useFocusHandOff(retry, (from) => {
    const box = from?.closest<HTMLElement>("[role='dialog'], [role='alertdialog'], [data-peek]");
    if (box) return box.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea, [href], [tabindex='0']");
    return listStop() ?? pageTitle();
  });
  return (
    <EmptyState
      className={className}
      headingLevel={headingLevel}
      icon={<AlertIcon />}
      title={t("listStates.loadFailed", { what })}
      // The backend's error, which a person copies into a report (WIG-04).
      hint={error ? <span data-selectable>{error}</span> : undefined}
      actions={(
        <span ref={retry} className="contents">
          <Button variant="neutral" mode="stroke" size="xsmall" onClick={onRetry}>{t("listStates.retry")}</Button>
        </span>
      )}
    />
  );
}
