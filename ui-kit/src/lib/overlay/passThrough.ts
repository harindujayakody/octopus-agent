/** What a press focuses: the element itself or its nearest focusable ancestor. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex], [contenteditable="true"]'

const mouseInit = (e: MouseEvent): MouseEventInit => ({
  bubbles: true,
  cancelable: true,
  composed: true,
  view: window,
  detail: e.detail,
  screenX: e.screenX,
  screenY: e.screenY,
  clientX: e.clientX,
  clientY: e.clientY,
  button: e.button,
  buttons: e.buttons,
  ctrlKey: e.ctrlKey,
  shiftKey: e.shiftKey,
  altKey: e.altKey,
  metaKey: e.metaKey,
})

function commonAncestor(a: Element, b: Element | null): Element {
  if (!b) return a
  let at: Element | null = a
  while (at && !at.contains(b)) at = at.parentElement
  return at ?? a
}

let stopPending: (() => void) | null = null

/** macOS, where Ctrl+click is a context menu and Cmd+click is not a plain click. */
const mac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

/**
 * A press on a layer that is only there to be read (a hoverable tooltip
 * bubble) belongs to what lies under it: a hoverable layer must never eat a
 * click, nor hand the press to the component that rendered it (Pair 36
 * review, Important 3). Call it from a `window` capture `pointerdown`
 * listener, whose event landed on `layer`: nothing else sees that press on
 * the layer, the layer takes no more pointer, and the press (pointerdown,
 * mousedown and the focus it gives), its context menu and its click reach
 * the element under the pointer instead. The release (pointerup, mouseup)
 * already lands there by itself. The click goes only to a press let go on
 * the control it was pressed on, as a primary click.
 */
export function passPressThrough(e: PointerEvent, layer: HTMLElement): void {
  e.stopImmediatePropagation()
  layer.style.pointerEvents = 'none'
  const under = document.elementFromPoint(e.clientX, e.clientY)
  stopPending?.()
  if (!under) return

  const pointer = typeof PointerEvent === 'function'
    ? new PointerEvent('pointerdown', { ...mouseInit(e), pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary })
    : new MouseEvent('pointerdown', mouseInit(e))
  under.dispatchEvent(pointer)

  let upTarget: Element | null = null
  let cleanup: ReturnType<typeof setTimeout> | undefined
  // This press opened a context menu (a macOS Ctrl+click does, at the press):
  // it clicks nothing.
  let menu = false
  // The control pressed: the element under the pointer, or its nearest
  // focusable ancestor (a button around an icon).
  const control = under.closest(FOCUSABLE) ?? under
  // A press clicks only when it is let go on the control it was pressed on,
  // with the primary button and no Ctrl or Cmd on macOS. A drag off the
  // control clicks nothing, so a long drag never clicks the row or list the
  // two ends share (Pair 36 fix2 re-review, Minors 1 and 3).
  const clicks = (m: MouseEvent) =>
    m.button === 0 && !menu && !(mac() && (m.ctrlKey || m.metaKey)) && upTarget !== null && control.contains(upTarget)
  // The browser still sends this press's mousedown and click to the layer
  // (or to an ancestor shared with where the pointer was let go): stop each
  // and send its copy to the element under the pointer.
  const onMouseDown = (m: MouseEvent) => {
    if (!m.isTrusted) return
    m.stopImmediatePropagation()
    // No focus change or text selection on the layer itself.
    m.preventDefault()
    window.removeEventListener('mousedown', onMouseDown, true)
    if (!under.dispatchEvent(new MouseEvent('mousedown', mouseInit(m)))) return
    const target = under.closest<HTMLElement>(FOCUSABLE)
    if (target) target.focus({ preventScroll: true })
    else (document.activeElement as HTMLElement | null)?.blur?.()
  }
  const onMouseUp = (m: MouseEvent) => {
    if (!m.isTrusted) return
    upTarget = m.target instanceof Element ? m.target : null
    // The click (and a Windows context menu) follow in this same task. A
    // press held past the layer's exit gets no click from the browser (none
    // is sent once the node pressed on is gone; WebKit may send none when the
    // press and release nodes differ), so a primary release sends its own
    // here. A click that does come stops this first (onClick calls stop), so
    // one press never clicks twice (Pair 36 re-review, Important 3a).
    cleanup = setTimeout(() => {
      stop()
      if (clicks(m)) commonAncestor(under, upTarget).dispatchEvent(new MouseEvent('click', mouseInit(m)))
    }, 0)
  }
  const onClick = (m: MouseEvent) => {
    if (!m.isTrusted) return
    m.stopImmediatePropagation()
    m.preventDefault()
    stop()
    if (clicks(m)) commonAncestor(under, upTarget).dispatchEvent(new MouseEvent('click', mouseInit(m)))
  }
  const onContextMenu = (m: MouseEvent) => {
    if (!m.isTrusted) return
    m.stopImmediatePropagation()
    menu = true
    window.removeEventListener('contextmenu', onContextMenu, true)
    if (!under.dispatchEvent(new MouseEvent('contextmenu', mouseInit(m)))) m.preventDefault()
  }
  const stop = () => {
    clearTimeout(cleanup)
    window.removeEventListener('mousedown', onMouseDown, true)
    window.removeEventListener('mouseup', onMouseUp, true)
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('contextmenu', onContextMenu, true)
    window.removeEventListener('pointercancel', stop, true)
    window.removeEventListener('pointerdown', stop, true)
    if (stopPending === stop) stopPending = null
  }
  window.addEventListener('mousedown', onMouseDown, true)
  window.addEventListener('mouseup', onMouseUp, true)
  window.addEventListener('click', onClick, true)
  window.addEventListener('contextmenu', onContextMenu, true)
  window.addEventListener('pointercancel', stop, true)
  // A new press (this one's release never came) ends this one.
  window.addEventListener('pointerdown', stop, true)
  stopPending = stop
}
