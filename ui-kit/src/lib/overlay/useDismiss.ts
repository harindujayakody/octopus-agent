import { useCallback, useEffect, useRef } from 'react'

type Options = {
  enabled: boolean
  onDismiss: () => void
  /** Presses inside any of these do not dismiss (the overlay and its trigger). */
  refs: React.RefObject<HTMLElement | null>[]
  escape?: boolean
  outsidePress?: boolean
  /** The overlay's own surface (never its trigger): a tooltip inside it may
   *  open while it is the topmost layer; any other tooltip stays shut. */
  layer?: React.RefObject<HTMLElement | null>
}

// Open overlays in the order they opened. Only the last one reacts, so Escape
// in a list inside a dialog closes the list, not the dialog.
const stack: number[] = []
let nextId = 1
// Each open overlay's own surface, by its place in the stack.
const surfaces = new Map<number, () => HTMLElement | null | undefined>()

/** A tooltip on `el` stays shut: an overlay (a menu, picker, popover, dialog
 *  or the palette) is open, and `el` is not inside the topmost one's own
 *  surface. A dialog's own buttons still show theirs. */
export function underOpenLayer(el: Element | null): boolean {
  const top = stack[stack.length - 1]
  if (top === undefined) return false
  const surface = surfaces.get(top)?.()
  return !(el && surface && surface.contains(el))
}

/** Presses inside an element with this attribute never close an open
 *  overlay: a layer beside the overlays, not under them (the toast stack; a
 *  toast's X or Undo must not close the popover the person is working in). */
export const OVERLAY_BRANCH = 'data-overlay-branch'

/** Inside a branch, a press on an element with this attribute counts as a
 *  press outside after all: a toast's action moves the person on (it may
 *  open a dialog), and whatever it opens replaces the open menu or popover,
 *  as a menu item's does. */
export const OVERLAY_OUTSIDE = 'data-overlay-outside'

/**
 * Closes an overlay on Escape and on a press outside `refs`, but only while
 * it is the topmost open overlay. Presses inside `[data-overlay-branch]`
 * count as neither inside nor outside, unless they land on an element marked
 * `[data-overlay-outside]` there. Returns a function telling whether it
 * is topmost right now (dialogs use it to ignore backdrop presses that belong
 * to a list or menu above them).
 */
export function useDismiss({ enabled, onDismiss, refs, escape = true, outsidePress = true, layer }: Options): () => boolean {
  const callback = useRef(onDismiss)
  callback.current = onDismiss
  const watched = useRef(refs)
  watched.current = refs
  const surface = useRef(layer)
  surface.current = layer
  const idRef = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const id = nextId++
    idRef.current = id
    stack.push(id)
    surfaces.set(id, () => surface.current?.current)
    const isTop = () => stack[stack.length - 1] === id

    const onKey = (e: KeyboardEvent) => {
      // Escape while an input method is composing cancels the composition.
      if (!escape || e.key !== 'Escape' || e.isComposing || e.keyCode === 229 || !isTop()) return
      e.preventDefault()
      callback.current()
    }
    const onPointer = (e: PointerEvent) => {
      if (!outsidePress || !isTop()) return
      const target = e.target as Node | null
      if (target && watched.current.some((r) => r.current?.contains(target))) return
      if (target instanceof Element && target.closest(`[${OVERLAY_BRANCH}]`) && !target.closest(`[${OVERLAY_OUTSIDE}]`)) return
      callback.current()
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer, true)
      const at = stack.indexOf(id)
      if (at >= 0) stack.splice(at, 1)
      surfaces.delete(id)
      if (idRef.current === id) idRef.current = 0
    }
  }, [enabled, escape, outsidePress])

  return useCallback(() => idRef.current !== 0 && stack[stack.length - 1] === idRef.current, [])
}
