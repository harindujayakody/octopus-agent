import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import {
  Portal,
  cn,
  lastInput,
  layoutRect,
  layoutViewport,
  originFor,
  pageZoom,
  pointerToLayout,
  useFloatingPosition,
  useFocusTrap,
  usePresence,
  type Position,
  type Presence,
  type Side,
} from "@proxyshard/shardx-ui-kit";
import { useT } from "../../../shared/i18n";
import { titleBarOnMouseDown } from "../../../shared/lib/dragWindow";
import { landOnPage, refocusIfLost } from "../../../shared/lib/focus";
import { useNav } from "../../../shared/model/navigation";
import { announce } from "../../../shared/model/announce";
import { useReducedMotion } from "../../../shared/hooks/useReducedMotion";
import { useOnboarding } from "../../onboarding/model/onboarding";
import { lookupTarget } from "../lib/findTarget";
import { formPageOf, pageOf } from "../lib/pageName";
import { useTour } from "../model/useTour";
import type { TourRun } from "../model/types";
import { TourCard, type TourArrow } from "./TourCard";

/** Space between the element and the cut-out's edge (spec 5.2). */
const PAD = 8;
/** From the element to the card: the cut-out's space, 4 px of air and the 8 px arrow. */
const OFFSET = PAD + 4 + 8;
/** The card's width before it is first measured; its height is measured. */
const CARD = { w: 320, h: 160 };

/** The top of the window that still drags it while the scrim is up: macOS's
 *  title strip (shellPadClass), which the header's and sidebar's own drag
 *  areas also cover on every system. */
const TITLE_STRIP = 38;

/** The cut-out, in layout px (Interface size counts): the element's box grown by PAD, its radius plus PAD. */
type Hole = { x: number; y: number; w: number; h: number; r: number };
type View = { width: number; height: number };

function measure(el: HTMLElement): Hole {
  const r = layoutRect(el);
  // Concentric: the element's own corner radius plus the space around it.
  const raw = getComputedStyle(el).borderTopLeftRadius;
  const first = Number.parseFloat(raw) || 0;
  const radius = raw.trim().endsWith("%") ? (first / 100) * Math.min(r.width, r.height) : first;
  const w = r.width + PAD * 2;
  const h = r.height + PAD * 2;
  return { x: r.left - PAD, y: r.top - PAD, w, h, r: Math.min(radius + PAD, w / 2, h / 2) };
}

const sameHole = (a: Hole | null, b: Hole | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.r === b.r);

/**
 * Where the step's element is and how big the window is, in layout px,
 * kept up to date: a window resize, a scroll anywhere, the element or the
 * page changing size, Interface size (CSS zoom on <html>, which sends no
 * resize), and a slow look for anything else that moves it (a row added
 * above it). An element that left the page keeps its last place until the
 * next step lands, unless the page drew it again (React replaced the node):
 * then the step's element (`key`) is looked up again.
 */
function useGeometry(el: HTMLElement | null, key: string | null | undefined): { hole: Hole | null; view: View } {
  const [geo, setGeo] = useState<{ hole: Hole | null; view: View }>(() => ({ hole: null, view: layoutViewport(pageZoom()) }));
  useLayoutEffect(() => {
    const update = () => {
      if (el && !el.isConnected && key && useTour.getState().pending === null) {
        const fresh = lookupTarget(key);
        // The new element comes through the store; the effect runs again for it.
        if (fresh) { useTour.setState({ target: fresh }); return; }
      }
      const view = layoutViewport(pageZoom());
      const next = !el ? null : el.isConnected ? measure(el) : undefined;
      setGeo((prev) => {
        const hole = next === undefined ? prev.hole : next;
        return sameHole(prev.hole, hole) && prev.view.width === view.width && prev.view.height === view.height ? prev : { hole, view };
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(document.documentElement);
    if (el) ro?.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    const timer = setInterval(update, 250);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      ro?.disconnect();
      mo.disconnect();
      clearInterval(timer);
    };
  }, [el, key]);
  return geo;
}

const n = (v: number) => Math.round(v * 100) / 100;
/** Covers far past any window: the scrim's own box clips it. */
const OUTER = "M-99999 -99999H99999V99999H-99999Z";

/** The scrim's clip: everything but the rounded cut-out. With no element the
 *  cut-out is a point in the middle, so it closes toward the centred card.
 *  The path always has the same commands, so it can glide between steps. */
function clipFor(hole: Hole | null, view: View): string {
  const { x, y, w, h, r } = hole ?? { x: view.width / 2, y: view.height / 2, w: 0, h: 0, r: 0 };
  const a = `A${n(r)} ${n(r)} 0 0 1`;
  const inner = `M${n(x + r)} ${n(y)}H${n(x + w - r)}${a} ${n(x + w)} ${n(y + r)}V${n(y + h - r)}${a} ${n(x + w - r)} ${n(y + h)}H${n(x + r)}${a} ${n(x)} ${n(y + h - r)}V${n(y + r)}${a} ${n(x + r)} ${n(y)}Z`;
  return `path(evenodd, "${OUTER} ${inner}")`;
}

/** The side of the element with the most room left once the card is there (spec 5.2). */
function sideFor(hole: Hole, view: View, size: { w: number; h: number }): Side {
  const spare: Record<Side, number> = {
    bottom: view.height - (hole.y + hole.h) - size.h,
    top: hole.y - size.h,
    right: view.width - (hole.x + hole.w) - size.w,
    left: hole.x - size.w,
  };
  return (Object.keys(spare) as Side[]).reduce((best, s) => (spare[s] > spare[best] ? s : best), "bottom");
}

/** The arrow toward the element's middle, along the card's edge next to it;
 *  none when the card had to cover the element (no side had room). */
function arrowFor(pos: Position, hole: Hole, size: { w: number; h: number }): TourArrow | null {
  // How far the card and the cut-out overlap on each axis (negative: apart).
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);
  const covers = Math.min(overlap(pos.x, pos.x + size.w, hole.x, hole.x + hole.w), overlap(pos.y, pos.y + size.h, hole.y, hole.y + hole.h)) > 0;
  if (covers) return null;
  const across = pos.side === "top" || pos.side === "bottom";
  const along = across ? hole.x + hole.w / 2 - pos.x : hole.y + hole.h / 2 - pos.y;
  const length = across ? size.w : size.h;
  return { side: pos.side, at: Math.max(16, Math.min(along, length - 16)) };
}

/** What a key can land on in the form's controls, as the kit's focus trap counts them. */
const STOPS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** The controls the keyboard can stop on in `root` (or `root` itself when it is one), in the order Tab takes them. */
function stopsIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const all = [...(root.matches(STOPS) ? [root] : []), ...root.querySelectorAll<HTMLElement>(STOPS)];
  return all.filter((el) => !el.closest("[inert]") && el.getAttribute("aria-hidden") !== "true" && el.getClientRects().length > 0);
}

/** The kinds of `<input>` a person types a line into: Enter in one of them would submit the form. */
const TEXT_INPUTS = new Set(["", "text", "search", "number", "email", "url", "tel", "password"]);

/** The tour's card, or a layer the form opened beside it (a list, a menu, the
 *  discard question): the keys inside such a layer are its own. */
function inOtherLayer(el: Element | null, card: HTMLElement | null): boolean {
  const layer = el?.closest('[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]');
  // The form's own dialog holds the form; the layers of its pickers do not.
  return !!layer && layer !== card && !layer.querySelector("[data-profile-form]");
}

/** Where the keyboard goes when a walk through the form ends and it was in the card: the form, not the page behind it. */
const formStart = () => document.querySelector<HTMLElement>('[data-profile-form] [role="tab"][aria-selected="true"]');

/** Takes every press the shield gets: the page behind cannot be used, and a
 *  press on the title strip still drags the window. */
const shieldProps = {
  onMouseDown: (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pointerToLayout({ x: e.clientX, y: e.clientY }).y < TITLE_STRIP) titleBarOnMouseDown(e);
  },
  onClick: (e: ReactMouseEvent) => e.stopPropagation(),
  onContextMenu: (e: ReactMouseEvent) => { e.preventDefault(); e.stopPropagation(); },
};

/** The shield around a box the press may reach (the part a walk through the
 *  form points at): four strips, so the box itself is open to the page under it. */
function strips(open: { x: number; y: number; w: number; h: number }): CSSProperties[] {
  // Rounded outward by a pixel at most: no seam between strips.
  const x0 = Math.floor(open.x);
  const y0 = Math.floor(open.y);
  const x1 = Math.ceil(open.x + open.w);
  const y1 = Math.ceil(open.y + open.h);
  return [
    { left: 0, top: 0, right: 0, height: y0 },
    { left: 0, top: y1, right: 0, bottom: 0 },
    { left: 0, top: y0, width: x0, height: y1 - y0 },
    { left: x1, top: y0, right: 0, height: y1 - y0 },
  ];
}

/**
 * The guided tour on screen: a scrim over the whole window with a cut-out
 * around the step's element, and the step's card beside it (centred, with
 * its picture, when the element is not there). When a step is on another
 * page, the cut-out first lands on that page's item in the sidebar and the
 * card says which page it is (the beat), then both move on to the step. One portal. The scrim takes
 * every press, so the page under it cannot be used while the tour runs;
 * only the card's controls take input.
 */
export function TourLayer() {
  const run = useTour((s) => s.run);
  const runId = useTour((s) => s.runId);
  const presence = usePresence(run, { maxExitMs: 300 });
  if (!presence.mounted || !presence.value) return null;
  return (
    <Portal>
      <TourOverlay key={runId} runId={runId} run={presence.value} presence={presence} />
    </Portal>
  );
}

function TourOverlay({ runId, run, presence }: { runId: number; run: TourRun; presence: Presence<TourRun> }) {
  const t = useT();
  const reduced = useReducedMotion();
  const target = useTour((s) => s.target);
  const pending = useTour((s) => s.pending);
  const beat = useTour((s) => s.beat);
  const open = presence.state === "open";
  const step = run.steps[run.index];
  const total = run.steps.length;
  // A walk through the profile form: in the form, not on a page (see below).
  const form = run.kind === "form";

  // The store keeps the last element so the scrim can leave from where it was.
  // Once the layer is gone it only holds a detached node and, through it, the
  // page that was left; a newer run (another runId) has its own target.
  useEffect(() => () => {
    const now = useTour.getState();
    if (now.runId === runId && now.run === null) useTour.setState({ target: null });
  }, [runId]);

  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const { hole, view } = useGeometry(target, beat ? beat.key : step.target);
  // The page the card is about: the one the beat shows, else the step's; the
  // walk through the form names the form.
  const page = form ? formPageOf() : pageOf(beat ? beat.section : step.section);
  const centred = !target;

  // The card's size, as last drawn: the side with the most room depends on it.
  const [size, setSize] = useState(CARD);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const next = { w: el.offsetWidth, h: el.offsetHeight };
    if (next.w !== size.w || next.h !== size.h) setSize(next);
  });

  // The card beside the element. The anchor is a new object whenever the
  // cut-out moves, so the card follows it (Interface size sends no resize).
  const holeKey = hole ? `${hole.x} ${hole.y} ${hole.w} ${hole.h}` : "";
  const anchor = useMemo(() => ({ current: target }), [target, holeKey]);
  const side = hole ? sideFor(hole, view, size) : "bottom";
  const pos = useFloatingPosition(anchor, cardRef, { open: !centred, side, align: "center", offset: OFFSET });
  const placed = centred || pos !== null;
  const arrow = !centred && pos && hole ? arrowFor(pos, hole, size) : null;

  // Each step's card comes in from its entering look once it has its place:
  // the step's key changes, the look goes on with no transition, and comes
  // off once the browser has drawn it, so the card fades (and scales) in.
  // Between steps (a page change, an element looked for) it stays hidden; the
  // beat that shows a page change has a card of its own.
  const shownKey = pending === "page" ? null : beat ? `beat:${beat.section}` : pending ? null : String(run.index);
  const [landed, setLanded] = useState<string | null>(null);
  const entering = shownKey === null || landed !== shownKey;
  useLayoutEffect(() => {
    if (shownKey === null || landed === shownKey || !placed) return;
    cardRef.current?.getBoundingClientRect();
    setLanded(shownKey);
    // The beat has no buttons: the card itself has the keyboard (below), and
    // the page change is announced there. The step that follows takes it to Next.
    if (shownKey.startsWith("beat:")) return;
    // Focus moves into the card on every step and stays there (spec 5.3).
    const active = document.activeElement;
    const inside = !!cardRef.current?.contains(active) && !(landed?.startsWith("beat:") && active === cardRef.current);
    if (!inside) nextRef.current?.focus({ preventScroll: true });
    // The first step's card says itself as focus moves in; later ones are announced.
    if (landed !== null) announce(t("tour.stepAnnounce", { n: run.index + 1, total, title: t(step.title) }));
  }, [shownKey, landed, placed, run.index, total, step.title, t]);

  // The form's dialog traps Tab as well; two traps would fight over the keyboard
  // (neither could let go of it to the other). In a walk through the form the
  // card does not trap, and Tab between the card and the part it points at is
  // the key handler's below.
  useFocusTrap(cardRef, open, { initialFocusRef: nextRef, restoreFocus: true, trapTab: !form });

  // A page change: the card's buttons give way to the beat's two lines, and the
  // button that had the keyboard goes with them. The card takes it (a beat that
  // opens the run already has it from the trap above), and the page change is
  // announced ("Extensions page") to a screen reader.
  const beatSection = beat?.section;
  useEffect(() => {
    if (!beatSection) return;
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) card.focus({ preventScroll: true });
    announce(t("tour.pageAnnounce", { page: pageOf(beatSection).name }));
  }, [beatSection, t]);

  // The keyboard goes back to the page when the run ends (A11Y-04). The trap
  // above returns it to what had it before the run, but every way in takes
  // that away (the welcome, the palette, What's new and the (i) popover
  // close; Settings remounts on the way back). So as the exit starts (after
  // the trap's own return, declared first) a keyboard still in the fading
  // card counts as lost and lands where the page begins; once more as the
  // layer leaves, for a dialog that handed it back into the card meanwhile
  // (the guard's Cancel). `landOnPage` leaves a keyboard that is somewhere
  // real alone: the next run's card, the end card.
  useEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    return () => {
      const now = document.activeElement;
      if (card && now instanceof HTMLElement && card.contains(now)) now.blur();
      // A walk through the form ends with the form still open (and the page
      // behind it shut): the keyboard stays in the form.
      if (form) refocusIfLost(formStart);
      else landOnPage(useNav.getState().section, false);
    };
  }, [open, form]);
  useEffect(() => () => { if (form) refocusIfLost(formStart); else landOnPage(useNav.getState().section, false); }, [form]);

  // Right arrow or Enter: Next. Left arrow: Back. Esc: the end (spec 5.3).
  // Enter on one of the card's buttons is that button's press, but not its
  // repeats (a held key would click Next on every step that lands). Tab with
  // the keyboard outside the card (a window control was pressed) comes back
  // to it, so the page behind never takes a key. While the page changes the
  // guard may be asking: its dialog has the keys then.
  //
  // A walk through the form shares the keyboard with the form. The arrows
  // and Enter are the tour's only in the card (or with nothing focused): in a
  // field they are the field's (a caret). Enter in a line of the form goes to
  // the next step and does not submit it, until the last step, where Enter is
  // the form's own (it creates the profile). Esc ends the walk
  // from the card or a field, but belongs to a list, a menu or a question the
  // form opened (it closes that and nothing else). Tab goes round the card and
  // the part the step points at: past the card's last button to the part's
  // first control, past the part's last to the card's first, and the same
  // backwards; the dialog's trap never sees those, and the rest of the form
  // (behind the shield) is not on the way.
  useEffect(() => {
    if (!open) return;
    // Tab in a walk through the form: the next stop in the ring of the card's
    // controls and the part's, or null when the browser's own Tab is right
    // (inside the card, inside the part, a control that has a list open, or
    // somewhere else altogether).
    const formTab = (e: KeyboardEvent, inCard: boolean): (() => void) | null => {
      const here = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // The keyboard has nowhere to be (a press on the form's text): back to the card, as in every run.
      if (!here || here === document.body) return () => nextRef.current?.focus({ preventScroll: true });
      if (here.getAttribute("aria-expanded") === "true") return null;
      const cardStops = stopsIn(cardRef.current);
      const partStops = stopsIn(useTour.getState().target);
      if (!inCard && !partStops.includes(here)) return null;
      const mine = inCard ? cardStops : partStops;
      const other = inCard ? partStops : cardStops;
      const at = mine.indexOf(here);
      // On the card itself (a press on its text): before its first control.
      const edge = at < 0 ? inCard : e.shiftKey ? at === 0 : at === mine.length - 1;
      if (!edge) return null;
      const across = other.length > 0 ? other : mine;
      const to = at < 0 ? (e.shiftKey ? across[across.length - 1] : cardStops[0]) : e.shiftKey ? across[across.length - 1] : across[0];
      return to ? () => to.focus({ preventScroll: true }) : null;
    };
    const onKey = (e: KeyboardEvent) => {
      const tour = useTour.getState();
      if (!tour.run || tour.pending === "page" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target instanceof Element ? e.target : null;
      const inCard = !!el && !!cardRef.current?.contains(el);
      const onButton = inCard && e.target instanceof HTMLButtonElement;
      let act: (() => void) | null = null;
      if (form) {
        const idle = !el || el === document.body || el === document.documentElement;
        if (e.key === "Escape") {
          // A list the control has open (a Select keeps the keyboard on its field) or a layer of the form's: Esc closes that.
          if (!el?.closest('[aria-expanded="true"]') && !inOtherLayer(el, cardRef.current)) act = () => tour.end("esc");
        } else if (e.key === "Tab") {
          act = formTab(e, inCard);
        } else if (e.key === "Enter" && el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type) && !inOtherLayer(el, cardRef.current) && !e.isComposing && e.keyCode !== 229) {
          // Enter in a line of the form would submit it, and make the profile
          // before the walk got to Create profile: it goes to the next step
          // instead (the repeats of a held key are swallowed). On the last
          // step the walk is at Create profile, and Enter is the form's own.
          if (tour.run.index < tour.run.steps.length - 1) act = () => void tour.next();
        } else if (inCard || idle) {
          if (e.key === "ArrowRight" || (e.key === "Enter" && !onButton)) act = () => void tour.next();
          else if (e.key === "ArrowLeft") act = () => void tour.back();
          else if (e.key === "Enter" && e.repeat) act = () => {};
        }
      } else if (e.key === "Escape") act = () => tour.end("esc");
      else if (e.key === "ArrowRight" || (e.key === "Enter" && !onButton)) act = () => void tour.next();
      else if (e.key === "ArrowLeft") act = () => void tour.back();
      else if (e.key === "Enter" && e.repeat) act = () => {};
      else if (e.key === "Tab" && !inCard) act = () => nextRef.current?.focus({ preventScroll: true });
      if (!act) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!e.repeat) act();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, form]);

  // The box a walk through the form leaves open: the part's own, inside the cut-out's space round it.
  const pass = form && hole && !centred ? { x: hole.x + PAD, y: hole.y + PAD, w: hole.w - PAD * 2, h: hole.h - PAD * 2 } : null;

  const tour = useTour.getState();
  const cardStyle: CSSProperties = centred
    ? { transformOrigin: "center" }
    : {
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        visibility: pos ? "visible" : "hidden",
        // Grows from its side next to the element (FEEL-15).
        transformOrigin: originFor(pos?.side, "center"),
      };

  return (
    <div
      {...presence.rootProps}
      data-tour-layer
      data-pending={pending ?? undefined}
      className={cn(
        "fixed inset-0 transition-opacity ease-(--ease-out) data-starting-style:opacity-0 data-ending-style:opacity-0",
        reduced ? "duration-150" : "duration-200 data-ending-style:duration-150",
        // While the page changes, the unsaved-changes guard may ask: its
        // dialog goes over the tour. One step under the overlay layer, not in
        // it: the guard's portal can sit earlier in the page than the tour's,
        // and equal layers stack by that order.
        // A walk through the form is in the overlay layer, after the form's
        // dialog (it starts once the form is open): equal layers stack by
        // that order, so the form's lists, menus and questions, which open
        // later, are above the tour and take their own presses. Its layer
        // takes none itself: only the shield and the card do.
        pending === "page" ? "z-[calc(var(--layer-overlay)-1)]" : form ? "pointer-events-none z-(--layer-overlay)" : "z-(--layer-tour)",
      )}
    >
      {/* Takes every press on the page, the element in the cut-out too. A
          press here leaves the keyboard in the card. The title strip still
          drags the window (and a double press zooms it). In a walk through the
          form the shield leaves the part the step points at open (its own box,
          not the space round it): the person may use it. */}
      {pass ? (
        strips(pass).map((style, i) => <div key={i} data-tour-blocker className="pointer-events-auto absolute" style={style} {...shieldProps} />)
      ) : (
        <div data-tour-blocker className="pointer-events-auto absolute inset-0" {...shieldProps} />
      )}
      <div
        data-tour-scrim
        data-cutout={hole && !centred ? `${Math.round(hole.x)} ${Math.round(hole.y)} ${Math.round(hole.w)} ${Math.round(hole.h)} ${Math.round(hole.r)}` : "none"}
        aria-hidden="true"
        style={{ clipPath: clipFor(centred ? null : hole, view) }}
        className={cn(
          "pointer-events-none absolute inset-0 bg-(--tour-scrim)",
          // The cut-out glides to the next element (spec 5.4); with Reduce motion it jumps.
          !reduced && "transition-[clip-path] duration-250 ease-[cubic-bezier(0.77,0,0.175,1)]",
        )}
      />
      <div className={cn("pointer-events-none absolute inset-0", centred && "flex items-center justify-center")}>
        <TourCard
          step={step}
          kind={run.kind}
          index={run.index}
          total={total}
          page={page}
          beat={beat?.section ?? null}
          arrow={arrow}
          showPicture={centred}
          cardRef={cardRef}
          nextRef={nextRef}
          style={cardStyle}
          entering={entering}
          input={lastInput()}
          className={cn(
            centred ? "relative" : "absolute",
            "data-entering:opacity-0 data-entering:transition-none",
            // Enters with opacity and scale 0.96 to 1 (none from the
            // keyboard, as every popover); with Reduce motion only the fade.
            reduced
              ? "transition-opacity duration-150 ease-(--ease-out)"
              : "transition-[opacity,scale] duration-200 ease-(--ease-out) data-entering:scale-[0.96] data-[input=keyboard]:data-entering:scale-100",
          )}
          onBack={() => void tour.back()}
          onNext={() => void tour.next()}
          onSkip={() => tour.end("skip")}
          // Every tip off for good (Settings > About turns them back on); this one ends too.
          onTipsOff={() => { useOnboarding.getState().setTipsOff(true); tour.end("skip"); }}
        />
      </div>
    </div>
  );
}
