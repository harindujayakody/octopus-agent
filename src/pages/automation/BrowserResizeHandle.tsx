import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useT } from "../../shared/i18n";

export const BROWSER_MIN = 320;
export const BROWSER_DEFAULT = 440;
/** Canvas floor 360, side panel 320 and two 12 px gaps. */
export const BROWSER_RESERVED = 704;
const KEY = "shardx.automation.browserWidth";

export function loadBrowserWidth(): number {
  try {
    const n = Number(JSON.parse(localStorage.getItem(KEY) ?? "null"));
    if (Number.isFinite(n) && n >= BROWSER_MIN) return Math.round(n);
  } catch { /* a broken value: the default */ }
  return BROWSER_DEFAULT;
}

export function saveBrowserWidth(w: number) {
  try { localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* private mode */ }
}

/// A drag handle on the browser column's left edge, in the gap. Invisible at
/// rest; a 2 px line on hover, focus or drag. `width` is the shown width.
/// Dragging left widens. While a drag runs a transparent shield covers the
/// page so the live view never swallows the pointer.
export function BrowserResizeHandle({
  width, min, max, onChange, onCommit, onReset,
}: {
  width: number;
  min: number;
  max: number;
  onChange: (w: number) => void;
  onCommit: (w: number) => void;
  onReset: () => void;
}) {
  const t = useT();
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, w: 0 });
  const last = useRef(width);
  last.current = width;
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));

  useEffect(() => {
    if (!dragging) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    return () => { document.body.style.cursor = prev; };
  }, [dragging]);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: width };
    setDragging(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    onChange(clamp(start.current.w + (start.current.x - e.clientX)));
  };
  const up = () => {
    if (!dragging) return;
    setDragging(false);
    onCommit(last.current);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = width + step;
    else if (e.key === "ArrowRight") next = width - step;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    if (next === null) return;
    e.preventDefault();
    const w = clamp(next);
    onChange(w);
    onCommit(w);
  };

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("projectEditor.browserWidth")}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        data-browser-resize
        data-dragging={dragging ? "" : undefined}
        className="group absolute -left-[10px] top-0 z-10 h-full w-[8px] cursor-col-resize touch-none outline-hidden"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onDoubleClick={onReset}
        onKeyDown={key}
      >
        <span className="pointer-events-none absolute bottom-0 left-[3px] top-0 w-[2px] rounded-full bg-stroke-sub-300 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[dragging]:opacity-100" />
      </div>
      {dragging && <div data-browser-resize-shield className="fixed inset-0 z-50 cursor-col-resize" />}
    </>
  );
}
