import { useEffect, useLayoutEffect, useState } from 'react'
import { usePresence } from './usePresence'
import { useDismiss } from './useDismiss'
import { useFocusTrap } from './useFocusTrap'

// Counted, so closing one of two open dialogs keeps the page locked.
let locks = 0
let savedOverflow = ''

function lockScroll(): () => void {
  if (locks++ === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--locks === 0) document.body.style.overflow = savedOverflow
  }
}

// Counted like the scroll lock. Dialogs render in a portal outside #root, so
// the page behind them is inert while they (and their menus, lists and the
// app's toasts and live regions, all portaled) stay live: Tab and a screen
// reader's virtual cursor cannot wander behind (A11Y-07). A side panel that
// is not modal (Peek) does not use this.
let inertCount = 0

function inertPage(): () => void {
  const root = typeof document === 'undefined' ? null : document.getElementById('root')
  if (!root) return () => {}
  if (inertCount++ === 0) root.setAttribute('inert', '')
  let released = false
  return () => {
    if (released) return
    released = true
    if (--inertCount === 0) root.removeAttribute('inert')
  }
}

const activeElement = () => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null))

/** What every dialog shares: presence (enter, inert exit, handoff), Escape
 *  (topmost only), focus trap and restore, scroll lock, the page behind inert. */
export function useModal({
  open,
  onClose,
  panelRef,
  initialFocusRef,
  exit,
}: {
  open: boolean
  onClose: () => void
  panelRef: React.RefObject<HTMLElement | null>
  initialFocusRef?: React.RefObject<HTMLElement | null>
  /** 'instant' when the dialog closes because it ran something (the palette). */
  exit?: 'animate' | 'instant'
}) {
  const presence = usePresence(open, { group: 'overlay', exit })
  const isTopmost = useDismiss({ enabled: open, onDismiss: onClose, refs: [panelRef], outsidePress: false, layer: panelRef })
  // What had focus as the dialog opened, read while it renders: before a
  // field inside it takes focus (`autoFocus` commits first) and before the
  // inert page drops the trigger's focus. Focus goes back there on close.
  const [openedFrom, setOpenedFrom] = useState<HTMLElement | null>(() => (open ? activeElement() : null))
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOpenedFrom(activeElement())
  }
  // A layout effect, before the focus trap's: the page goes inert in the
  // commit that opens the dialog and is live again in the one that closes
  // it, before focus goes back to the trigger inside #root.
  useLayoutEffect(() => (open ? inertPage() : undefined), [open])
  useFocusTrap(panelRef, open && presence.mounted, { initialFocusRef, restoreFocus: true, trapTab: true, restoreTo: openedFrom })
  useEffect(() => (open ? lockScroll() : undefined), [open])
  return { ...presence, isTopmost }
}
