import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Menu, { type MenuItem } from '.'
import type { Point } from '@/lib/overlay/position'
import { layoutRect, layoutToPointer } from '@/lib/overlay/zoom'

export type ContextMenuOptions = { heading?: string; headingTruncate?: 'end' | 'middle'; 'aria-label'?: string }

type Opened = {
  anchor: Point | React.RefObject<HTMLElement | null>
  align: 'start' | 'end'
  /** What the menu is for: the button it hangs from, or the element that was
   *  right-clicked. It carries `data-menu-open` while the menu is open, so a
   *  row can keep its own controls in view with CSS, never a render. */
  subject: HTMLElement | null
  /** Opened from a button: the button says so with aria-expanded while the menu is open. */
  expands: boolean
  items: MenuItem[]
  options?: ContextMenuOptions
  /** Every opening is a new menu: a second right-click never drags the first along (ANIM-06). */
  session: number
}
type HostHandle = { show: (o: Omit<Opened, 'session'>) => void; hide: () => void }

// Owns the menu's state, so opening a menu re-renders only this, never the
// list that owns the hook (PERF-11).
const ContextMenuHost = forwardRef<HostHandle>(function ContextMenuHost(_, ref) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<Opened | null>(null)
  useImperativeHandle(ref, () => ({
    show: (o) => {
      setAt((prev) => ({ ...o, session: (prev?.session ?? 0) + 1 }))
      setOpen(true)
    },
    hide: () => setOpen(false),
  }), [])
  // Before paint, so the row's controls and the button's open look arrive
  // with the menu's first frame. A DOM attribute, not a prop: React never
  // re-renders the row or the button for it.
  useLayoutEffect(() => {
    const el = at?.subject
    if (!el) return
    if (open) el.setAttribute('data-menu-open', '')
    else el.removeAttribute('data-menu-open')
    if (at.expands) el.setAttribute('aria-expanded', String(open))
    return () => {
      el.removeAttribute('data-menu-open')
      if (at.expands) el.setAttribute('aria-expanded', 'false')
    }
  }, [at, open])
  if (!at) return null
  return (
    <Menu
      key={at.session}
      open={open}
      onOpenChange={setOpen}
      anchor={at.anchor}
      align={at.align}
      items={at.items}
      heading={at.options?.heading}
      headingTruncate={at.options?.headingTruncate}
      aria-label={at.options?.['aria-label']}
    />
  )
})

export type ContextMenuApi = {
  /** A right-click: at the pointer. With no pointer (Shift+F10, the Menu key), under the element (PC-006). */
  openAtPointer: (e: React.MouseEvent | MouseEvent, items: MenuItem[], options?: ContextMenuOptions) => void
  /** A button (mouse, Enter or Space): under it, right edges aligned; it gets aria-expanded (EMIL-02). */
  openFrom: (el: HTMLElement, items: MenuItem[], options?: ContextMenuOptions) => void
  /** Either, by the event: a `click` opens from its button, anything else at the pointer. */
  open: (e: React.MouseEvent | MouseEvent, items: MenuItem[], options?: ContextMenuOptions) => void
  close: () => void
  /** Render once. */
  node: React.ReactNode
}

/**
 * A menu for rows and buttons:
 *   const menu = useContextMenu()
 *   <tr onContextMenu={(e) => menu.openAtPointer(e, items)} />
 *   <button aria-haspopup="menu" aria-expanded="false" onClick={(e) => menu.openFrom(e.currentTarget, items)} />
 *   {menu.node}
 * The object and its methods are the same every render, and opening a menu
 * renders only `node`. What the menu is for (the row, the button) carries
 * `data-menu-open` while it is open: style "keep my controls in view" with
 * it (`group-data-[menu-open]:`, `group-has-[[data-menu-open]]:`).
 */
export function useContextMenu(): ContextMenuApi {
  const host = useRef<HostHandle>(null)
  return useMemo<ContextMenuApi>(() => {
    const openFrom: ContextMenuApi['openFrom'] = (el, items, options) =>
      host.current?.show({ anchor: { current: el }, align: 'end', subject: el, expands: true, items, options })
    const openAtPointer: ContextMenuApi['openAtPointer'] = (e, items, options) => {
      e.preventDefault()
      const el = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
      // The keyboard's context menu reports no pointer: open under the
      // element, as a pointer position (a point anchor takes one), not at the
      // window's corner.
      const anchor = el && e.clientX === 0 && e.clientY === 0
        ? (() => { const r = layoutRect(el); return layoutToPointer({ x: r.left, y: r.bottom }) })()
        : { x: e.clientX, y: e.clientY }
      host.current?.show({ anchor, align: 'start', subject: el, expands: false, items, options })
    }
    const open: ContextMenuApi['open'] = (e, items, options) => {
      if (e.type === 'click' && e.currentTarget instanceof HTMLElement) {
        e.preventDefault()
        openFrom(e.currentTarget, items, options)
      } else {
        openAtPointer(e, items, options)
      }
    }
    return { openAtPointer, openFrom, open, close: () => host.current?.hide(), node: <ContextMenuHost ref={host} /> }
  }, [])
}
