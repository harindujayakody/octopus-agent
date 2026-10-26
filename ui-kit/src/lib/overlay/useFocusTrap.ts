import { useEffect } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[inert]') && el.getAttribute('aria-hidden') !== 'true',
  )
}

type Options = {
  initialFocusRef?: React.RefObject<HTMLElement | null>
  restoreFocus?: boolean
  /** Keep Tab inside (dialogs, popovers). Menus leave it off: Tab closes them. */
  trapTab?: boolean
  /** What had focus before, when the caller saw it first: a field with
   *  `autoFocus` inside, or a page made inert, can take focus off the
   *  trigger before this effect runs. */
  restoreTo?: HTMLElement | null
}

/**
 * While active: moves focus into `ref` (the `initialFocusRef`, else the first
 * `[data-autofocus]`, else the first focusable not marked
 * `data-autofocus-skip`), optionally keeps Tab inside, and on deactivation
 * returns focus to what had it before, unless the user has already put focus
 * somewhere else.
 */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  { initialFocusRef, restoreFocus = true, trapTab = true, restoreTo }: Options = {},
): void {
  useEffect(() => {
    if (!active) return
    const root = ref.current
    if (!root) return
    const previous = restoreTo ?? (document.activeElement as HTMLElement | null)

    const items = focusables(root)
    const first =
      initialFocusRef?.current ??
      root.querySelector<HTMLElement>('[data-autofocus]') ??
      items.find((el) => !el.hasAttribute('data-autofocus-skip')) ??
      items[0] ??
      root
    first.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      if (!trapTab || e.key !== 'Tab') return
      const list = focusables(root)
      if (list.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = list[0]
      const lastEl = list[list.length - 1]
      const at = list.indexOf(document.activeElement as HTMLElement)
      // Focus on the panel itself (after a click on plain text) counts as
      // "before the first control".
      if (at === -1) {
        e.preventDefault()
        ;(e.shiftKey ? lastEl : firstEl).focus()
      } else if (e.shiftKey && at === 0) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && at === list.length - 1) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    root.addEventListener('keydown', onKey)

    return () => {
      root.removeEventListener('keydown', onKey)
      if (!restoreFocus || !previous || !document.contains(previous)) return
      const now = document.activeElement
      if (now === null || now === document.body || root.contains(now)) previous.focus({ preventScroll: true })
    }
    // Re-run only when the trap turns on or off; the options are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
