import { useEffect, useRef, useState, type ReactNode } from "react";
import { Portal, clientScale, pageZoom, pointToLayout, rectToLayout } from "@proxyshard/shardx-ui-kit";
import { placeBefore, sameSet, type ColumnSet, type ColumnsApi } from "../../lib/tableColumns";

type Drag<Id extends string> = { id: Id; title: string; x: number; y: number; line: number | null };

/// Dragging a column title to a new place (owner feature 2026-09-26). A
/// press becomes a drag after 4 px; a marker shows where the column lands
/// (before the first column whose middle is right of the pointer, or after
/// the last) while the pointer is over the header row. Let go outside the
/// header — over the rows, the sidebar, anywhere else — cancels the drag:
/// the marker hides there too (fix round 1 item 5; Review Focus 3). Esc or
/// a cancelled pointer also leaves the order as it was. Name can't move and
/// nothing lands before it (`placeBefore`). The keyboard's way is Move left
/// and Move right in the column's menu.
export function useColumnDrag<Id extends string>({ api, rowRef, onMoved }: {
  api: ColumnsApi<Id>;
  rowRef: React.RefObject<HTMLElement | null>;
  onMoved: (next: ColumnSet<Id>, id: Id) => void;
}): { start: (e: React.PointerEvent<HTMLElement>, id: Id, title: string) => void; dragging: Id | null; node: ReactNode } {
  const [drag, setDrag] = useState<Drag<Id> | null>(null);
  // A gesture that loses its element (the title unmounts mid-drag: the
  // list's section is left, the column itself was hidden from elsewhere)
  // never gets a pointerup: `lostpointercapture` and this unmount cleanup
  // both end it (fix round 1 item 4), so `html[data-column-gesture]` cannot
  // stick with every element `grabbing` and unselectable.
  const endRef = useRef<(() => void) | null>(null);
  useEffect(() => () => endRef.current?.(), []);

  const start = (e: React.PointerEvent<HTMLElement>, id: Id, title: string) => {
    const row = rowRef.current;
    if (e.button !== 0 || !row) return;
    const el = e.currentTarget;
    const pointer = e.pointerId;
    const x0 = e.clientX;
    const y0 = e.clientY;
    // The marker and the ghost are placed in layout px, and every compare is
    // in layout px too. Under Interface size (CSS zoom) the pointer converts
    // by the page zoom and rects by their own scale: older WebKit reports
    // rects zoom-adjusted and the pointer not (Task 14 review, Important 2).
    const z = pageZoom();
    const k = clientScale();
    const rectOf = (node: HTMLElement) => rectToLayout(node.getBoundingClientRect(), k);
    const movable = new Set(api.defs.filter((d) => d.movable).map((d) => d.id));
    let moving = false;
    let before: Id | null | undefined;
    // Every move and the let-go reach the title, wherever the pointer goes.
    el.setPointerCapture(pointer);
    // Where it would land for pointer `x` (layout px); returns the marker's
    // `left` in the row, layout px: 5 layout px out from the title's edge.
    // `clientLeft` (layout px too) because an absolute `left` starts inside
    // the border, and the header carries the tile's 4 px transparent side
    // border (owner, 2026-10-02): without it the border ate the gap.
    const aim = (x: number) => {
      const cells = [...row.querySelectorAll<HTMLElement>("[data-col]")].map((c) => ({ id: c.dataset.col as Id, r: rectOf(c) }));
      const next = cells.find((c) => movable.has(c.id) && x < c.r.left + c.r.width / 2);
      before = next ? next.id : null;
      const at = next ? next.r.left - 5 : cells[cells.length - 1].r.right + 5;
      return at - rectOf(row).left - row.clientLeft;
    };
    const onMove = (ev: PointerEvent) => {
      if (!moving) {
        if (Math.abs(ev.clientX - x0) < 4 && Math.abs(ev.clientY - y0) < 4) return;
        moving = true;
        document.documentElement.dataset.columnGesture = "drag";
      }
      const p = pointToLayout({ x: ev.clientX, y: ev.clientY }, z);
      const r = rectOf(row);
      const overHeader = p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
      // Outside the header there is nowhere to land: the marker hides, and a
      // release here cancels (below reads `before === undefined`).
      before = overHeader ? before : undefined;
      setDrag({ id, title, x: p.x, y: p.y, line: overHeader ? aim(p.x) : null });
    };
    const end = (keep: boolean) => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("lostpointercapture", onCancel);
      window.removeEventListener("keydown", onKey, true);
      endRef.current = null;
      if (el.hasPointerCapture(pointer)) el.releasePointerCapture(pointer);
      delete document.documentElement.dataset.columnGesture;
      setDrag(null);
      if (!keep || !moving || before === undefined) return;
      const next = placeBefore(api.defs, api.set, id, before);
      if (sameSet(next, api.set)) return;
      api.setSet(next);
      onMoved(next, id);
    };
    const onUp = () => end(true);
    // A cancelled pointer, or one that loses capture without ever letting go
    // (its element unmounted underneath it): both abandon the drag.
    const onCancel = () => end(false);
    // Esc drops the drag, and only the drag: the list's own Esc (Peek, the
    // selection) never hears it.
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      end(false);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("lostpointercapture", onCancel);
    window.addEventListener("keydown", onKey, true);
    endRef.current = () => end(false);
  };

  const node: ReactNode = drag && (
    <>
      {/* Where it lands: between two titles, inset from the header's
          edges, neutral. A drop mark, not an edge stripe on a card or row.
          Hidden while the pointer is outside the header (fix round 1 item 5):
          there is nowhere to land there. */}
      {drag.line !== null && (
        <div
          aria-hidden="true"
          data-column-drop
          className="pointer-events-none absolute top-1 bottom-1 z-[2] w-[1px] rounded-full bg-stroke-strong-950"
          style={{ left: drag.line - 0.5 }}
        />
      )}
      <Portal>
        <div
          aria-hidden="true"
          data-column-ghost
          className="pointer-events-none fixed z-(--layer-overlay) rounded-chip bg-bg-raised px-2 py-1 text-secondary font-medium text-text-strong-950 shadow-(--shadow-float)"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {drag.title}
        </div>
      </Portal>
    </>
  );
  return { start, dragging: drag?.id ?? null, node };
}
