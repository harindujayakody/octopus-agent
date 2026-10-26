import { useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { layoutRect, pageZoom } from "@proxyshard/shardx-ui-kit";
import { columnVar, type ColumnWidths, type ColumnsApi, type TableLayout } from "../../lib/tableColumns";

/// Dragging a column's edge (owner feature 2026-09-26). While the pointer
/// moves, only custom properties on the list change (`--col-<id>`, which
/// the grid template falls back from), so the header and every row follow
/// without a React render; the widths are stored once, when the pointer lets
/// go. Esc or a cancelled pointer puts it back.
export function useColumnResize<Id extends string>({ api, layout, listRef, wrapRef }: {
  api: ColumnsApi<Id>;
  layout: TableLayout<Id>;
  listRef: React.RefObject<HTMLElement | null>;
  wrapRef: React.RefObject<HTMLElement | null>;
}) {
  // A gesture that loses its element (the edge unmounts mid-resize: the
  // column it belongs to hides, the list's section is left) never gets a
  // pointerup: `lostpointercapture` and this unmount cleanup both end it
  // (fix round 1 item 4), so `html[data-column-gesture]` cannot stick.
  const endRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endRef.current?.(), []);

  return useCallback((e: React.PointerEvent<HTMLElement>, id: Id) => {
    const def = api.defs.find((d) => d.id === id);
    const list = listRef.current;
    const wrap = wrapRef.current;
    const cell = e.currentTarget.closest<HTMLElement>("[data-col]");
    if (e.button !== 0 || !def || !list || !wrap || !cell) return;
    // The edge's press is not the title's drag.
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const pointer = e.pointerId;
    const x0 = e.clientX;
    // Layout px: under Interface size (CSS zoom) the pointer converts by the
    // page zoom and the cell's rect by its own scale (older WebKit reports
    // rects zoom-adjusted and the pointer not).
    const z = pageZoom();
    const from = layout.drawn[id] ?? layoutRect(cell).width;
    const minBefore = wrap.style.minWidth;
    let width = from;
    let preview: { widths: ColumnWidths<Id>; layout: TableLayout<Id> } | null = null;
    handle.setPointerCapture(pointer);
    document.documentElement.dataset.columnGesture = "resize";
    const onMove = (ev: PointerEvent) => {
      width = from + (ev.clientX - x0) / z;
      // The same tracks the stored widths give: nothing moves when it lets go.
      preview = layout.resize(id, width);
      const l = preview.layout;
      for (const c of l.shown) list.style.setProperty(columnVar(c), l.tracks[c]!);
      // The list's minimum grows with the columns: it scrolls, never squeezes.
      wrap.style.minWidth = `${l.minWidth}px`;
    };
    const end = (keep: boolean) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onCancel);
      handle.removeEventListener("lostpointercapture", onCancel);
      window.removeEventListener("keydown", onKey, true);
      endRef.current = null;
      if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
      delete document.documentElement.dataset.columnGesture;
      wrap.style.minWidth = minBefore;
      // Rendered before the live widths go, so no frame shows the old ones.
      // A press that barely moved (a double click's) stores nothing.
      const got = (preview as { widths: ColumnWidths<Id> } | null)?.widths;
      if (keep && got && Math.abs(width - from) >= 1) {
        flushSync(() => {
          for (const c of layout.shown) if (got[c] !== api.widths[c]) api.setWidth(c, got[c] ?? null);
        });
      }
      for (const c of layout.shown) list.style.removeProperty(columnVar(c));
    };
    const onUp = () => end(true);
    // A cancelled pointer, or one that loses capture without ever letting go
    // (its element unmounted underneath it): both abandon the resize.
    const onCancel = () => end(false);
    // Esc drops the resize, and only the resize: the list's own Esc never hears it.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      end(false);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onCancel);
    handle.addEventListener("lostpointercapture", onCancel);
    window.addEventListener("keydown", onKey, true);
    endRef.current = () => end(false);
  }, [api, layout, listRef, wrapRef]);
}
