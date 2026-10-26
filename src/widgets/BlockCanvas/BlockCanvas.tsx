import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, IconButton, Popover, Tooltip, layoutRect, pageZoom, pointerToLayout } from "@proxyshard/shardx-ui-kit";
import {
  branchKind,
  specFor,
  blockIcon,
  type Block,
} from "../../entities/automation";
import { t, useT } from "../../shared/i18n";
import { AddIcon, CloseIcon, HelpCircleIcon, MinusIcon, StepIcon } from "../../shared/icons";

/** A node, the zoom bar and a wire's cut handle are tiles on the canvas, which
 *  is itself a tile: one step up from it (`--bg-on-tile`), laid over the tile's
 *  own opaque color so a wire or a grid dot never shows through. They have no
 *  ring or shadow at rest; a selected node shows its selection ring only. */
const TILE_FILL = "[background:linear-gradient(var(--bg-on-tile),var(--bg-on-tile)),var(--bg-tile)]";
const CARD_W = 210;
// A multiple of the grid, so cards stacked flush land on it and stay docked.
const CARD_H = 60;
const GRID = 20;
const PORT_DONE = 21;
const PORT_FAIL = 43;
/// How close counts as docked.
const SNAP = 12;
/// The zoom range, and one step of the zoom buttons.
const MIN_K = 0.25;
const MAX_K = 2.2;
const ZOOM_STEP = 1.2;
/// Room Fit and the automatic fit leave around the cards.
const FIT_PAD = 24;
/// The automatic fit and Fit never zoom out past this.
const FIT_MIN_K = 0.8;
const HOME = { x: 40, y: 40, k: 1 };
/** The view each project was left at, for this session: leaving the editor and coming back keeps it, and the first fit runs only when a project has none. */
const views = new Map<string, { x: number; y: number; k: number }>();
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

type Port = "done" | "fail";

type Props = {
  blocks: Block[];
  startId: string;
  selected: string | null;
  /** Highlighted while a run is on this step. */
  active?: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onConnect: (from: string, port: Port, to: string | null) => void;
  /** A card was let go docked in a stack: under a card (it joins the bottom
   *  of that stack) or onto one (it takes that card's place and the rest of
   *  the column moves down to make room). */
  onDrop: (dragged: string, at: { under?: string; before?: string }) => void;
  /** A drag of one card or a group ended: the places they were dropped at are final. */
  onMoveEnd: () => void;
  onSetStart: (id: string) => void;
  onDelete: (id: string) => void;
  /** Canvas point where the operator asked for a new block. */
  onAddAt: (x: number, y: number) => void;
  /** The project the blocks belong to: it is fitted once, the first time it opens in a session; after that the view stays where the user left it. */
  resetKey?: string;
};

// The spec's label is a translation key; a block's own label is the name the
// operator gave it when the step was made, and stays as typed.
function title(b: Block): string {
  const spec = specFor(b.kind)?.label;
  return b.label || (spec ? t(spec) : "") || b.kind;
}

/** The input dot's radius: an edge ends on its outer edge, not its centre. */
const IN_DOT = 5;

/** Where an edge leaves a card, and where it arrives. */
function portPoint(b: Block, port: Port) {
  return { x: b.x + CARD_W, y: b.y + (port === "done" ? PORT_DONE : PORT_FAIL) };
}
function inPoint(b: Block) {
  return { x: b.x - IN_DOT, y: b.y + CARD_H / 2 };
}

/** A cubic that leaves rightwards and arrives rightwards, so an edge doubling
 *  back reads as a loop rather than a straight line through the cards. */
function edgePath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = Math.max(50, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

export function BlockCanvas({
  blocks,
  startId,
  selected,
  active,
  onSelect,
  onMove,
  onConnect,
  onDrop,
  onMoveEnd,
  onSetStart,
  onDelete,
  onAddAt,
  resetKey,
}: Props) {
  const t = useT();
  const host = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState(() => (resetKey ? views.get(resetKey) : undefined) ?? HOME);
  const tipsAnchor = useRef<HTMLButtonElement>(null);
  const [tipsOpen, setTipsOpen] = useState(false);
  // The edge under the pointer; its cut handle shows while it is.
  const [hot, setHot] = useState<number | null>(null);
  const [hint, setHint] = useState<{ under?: string; before?: string } | null>(null);
  // Cards picked out with a right-drag box, moved together. `boxed` is true once
  // a right-drag actually swept an area, so the context menu can tell a box
  // select apart from a plain right-click (which adds a step).
  const [sel, setSel] = useState<Set<string>>(new Set());
  const boxed = useRef(false);
  const [drag, setDrag] = useState<
    | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
    | { kind: "card"; id: string; dx: number; dy: number; ox: number; oy: number; freed: boolean }
    | { kind: "multi"; px: number; py: number; start: Map<string, { x: number; y: number }> }
    | { kind: "marquee"; sx: number; sy: number; x: number; y: number }
    | { kind: "wire"; from: string; port: Port; x: number; y: number }
    | null
  >(null);

  const byId = new Map(blocks.map((b) => [b.id, b]));
  // The flow runs the visual stack top-to-bottom (by column, then height), so
  // ordering — the start marker, "next" links, edges — is read off positions,
  // not the list order. Must match the runner's own sort.
  const ordered = [...blocks].sort((a, b) => {
    const ca = Math.round(a.x / 40);
    const cb = Math.round(b.x / 40);
    return ca - cb || a.y - b.y;
  });
  const orderIndex = new Map(ordered.map((b, i) => [b.id, i]));
  const entry = startId && byId.has(startId) ? startId : ordered[0]?.id;

  /** Screen point -> canvas point. Layout px first: under Interface size (CSS zoom) the pointer converts by the page zoom and the host's rect by its own scale (older WebKit reports rects zoom-adjusted and the pointer not). */
  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      if (!host.current) return { x: 0, y: 0 };
      const r = layoutRect(host.current);
      const p = pointerToLayout({ x: clientX, y: clientY });
      return { x: (p.x - r.left - view.x) / view.k, y: (p.y - r.top - view.y) / view.k };
    },
    [view],
  );

  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      if (drag.kind === "pan") {
        const z = pageZoom();
        setView((v) => ({ ...v, x: drag.ox + (e.clientX - drag.sx) / z, y: drag.oy + (e.clientY - drag.sy) / z }));
        return;
      }
      const p = toCanvas(e.clientX, e.clientY);
      if (drag.kind === "card") {
        let x = Math.round((p.x - drag.dx) / GRID) * GRID;
        let y = Math.round((p.y - drag.dy) / GRID) * GRID;

        // A card must come loose before it can be caught again, or a stacked
        // one snaps straight back and the chain cannot be broken at all.
        const freed =
          drag.freed || Math.hypot(x - drag.ox, y - drag.oy) > CARD_H * 0.6;
        if (freed !== drag.freed) setDrag({ ...drag, freed: true });

        // The run follows the stack top to bottom, so a card let go onto
        // another must not end up lying on it: two cards at one spot run in an
        // order nobody can see.
        let next: { under?: string; before?: string } | null = null;
        if (freed) {
          for (const other of blocks) {
            if (other.id === drag.id) continue;
            if (Math.abs(other.x - x) > SNAP * 2) continue;
            // Dropped where a card already is: take its place and push it down.
            if (Math.abs(other.y - y) <= SNAP * 1.6) {
              x = other.x;
              y = other.y;
              next = { before: other.id };
              break;
            }
            // Dropped just under one: join the bottom of that stack.
            if (Math.abs(other.y + CARD_H - y) <= SNAP * 1.6) {
              x = other.x;
              y = other.y + CARD_H;
              next = { under: other.id };
              break;
            }
          }
        }
        setHint(next);
        onMove(drag.id, x, y);
      } else if (drag.kind === "multi") {
        // Carry the whole boxed group by the same offset.
        const dx = p.x - drag.px;
        const dy = p.y - drag.py;
        for (const [id, s] of drag.start) {
          onMove(id, Math.round((s.x + dx) / GRID) * GRID, Math.round((s.y + dy) / GRID) * GRID);
        }
      } else if (drag.kind === "marquee") {
        if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 4) boxed.current = true;
        setDrag({ ...drag, x: p.x, y: p.y });
      } else {
        setDrag({ ...drag, x: p.x, y: p.y });
      }
    };
    const up = (e: MouseEvent) => {
      if (drag.kind === "card" && hint) onDrop(drag.id, hint);
      else if (drag.kind === "card" || drag.kind === "multi") onMoveEnd();
      setHint(null);
      if (drag.kind === "marquee") {
        // Everything inside the box becomes the selection.
        const x0 = Math.min(drag.sx, drag.x);
        const x1 = Math.max(drag.sx, drag.x);
        const y0 = Math.min(drag.sy, drag.y);
        const y1 = Math.max(drag.sy, drag.y);
        const inside = blocks
          .filter((b) => b.x + CARD_W > x0 && b.x < x1 && b.y + CARD_H > y0 && b.y < y1)
          .map((b) => b.id);
        setSel(new Set(inside));
      }
      if (drag.kind === "wire") {
        const p = toCanvas(e.clientX, e.clientY);
        // Dropped on a card connects; dropped on empty space clears the link.
        const hit = blocks.find(
          (b) => p.x >= b.x && p.x <= b.x + CARD_W && p.y >= b.y && p.y <= b.y + CARD_H,
        );
        onConnect(drag.from, drag.port, hit && hit.id !== drag.from ? hit.id : null);
      }
      setDrag(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [drag, hint, blocks, onMove, onConnect, onDrop, onMoveEnd, toCanvas]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!host.current) return;
    const r = layoutRect(host.current);
    const p = pointerToLayout({ x: e.clientX, y: e.clientY });
    const mx = p.x - r.left;
    const my = p.y - r.top;
    setView((v) => {
      // Zoom about the cursor, so the thing under it stays under it.
      const k = clampK(v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
    });
  };

  /** The zoom buttons: about the canvas's middle, as the wheel zooms about the pointer. */
  const zoomBy = (f: number) => {
    if (!host.current) return;
    const r = layoutRect(host.current);
    const mx = r.width / 2;
    const my = r.height / 2;
    setView((v) => {
      const k = clampK(v.k * f);
      return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
    });
  };

  /** Every card in view with 24 px around them, centred, never above 100 %. The first fit of a project never goes below 80 % (`floor`): when even 80 % cannot hold every card, the view sits at 80 % with the start step at the top left, so the flow reads from its start. The Fit button zooms out as far as it takes. */
  const fit = (floor: boolean) => {
    if (!host.current || blocks.length === 0) { setView({ ...HOME }); return; }
    const r = layoutRect(host.current);
    const x0 = Math.min(...blocks.map((b) => b.x));
    const y0 = Math.min(...blocks.map((b) => b.y));
    const w = Math.max(...blocks.map((b) => b.x + CARD_W)) - x0;
    const h = Math.max(...blocks.map((b) => b.y + CARD_H)) - y0;
    const k = Math.min(1, (r.width - FIT_PAD * 2) / w, (r.height - FIT_PAD * 2) / h);
    if (!floor || k >= FIT_MIN_K) {
      const kk = clampK(k);
      setView({ k: kk, x: (r.width - w * kk) / 2 - x0 * kk, y: (r.height - h * kk) / 2 - y0 * kk });
      return;
    }
    const start = entry ? byId.get(entry) : undefined;
    const sx = start?.x ?? x0;
    const sy = start?.y ?? y0;
    setView({ k: FIT_MIN_K, x: FIT_PAD - sx * FIT_MIN_K, y: FIT_PAD - sy * FIT_MIN_K });
  };

  // The view fits once, the first time a project opens in a session. After
  // that nothing but the user moves it: the side panel or the browser column
  // opening, closing or resizing, and the window resizing, leave the zoom and
  // the top left of the view where they were (owner, 2026-10-01).
  const fitNow = useRef(fit);
  fitNow.current = fit;
  useLayoutEffect(() => {
    const kept = resetKey ? views.get(resetKey) : undefined;
    if (kept) { setView(kept); return; }
    fitNow.current(true);
  }, [resetKey]);
  useEffect(() => {
    // The untouched initial view is the HOME object itself: it is not yet a view anyone chose.
    if (resetKey && view !== HOME) views.set(resetKey, view);
  }, [resetKey, view]);

  // A press or right-click on the canvas's own bars is not one on the canvas
  // (a pan, a box, or "add a step here").
  const ownBar = {
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); },
  };

  /** The block each one hands over to when it works — implicit (the card below)
   *  or explicit (a goto). */
  const doneTarget = (b: Block): Block | undefined => {
    const kind = branchKind(b.on_done);
    if (kind === "goto") return byId.get((b.on_done as { goto: string }).goto);
    if (kind === "next") {
      const oi = orderIndex.get(b.id) ?? -1;
      return oi >= 0 ? ordered[oi + 1] : undefined;
    }
    return undefined;
  };

  /** Cards sitting flush under the one they follow are drawn as one stack, so
   *  an arrow that would curl out and straight back is simply not drawn. */
  const dockedTo = new Map<string, string>();
  blocks.forEach((b) => {
    const t = doneTarget(b);
    if (!t) return;
    if (Math.abs(t.x - b.x) <= SNAP && Math.abs(t.y - (b.y + CARD_H)) <= SNAP) {
      dockedTo.set(b.id, t.id);
    }
  });
  const dockedUnder = new Set(dockedTo.values());

  /** Every connection, as a line to draw. */
  const edges: { from: Block; to: Block; port: Port }[] = [];
  blocks.forEach((b) => {
    // The join itself shows the hand-over; a line as well is noise.
    if (!dockedTo.has(b.id)) {
      const t = doneTarget(b);
      if (t) edges.push({ from: b, to: t, port: "done" });
    }
    const failKind = branchKind(b.on_fail);
    if (failKind === "goto") {
      const t = byId.get((b.on_fail as { goto: string }).goto);
      if (t) edges.push({ from: b, to: t, port: "fail" });
    }
  });

  // A port with a wire is filled; a free one is a hollow ring.
  const wired = new Set(edges.map((e) => `${e.from.id}:${e.port}`));
  // An input dot with a wire into it takes the wire's color (done wins a tie).
  const inColor = new Map<string, Port>();
  edges.forEach((e) => {
    if (inColor.get(e.to.id) !== "done") inColor.set(e.to.id, e.port);
  });

  return (
    <div
      ref={host}
      data-block-canvas=""
      // Clip, not hidden: a hidden box still scrolls when something in it is
      // brought into view (a focused port), and the bars would slide away.
      className="relative h-full w-full overflow-clip"
      onWheel={onWheel}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget && !(e.target as Element).hasAttribute("data-bc-hit")) return;
        if (e.button === 2) {
          // Right-drag draws a selection box; a right-click (no drag) still
          // opens the add-a-step menu (handled in onContextMenu).
          boxed.current = false;
          const p = toCanvas(e.clientX, e.clientY);
          setSel(new Set());
          setDrag({ kind: "marquee", sx: p.x, sy: p.y, x: p.x, y: p.y });
          return;
        }
        if (e.button !== 0) return;
        onSelect(null);
        setSel(new Set());
        setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        // A right-drag that swept a box selected cards — don't also add a step.
        if (boxed.current) { boxed.current = false; return; }
        const p = toCanvas(e.clientX, e.clientY);
        onAddAt(Math.round(p.x / GRID) * GRID, Math.round(p.y / GRID) * GRID);
      }}
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--stroke-soft-200, #d1d5db) 1px, transparent 1px)",
        backgroundSize: `${GRID * view.k}px ${GRID * view.k}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        cursor: drag?.kind === "pan" ? "grabbing" : "default",
      }}
    >
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        <svg className="pointer-events-none absolute overflow-visible" style={{ width: 1, height: 1 }}>
          {edges.map((e, i) => {
            const d = edgePath(portPoint(e.from, e.port), inPoint(e.to));
            return (
              <g key={i}>
                <path
                  d={d}
                  fill="none"
                  strokeWidth={1.8}
                  className={e.port === "done" ? "stroke-success-base" : "stroke-error-base"}
                  opacity={0.75}
                />
                {/* A wider invisible stroke, so the pointer finds the edge. */}
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={12}
                  data-bc-hit=""
                  style={{ pointerEvents: "stroke" }}
                  onMouseEnter={() => setHot(i)}
                  onMouseLeave={() => setHot((h) => (h === i ? null : h))}
                />
              </g>
            );
          })}
          {drag?.kind === "wire" && byId.get(drag.from) && (
            <path
              d={edgePath(portPoint(byId.get(drag.from)!, drag.port), { x: drag.x, y: drag.y })}
              fill="none"
              strokeWidth={1.8}
              strokeDasharray="4 3"
              className={drag.port === "done" ? "stroke-success-base" : "stroke-error-base"}
            />
          )}
          {drag?.kind === "marquee" && (
            <rect
              x={Math.min(drag.sx, drag.x)}
              y={Math.min(drag.sy, drag.y)}
              width={Math.abs(drag.x - drag.sx)}
              height={Math.abs(drag.y - drag.sy)}
              className="fill-primary-alpha-10 stroke-primary-base"
              strokeWidth={1}
            />
          )}
        </svg>

        {hint && (() => {
          const t = byId.get(hint.before ?? hint.under ?? "");
          if (!t) return null;
          const y = hint.before ? t.y : t.y + CARD_H;
          return (
            <div
              className="pointer-events-none absolute h-[1px] rounded-full bg-primary-base"
              style={{ left: t.x, top: y - 0.5, width: CARD_W }}
            />
          );
        })()}

        {blocks.map((b) => (
          <div
            key={b.id}
            data-step-card={b.id}
            className={`pointer-events-auto absolute ${TILE_FILL} contrast-more:outline contrast-more:outline-1 contrast-more:-outline-offset-1 contrast-more:outline-stroke-sub-300 ${
              dockedUnder.has(b.id) ? "rounded-t-none" : "rounded-t-10"
            } ${dockedTo.has(b.id) ? "rounded-b-none" : "rounded-b-10"} ${
              active === b.id
                ? "z-(--layer-raised) ring-2 ring-success-base"
                : selected === b.id || sel.has(b.id)
                  ? "z-(--layer-raised) ring-2 ring-primary-base"
                  : ""
            } ${b.enabled ? "" : "opacity-50"}`}
            style={{ left: b.x, top: b.y, width: CARD_W, height: CARD_H }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              const p = toCanvas(e.clientX, e.clientY);
              // Grabbing a boxed card carries the whole group; grabbing any
              // other card is a single move and drops the box selection.
              if (sel.has(b.id) && sel.size > 1) {
                const start = new Map<string, { x: number; y: number }>();
                for (const id of sel) {
                  const bb = byId.get(id);
                  if (bb) start.set(id, { x: bb.x, y: bb.y });
                }
                setDrag({ kind: "multi", px: p.x, py: p.y, start });
                return;
              }
              setSel(new Set());
              onSelect(b.id);
              setDrag({
                kind: "card",
                id: b.id,
                dx: p.x - b.x,
                dy: p.y - b.y,
                ox: b.x,
                oy: b.y,
                freed: false,
              });
            }}
          >
            <div className="flex h-full flex-col justify-center gap-0.5 px-2.5">
              <div className="flex items-center gap-1.5">
                {entry === b.id && (
                  <span className="rounded-4 bg-bg-weak-50 px-1 text-[10px] text-text-sub-600">
                    {t("blockCanvas.startBadge")}
                  </span>
                )}
                <StepIcon
                  icon={blockIcon(b.kind)}
                  className={`size-3.5 shrink-0 ${selected === b.id || sel.has(b.id) ? "text-text-strong-950" : "text-text-soft-400"}`}
                />
                <span className="truncate text-secondary font-medium text-text-strong-950">{title(b)}</span>
              </div>
              <span className="truncate text-[10px] text-text-soft-400">
                {typeof b.params.selector === "string" && b.params.selector
                  ? b.params.selector
                  : b.params.x !== undefined
                    ? t("blockCanvas.byPosition", {
                        x: Math.round(Number(b.params.x)),
                        y: Math.round(Number(b.params.y)),
                      })
                    : b.kind}
              </span>
            </div>

            {/* Ports: drag from one onto another card to connect. */}
            {/* A hairline where two cards meet, so a stack still reads as steps. */}
            {dockedUnder.has(b.id) && (
              <div className="absolute left-2.5 right-2.5 top-0 h-px bg-stroke-soft-200" />
            )}

            {(["done", "fail"] as Port[]).filter((port) => !(port === "done" && dockedTo.has(b.id))).map((port) => (
              <Tooltip key={port} content={port === "done" ? t("blockCanvas.portDone") : t("blockCanvas.portFail")}>
              {/* eslint-disable-next-line no-restricted-syntax -- canvas handle: drag from it to draw a wire */}
              <button
                type="button"
                aria-label={port === "done" ? t("blockCanvas.portDone") : t("blockCanvas.portFail")}
                className={`absolute size-[10px] rounded-full border-2 ring-2 ring-bg-white-0 ${
                  port === "done" ? "border-success-base" : "border-error-base"
                } ${
                  wired.has(`${b.id}:${port}`)
                    ? port === "done" ? "bg-success-base" : "bg-error-base"
                    : "bg-bg-white-0"
                }`}
                style={{
                  left: CARD_W - 6,
                  top: (port === "done" ? PORT_DONE : PORT_FAIL) - 6,
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  const p = toCanvas(e.clientX, e.clientY);
                  setDrag({ kind: "wire", from: b.id, port, x: p.x, y: p.y });
                }}
              />
              </Tooltip>
            ))}
            {!dockedUnder.has(b.id) && (
              <div
                className={`absolute size-[10px] rounded-full ring-2 ring-bg-white-0 ${
                  inColor.get(b.id) === "done"
                    ? "bg-success-base"
                    : inColor.get(b.id) === "fail"
                      ? "bg-error-base"
                      : "bg-stroke-soft-200"
                }`}
                style={{ left: -IN_DOT, top: CARD_H / 2 - IN_DOT }}
              />
            )}

            {selected === b.id && (
              <div
                className="absolute bottom-full left-0 mb-[10px] flex gap-0.5 rounded-8 bg-bg-raised p-0.5 shadow-(--shadow-float)"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {entry !== b.id && (
                  <Button size="3xsmall" variant="neutral" mode="ghost" onClick={(e) => { e.stopPropagation(); onSetStart(b.id); }}>
                    {t("blockCanvas.startHere")}
                  </Button>
                )}
                <Button
                  size="3xsmall"
                  variant="neutral"
                  mode="ghost"
                  className="hover:bg-error-tint hover:text-error-text"
                  onClick={(e) => { e.stopPropagation(); onDelete(b.id); }}
                >
                  {t("blockCanvas.delete")}
                </Button>
              </div>
            )}
          </div>
        ))}

        {/* A cut handle at each edge's middle — clicking it drops the link.
            (The SVG lines themselves can't be clicked reliably.) */}
        {edges.map((e, i) => {
          const a = portPoint(e.from, e.port);
          const to = inPoint(e.to);
          const show =
            hot === i ||
            selected === e.from.id || selected === e.to.id ||
            sel.has(e.from.id) || sel.has(e.to.id);
          return (
            <Tooltip key={"cut" + i} content={t("blockCanvas.disconnect")}>
            {/* eslint-disable-next-line no-restricted-syntax -- wire cut handle sitting on a wire's midpoint */}
            <button
              type="button"
              aria-label={t("blockCanvas.disconnect")}
              className={`absolute z-(--layer-sticky) flex size-[14px] items-center justify-center rounded-full ${TILE_FILL} text-text-sub-600 transition-opacity hover:text-error-text hover:ring-1 hover:ring-error-base focus-visible:opacity-100 ${
                show ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
              }`}
              style={{ left: (a.x + to.x) / 2 - 7, top: (a.y + to.y) / 2 - 7 }}
              onMouseEnter={() => setHot(i)}
              onMouseLeave={() => setHot((h) => (h === i ? null : h))}
              onMouseDown={(ev) => ev.stopPropagation()}
              onClick={(ev) => { ev.stopPropagation(); onConnect(e.from.id, e.port, null); }}
            >
              <CloseIcon aria-hidden="true" className="size-3.5" />
            </button>
            </Tooltip>
          );
        })}
      </div>

      {/* Zoom out, the zoom (it resets the view), zoom in and Fit. */}
      <div
        className={`absolute bottom-2.5 left-2.5 flex items-center gap-0.5 rounded-control ${TILE_FILL} p-0.5 contrast-more:outline contrast-more:outline-1 contrast-more:-outline-offset-1 contrast-more:outline-stroke-sub-300`}
        {...ownBar}
      >
        <IconButton size="2xsmall" label={t("blockCanvas.zoomOut")} icon={<MinusIcon className="size-3.5" />} disabled={view.k <= MIN_K} onClick={() => zoomBy(1 / ZOOM_STEP)} />
        <Tooltip content={t("blockCanvas.resetView")}>
          <Button size="2xsmall" variant="neutral" mode="ghost" className="tabular-nums" onClick={() => setView({ ...HOME })}>
            {t("blockCanvas.zoomPercent", { n: Math.round(view.k * 100) })}
          </Button>
        </Tooltip>
        <IconButton size="2xsmall" label={t("blockCanvas.zoomIn")} icon={<AddIcon className="size-3.5" />} disabled={view.k >= MAX_K} onClick={() => zoomBy(ZOOM_STEP)} />
        <Button size="2xsmall" variant="neutral" mode="ghost" onClick={() => fit(false)}>{t("blockCanvas.fit")}</Button>
      </div>

      {/* The canvas's keys and gestures, behind a "?" instead of a paragraph. */}
      <div className="absolute bottom-2.5 right-2.5" {...ownBar}>
        <IconButton
          ref={tipsAnchor}
          size="2xsmall"
          mode="stroke"
          label={t("blockCanvas.tips")}
          icon={<HelpCircleIcon className="size-3.5" />}
          aria-haspopup="dialog"
          aria-expanded={tipsOpen}
          onClick={() => setTipsOpen((v) => !v)}
        />
        <Popover open={tipsOpen} onOpenChange={setTipsOpen} anchorRef={tipsAnchor} side="top" align="end" aria-label={t("blockCanvas.tips")} className="w-[248px] p-3">
          <ul className="m-0 flex list-disc flex-col gap-1 pl-4 text-secondary text-text-sub-600">
            <li>{t("blockCanvas.tipPan")}</li>
            <li>{t("blockCanvas.tipZoom")}</li>
            <li>{t("blockCanvas.tipAdd")}</li>
            <li>{t("blockCanvas.tipBox")}</li>
            <li>{t("blockCanvas.tipConnect")}</li>
            <li>{t("blockCanvas.tipDisconnect")}</li>
            <li>{t("blockCanvas.tipStack")}</li>
          </ul>
        </Popover>
      </div>
    </div>
  );
}
