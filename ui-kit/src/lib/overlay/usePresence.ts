import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { presenceLeaving, presenceOpened, type PresenceGroup } from './presenceGroups'
import { lastInput, type InputKind } from './modality'

export type PresenceState = 'open' | 'closed'
type Phase = 'starting' | 'open' | 'ending' | 'gone'

export type PresenceOptions = {
  /** Surfaces of a group hand off: when one opens, a member still leaving goes at once. */
  group?: PresenceGroup
  /** Read when it opens. 'instant': no enter (a warm tooltip). */
  enter?: 'animate' | 'instant'
  /** Read when it closes. 'instant': no exit (a menu item ran, the palette ran a command). */
  exit?: 'animate' | 'instant'
  /** Safety cap in ms for an exit whose transitions never report their end. */
  maxExitMs?: number
}

export type PresenceAttrs = {
  'data-state': PresenceState
  'data-input': InputKind
  'data-starting-style'?: ''
  'data-ending-style'?: ''
}

export type Presence<T> = {
  mounted: boolean
  /** 'open' from the first frame (aria, triggers), 'closed' while leaving. */
  state: PresenceState
  /** The last shown value, kept through the exit (a dialog's subject, a Peek's draft). */
  value: T | undefined
  /** For the element whose subtree animates: the attributes, the ref the exit waits on, and `inert` while leaving. */
  rootProps: PresenceAttrs & { ref: (el: HTMLElement | null) => void; inert?: boolean }
  /** The same attributes for children that animate with the root (a backdrop, a panel). */
  attrs: PresenceAttrs
}

const shown = (v: unknown) => v !== null && v !== undefined && v !== false

/**
 * Mounts a surface, runs its enter from the first painted frame, keeps it
 * (inert, with its last value) through its exit, and unmounts it when its own
 * transitions end. CSS styles the open look at rest and the hidden look on
 * `data-starting-style` and `data-ending-style` (animations.md S6).
 */
export function usePresence<T = true>(
  value: T | null | undefined | false,
  options: PresenceOptions | number = {}, // number: the old `exitMs`, now only a cap
): Presence<T> {
  const o: PresenceOptions = typeof options === 'number' ? { maxExitMs: options } : options
  const { group, enter = 'animate', exit = 'animate', maxExitMs = 400 } = o
  const open = shown(value)

  const [phase, setPhase] = useState<Phase>(open ? (enter === 'instant' ? 'open' : 'starting') : 'gone')
  const [input, setInput] = useState<InputKind>(lastInput)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    // State adjusted during render (React's "prop changed" pattern): the exit
    // starts in the same commit as the close, not one passive effect later.
    setPrevOpen(open)
    if (open) {
      // Opened again on its way out, it turns around from where it is: never
      // back by way of its starting look, which the frame before the open
      // look lands would already move it toward (craft item 6).
      setPhase(enter === 'instant' || phase === 'ending' ? 'open' : 'starting')
      setInput(lastInput())
    } else {
      setPhase(phase === 'gone' || exit === 'instant' ? 'gone' : 'ending')
    }
  }

  const latched = useRef<T | undefined>(undefined)
  if (open) latched.current = value as T
  const node = useRef<HTMLElement | null>(null)
  const ref = useCallback((el: HTMLElement | null) => { node.current = el }, [])
  // This surface in its handoff group (it never hands off to itself).
  const [member] = useState<object>(() => ({}))

  // Opening hands off: whatever of the group is still leaving goes now.
  useLayoutEffect(() => { if (open && group) presenceOpened(group, member) }, [open, group, member])

  // Enter: the starting style is in the DOM. Force one style and layout pass so
  // the browser records it, then drop it before paint: the transition runs from
  // the first painted frame (replaces the double requestAnimationFrame).
  useLayoutEffect(() => {
    if (phase !== 'starting') return
    node.current?.getBoundingClientRect()
    setPhase('open')
  }, [phase])

  // Exit: unmount when the transitions it started are done. None running
  // (durations at 0, or no exit style) means now.
  useLayoutEffect(() => {
    if (phase !== 'ending') return
    let done = false
    const finish = () => {
      if (done) return
      done = true
      latched.current = undefined
      setPhase('gone')
    }
    const running = node.current
      ?.getAnimations?.({ subtree: true })
      .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity) // skip spinners inside
    if (running && running.length === 0) { finish(); return }
    if (running) Promise.all(running.map((a) => a.finished)).then(finish, () => {}) // cancelled = reopened
    const cap = setTimeout(finish, maxExitMs)
    const unregister = group ? presenceLeaving(group, member, finish) : undefined
    return () => { done = true; clearTimeout(cap); unregister?.() }
  }, [phase, group, maxExitMs, member])

  const attrs: PresenceAttrs = {
    'data-state': open ? 'open' : 'closed',
    'data-input': input,
    ...(phase === 'starting' ? { 'data-starting-style': '' as const } : {}),
    ...(phase === 'ending' ? { 'data-ending-style': '' as const } : {}),
  }
  return {
    mounted: phase !== 'gone',
    state: attrs['data-state'],
    value: open ? (value as T) : latched.current,
    attrs,
    rootProps: { ...attrs, ref, inert: phase === 'ending' || undefined },
  }
}

/** Kept for the toast glide and other callers; one cached MediaQueryList (PERF-09). */
const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : undefined
export function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.dataset.reduceMotion === 'true' || mq?.matches === true
}
