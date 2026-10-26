import { cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { mergeRefs } from '@/lib/mergeRefs'
import { toAriaKeyShortcuts } from '@/lib/keys'
import { Portal } from '@/lib/overlay/Portal'
import { usePresence } from '@/lib/overlay/usePresence'
import { lastKeyNavigated, pointerStill, samePoint } from '@/lib/overlay/modality'
import { underOpenLayer } from '@/lib/overlay/useDismiss'
import { passPressThrough } from '@/lib/overlay/passThrough'
import { useFloatingPosition, type Side } from '@/lib/overlay/position'
import Kbd from '@/components/Kbd'

export type TooltipSide = Side

export type TooltipProps = {
  /** Read-only: text (and what styles it), never a link, button or field. A
   *  press on the bubble goes to what lies under it, so nothing in it can be
   *  pressed or selected; interactive content belongs in a Popover (Pair 36
   *  re-review, Minor 2). */
  content: React.ReactNode
  side?: Side
  /** Hover delay in ms. Keyboard focus opens at once. */
  delay?: number
  /** false: never opens early because another tooltip just closed, and does not
   *  make others open early. For list cells the pointer only passes over (EMIL-14). */
  warm?: boolean
  /** A key that does the same, shown after the text ("C", "⌘K") and declared on the trigger. */
  shortcut?: string
  disabled?: boolean
  /** Opens only while its child's text is cut off by an ellipsis (read when
   *  the pointer or the keyboard arrives): a list cell that shows its whole
   *  text says nothing more. */
  whenTruncated?: boolean
  /** Esc hides it and still reaches the layer under it (a dialog's close
   *  button: one Esc closes the dialog, and the tooltip with it). */
  passEscape?: boolean
  children: React.ReactElement
  className?: string
}

// A tooltip opened within this window of another one closing opens at once,
// with no fade, so scanning a row of icon buttons does not wait on each.
const WARM_MS = 300
// A pointer leaving the trigger has this long to reach the bubble (WCAG 1.4.13).
const GRACE_MS = 100
let lastClosedAt = 0
// The warm tooltip the pointer has left, still open through its grace: the
// next tooltip to open closes it at once (one tooltip at a time).
let leaving: (() => void) | null = null

/** Keyboard focus only: focus moved by a click shows no tooltip. */
function focusVisible(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false
  try {
    return el.matches(':focus-visible')
  } catch {
    return true
  }
}

export default function Tooltip({ content, side = 'top', delay = 400, warm = true, shortcut, disabled = false, whenTruncated = false, passEscape = false, children, className }: TooltipProps) {
  const id = useId()
  const wrapperRef = useRef<HTMLSpanElement>(null)
  // The wrapper is `display: contents` (no box of its own, so layout classes
  // on the child reach the layout); the child is what the tooltip points at.
  const anchorRef = useMemo(
    () => ({
      get current() {
        return (wrapperRef.current?.firstElementChild as HTMLElement | null) ?? null
      },
    }),
    [],
  )
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [open, setOpen] = useState(false)
  // Opened within WARM_MS of another closing: it appears with no fade (FEEL-18).
  const [instant, setInstant] = useState(false)
  // Nothing floats until the first open: a list mounts many tooltips that never open (PERF-09).
  const [armed, setArmed] = useState(false)
  // A pressed trigger stays quiet until the pointer leaves it, even when the
  // pointer only arrives after the press (a press passed through another
  // tooltip's bubble lands before the pointer "enters" what was under it).
  const pressed = useRef(false)
  // The pointer arrived here without moving (the layout moved under it, or
  // the trigger mounted there): it opens only once the pointer really moves
  // over the trigger, from this point (merge point 5: a list narrowing
  // under a still pointer opened a row button's tooltip).
  const stillAt = useRef<{ x: number; y: number } | null>(null)

  // This tooltip's close, the same function every render (for `leaving`).
  const hideNow = useRef<() => void>(() => {})
  const [closeMe] = useState(() => () => hideNow.current())

  const empty = content === null || content === undefined || content === ''
  const truncated = () => {
    const el = anchorRef.current
    if (!el) return false
    if (el.scrollWidth > el.clientWidth) return true
    // Both are whole px: text cut by under one px shows its ellipsis with no
    // overflow there. The text's own laid-out width tells (past a layout
    // unit, 1/64 px, of rounding).
    const range = document.createRange()
    range.selectNodeContents(el)
    return typeof range.getBoundingClientRect === 'function' && range.getBoundingClientRect().width > el.getBoundingClientRect().width + 1 / 64
  }
  // Never while a menu, picker, popover, dialog or the palette is open,
  // unless the trigger is inside it: the first Esc belongs to that layer.
  const shut = () => disabled || empty || underOpenLayer(anchorRef.current)
  const show = (immediate: boolean) => {
    if (shut() || (whenTruncated && !truncated())) return
    clearTimeout(hideTimer.current)
    clearTimeout(showTimer.current)
    if (leaving === closeMe) leaving = null
    const isWarm = warm && !immediate && Date.now() - lastClosedAt < WARM_MS
    const go = () => {
      // A layer that opened during the delay keeps it shut.
      if (shut()) return
      if (leaving) { const other = leaving; leaving = null; other() }
      setInstant(isWarm); setArmed(true); setOpen(true)
    }
    if (immediate || isWarm) go()
    else showTimer.current = setTimeout(go, delay)
  }
  const hide = () => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
    if (leaving === closeMe) leaving = null
    setOpen((was) => {
      if (was && warm) lastClosedAt = Date.now()
      return false
    })
  }
  hideNow.current = hide
  const hideSoon = () => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
    // For the warm hand-off it counts as closed when the pointer leaves, not
    // when its grace ends: the neighbour the pointer moves to opens at once
    // (FEEL-18; Pair 36 review, Important 2).
    if (open && warm) { lastClosedAt = Date.now(); leaving = closeMe }
    hideTimer.current = setTimeout(hide, GRACE_MS)
  }
  useEffect(() => () => { clearTimeout(showTimer.current); clearTimeout(hideTimer.current) }, [])

  // Esc hides the tooltip and stops there: the menu, Peek or dialog under it
  // stays (A11Y-12: Esc dismisses whatever opened last). With `passEscape`
  // the Esc goes on to that layer too.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      if (!passEscape) {
        e.preventDefault()
        e.stopPropagation()
      }
      hide()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `hide` only reads refs and setters
  }, [open, passEscape])

  let trigger: React.ReactNode = children
  if (isValidElement(children)) {
    const props = children.props as Record<string, unknown>
    const own = props['aria-describedby']
    // Content that repeats the trigger's name is not a description (A11Y-09).
    const repeatsName = typeof content === 'string' && content === props['aria-label']
    const describedBy = [typeof own === 'string' ? own : null, open && !repeatsName ? id : null].filter(Boolean).join(' ') || undefined
    // A sequence ("G P", two presses) has no aria-keyshortcuts form: read
    // as a list, it would declare G and P as two keys. It shows, unannounced.
    const sequence = !!shortcut && /\s/.test(shortcut.trim())
    const keys = shortcut && !sequence && props['aria-keyshortcuts'] === undefined ? toAriaKeyShortcuts(shortcut) : undefined
    trigger = cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      'aria-describedby': describedBy,
      ...(keys ? { 'aria-keyshortcuts': keys } : {}),
    })
  }

  return (
    <span
      ref={wrapperRef}
      className="contents"
      onPointerEnter={(e) => {
        if (e.pointerType === 'touch' || pressed.current) return
        if (pointerStill(e)) stillAt.current = { x: e.clientX, y: e.clientY }
        else show(false)
      }}
      onPointerMove={(e) => {
        const at = stillAt.current
        if (!at || e.pointerType === 'touch' || pressed.current || samePoint(at, e)) return
        stillAt.current = null
        show(false)
      }}
      onPointerLeave={() => { pressed.current = false; stillAt.current = null; hideSoon() }}
      onPointerDown={() => { pressed.current = true; hide() }}
      // Focus that Tab or an arrow moved shows it; focus moved by code (a
      // dialog opening, a menu closing) does not.
      onFocus={(e) => { if (focusVisible(e.target) && lastKeyNavigated()) show(true) }}
      onBlur={hide}
    >
      {trigger}
      {armed && (
        <TooltipBubble
          id={id}
          open={open}
          instant={instant}
          anchorRef={anchorRef}
          side={side}
          className={className}
          onPointerEnter={() => clearTimeout(hideTimer.current)}
          onPointerLeave={(e) => {
            const to = e.relatedTarget
            if (to instanceof Node && anchorRef.current?.contains(to)) return
            hideSoon()
          }}
          onPress={hide}
        >
          {shortcut ? (
            // The key sits after the text. Its cap is 18 px: a pixel above and
            // below the 16 px line (-my-px), so the bubble keeps its height.
            <span className="flex items-center gap-[7px]">
              <span className="min-w-0">{content}</span>
              <Kbd tone="onTooltip" aria-hidden="true" className="-my-px">{shortcut}</Kbd>
            </span>
          ) : content}
        </TooltipBubble>
      )}
    </span>
  )
}

function TooltipBubble({ id, open, instant, anchorRef, side, className, children, onPointerEnter, onPointerLeave, onPress }: {
  id: string
  open: boolean
  instant: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  side: Side
  className?: string
  children: React.ReactNode
  onPointerEnter: () => void
  onPointerLeave: (e: React.PointerEvent) => void
  /** A press landed on the bubble: it closes at once. */
  onPress: () => void
}) {
  const floatingRef = useRef<HTMLDivElement>(null)
  const presence = usePresence(open, { group: 'tooltip', enter: instant ? 'instant' : 'animate' })
  const pos = useFloatingPosition(anchorRef, floatingRef, { open: presence.mounted, side, align: 'center', offset: 6 })
  const pressed = useRef(onPress)
  pressed.current = onPress

  // A press on the bubble is never its own: the bubble closes and the press
  // goes to what lies under it, so a hoverable tooltip over the next row never
  // eats a click there, and its own row never sees that press (Pair 36
  // review, Important 3). Window capture: before the document's outside-press
  // listeners and React.
  useEffect(() => {
    if (!open) return
    floatingRef.current?.style.removeProperty('pointer-events')
    const onDown = (e: PointerEvent) => {
      const bubble = floatingRef.current
      if (!bubble || !(e.target instanceof Node) || !bubble.contains(e.target)) return
      passPressThrough(e, bubble)
      pressed.current()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open])

  if (!presence.mounted) return null
  return (
    <Portal>
      <div
        {...presence.rootProps}
        ref={mergeRefs(floatingRef, presence.rootProps.ref)}
        id={id}
        role="tooltip"
        // A leaving bubble describes nothing any more (its trigger dropped
        // aria-describedby): it is hidden from assistive tech while it fades.
        aria-hidden={presence.state === 'closed' || undefined}
        // It can be hovered (WCAG 1.4.13): the pointer may cross onto it to
        // read it. A leaving bubble takes no pointer.
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        // Whatever still reaches the bubble (a double click, a context menu)
        // stops here: the portal is inside its trigger's row in React's tree.
        onDoubleClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden' }}
        className={cn(
          'fixed z-(--layer-overlay) w-max max-w-xs rounded-control bg-bg-tooltip px-[7px] py-[3px] text-secondary font-medium text-text-tooltip shadow-(--shadow-tooltip) forced-edge',
          'transition-opacity duration-(--motion-fast) ease-out data-starting-style:opacity-0',
          'data-ending-style:opacity-0 data-ending-style:duration-(--motion-exit-fast) data-ending-style:pointer-events-none',
          className,
        )}
      >
        {children}
      </div>
    </Portal>
  )
}
