import { Fragment, useId, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { CheckIcon } from '@/lib/icons'
import { matchesAriaKeyShortcuts, toAriaKeyShortcuts } from '@/lib/keys'
import { mergeRefs } from '@/lib/mergeRefs'
import { swallowFollowUpClick } from '@/lib/overlay/clickGuard'
import { Portal } from '@/lib/overlay/Portal'
import { usePresence } from '@/lib/overlay/usePresence'
import { useDismiss } from '@/lib/overlay/useDismiss'
import { useFocusTrap } from '@/lib/overlay/useFocusTrap'
import { originFor, useFloatingPosition, type Align, type Point, type Side } from '@/lib/overlay/position'
import Kbd from '@/components/Kbd'

type Pickable = {
  label: string
  onSelect: () => void
  /** Stays in reach of the arrows (`aria-disabled`, APG) and runs nothing;
   *  give it a `hint` that says why (EMIL-05). */
  disabled?: boolean
  /** Drawn in place of `label` (a Folder chip, say); its text still names the item. */
  content?: React.ReactNode
  /** Why the item is disabled, or what it does: shown muted and read as the
   *  item's description, never as part of its name. A plain item shows it on
   *  a second line; a checkbox or radio item after its label ("Always shown"). */
  hint?: string
}

type ActionItem = Pickable & {
  type?: 'item'
  icon?: React.ReactNode
  danger?: boolean
  /** The key that does the same, as the app prints it ("S", "⌘C"): a key cap
   *  at the row's end, and the item's `aria-keyshortcuts`. Pressed while the
   *  menu is open, it runs this item. */
  shortcut?: string
  /** `aria-keyshortcuts` when it cannot be read from `shortcut` (two keys: "Delete Backspace"). */
  ariaKeyShortcuts?: string
}

type ChoiceItem =
  /** A setting turned on and off (a list column): picking it keeps the menu
   *  open for the next one. */
  | (Pickable & { type: 'checkbox'; checked: boolean })
  /** One choice of a set (the list's order, a profile's Folder): picking it
   *  closes the menu. */
  | (Pickable & { type: 'radio'; checked: boolean })

type PickItem = ActionItem | ChoiceItem

export type MenuItem =
  | PickItem
  | { type: 'separator' }
  /** Names the items after it, up to the next separator or label: a named group. */
  | { type: 'label'; label: string }

export type MenuProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A trigger element, or a point (context menus). */
  anchor: React.RefObject<HTMLElement | null> | Point
  items: MenuItem[]
  side?: Side
  align?: Align
  /** A line above the items saying what the menu acts on; it also names the
   *  menu when no `aria-label` is given. */
  heading?: string
  /** Where a heading wider than the menu is cut: `end` (the default) or
   *  `middle`, which keeps the last characters visible (an address, a path),
   *  where the part that tells one apart from the next is. */
  headingTruncate?: 'end' | 'middle'
  'aria-label'?: string
}

/** Keys the menu itself answers; an item's declared key is never one of them. */
const MENU_KEYS = new Set(['Enter', ' ', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])

/** Every item the arrows and type-ahead move through, disabled ones included (APG). */
const ITEMS = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]'

type Entry = { item: PickItem; i: number }
type Section = { key: string; label?: { text: string; id: string }; entries: Entry[] }

/** The last characters of a cut heading that stay visible. */
const TAIL = 14

/** Text cut in the middle: the start gives way (an ellipsis) and the last
 *  `TAIL` characters stay. One text, split in two spans, so reading it joins
 *  it whole. The start keeps its spaces (`whitespace-pre`, not `truncate`'s
 *  nowrap, which drops one at the end of a line): a space at the split is
 *  still there between the two. */
function MiddleCut({ text }: { text: string }) {
  const chars = Array.from(text)
  if (chars.length <= TAIL * 2) return <span className="truncate">{text}</span>
  return (
    <>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">{chars.slice(0, -TAIL).join('')}</span>
      <span className="shrink-0 whitespace-pre">{chars.slice(-TAIL).join('')}</span>
    </>
  )
}

/** Action menu with full keyboard support: arrows, Home/End, first letter,
 *  Enter, Esc, Tab. The pointer and the keys move one highlight (EMIL-06). */
export default function Menu({ open, onOpenChange, anchor, items, side = 'bottom', align = 'start', heading, headingTruncate = 'end', ...aria }: MenuProps) {
  const floatingRef = useRef<HTMLDivElement>(null)
  const uid = useId()
  const anchorRef = 'current' in anchor ? anchor : null
  // A chosen item closes the menu at once: whatever it opens replaces it, and
  // its fade would only sit over the next surface (EMIL-01, ANIM-02). Esc,
  // Tab and a press outside keep the short fade. Reset when it opens again.
  const [exit, setExit] = useState<'animate' | 'instant'>('animate')
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setExit('animate')
  }
  const presence = usePresence(open, { group: 'overlay', exit })
  // Opened from the keys (Enter, Space, Shift+F10, the Menu key, an arrow),
  // the first item has the keyboard and shows it. Opened by the pointer, the
  // menu itself takes focus and nothing is highlighted until the pointer moves
  // onto an item or an arrow is pressed: a fill under an item the pointer
  // never touched reads as a choice already made (Pair 30 ruling).
  const fromKeys = presence.attrs['data-input'] === 'keyboard'
  const pos = useFloatingPosition(anchor, floatingRef, { open: presence.mounted, side, align, offset: anchorRef ? 6 : 2 })
  const close = () => onOpenChange(false)
  useDismiss({ enabled: open, onDismiss: close, refs: anchorRef ? [floatingRef, anchorRef] : [floatingRef], layer: floatingRef })
  // Focus moves in only once the menu is positioned: a hidden element cannot take focus.
  useFocusTrap(floatingRef, open && presence.mounted && pos !== null, {
    restoreFocus: true,
    trapTab: false,
    initialFocusRef: fromKeys ? undefined : floatingRef,
  })

  const allItems = () => [...(floatingRef.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? [])]

  // A key an item shows runs that item, on what this menu is for (Linear,
  // Raycast): its key cap promises it (Pair 30 review, Important 2). A
  // disabled item's key takes the highlight to it, so its reason is read. A
  // held key runs nothing more. Returns whether the key was an item's.
  // The menu's own keys are never an item's: Enter and Space run the
  // highlighted item, Esc closes (Pair 36 review, Important 1), and the
  // arrows, Home and End move; Tab leaves (handled before this). With a
  // modifier held they are free for an item ("Mod+Enter", "Shift+ArrowDown";
  // Pair 36 re-review, Minor 1).
  const keyed = (e: React.KeyboardEvent, list: HTMLButtonElement[]): boolean => {
    if (MENU_KEYS.has(e.key) && !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)) return false
    const el = list.find((b) => {
      const keys = b.getAttribute('aria-keyshortcuts')
      return !!keys && matchesAriaKeyShortcuts(e.nativeEvent, keys)
    })
    if (!el) return false
    e.preventDefault()
    // The list under the menu must not act on the same key.
    e.stopPropagation()
    if (e.repeat) return true
    if (el.getAttribute('aria-disabled') === 'true') el.focus()
    else el.click()
    return true
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Tab leaves the menu: it closes, and focus goes back to its button, not
    // to whatever follows the portal (A11Y-06).
    if (e.key === 'Tab') { e.preventDefault(); close(); return }
    const list = allItems()
    if (list.length === 0) return
    const at = list.indexOf(document.activeElement as HTMLButtonElement)
    const focus = (i: number) => list[(i + list.length) % list.length].focus()
    if (keyed(e, list)) return
    if (e.key === 'ArrowDown') { e.preventDefault(); focus(at < 0 ? 0 : at + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focus(at < 0 ? list.length - 1 : at - 1) }
    else if (e.key === 'Home') { e.preventDefault(); focus(0) }
    else if (e.key === 'End') { e.preventDefault(); focus(list.length - 1) }
    else if (e.key.length === 1 && /\S/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // By the item's own label: a hint or a key cap is not what it is called.
      const key = e.key.toLowerCase()
      const order = [...list.slice(at + 1), ...list.slice(0, at + 1)]
      order.find((el) => el.dataset.label?.toLowerCase().startsWith(key))?.focus()
    }
  }

  // Separators split the list; a label starts a named group.
  const sections: (Section | 'separator')[] = []
  let current: Section | null = null
  items.forEach((item, i) => {
    if (item.type === 'separator') { current = null; sections.push('separator'); return }
    if (item.type === 'label') {
      current = { key: `label-${i}`, label: { text: item.label, id: `${uid}-group-${i}` }, entries: [] }
      sections.push(current)
      return
    }
    if (!current) { current = { key: `items-${i}`, entries: [] }; sections.push(current) }
    current.entries.push({ item, i })
  })
  const firstEnabled = items.findIndex((it) => it.type !== 'separator' && it.type !== 'label' && !it.disabled)

  const renderItem = ({ item, i }: Entry) => {
    const choice = item.type === 'checkbox' || item.type === 'radio' ? item : null
    const plain = item.type === undefined || item.type === 'item' ? item : null
    const hintId = item.hint ? `${uid}-hint-${i}` : undefined
    // A plain item's hint is a reason or an explanation, often a sentence
    // ("Mixed selection: …"): a second line that wraps, so it never widens
    // the menu. A choice item's is a short note after its label.
    const secondLine = plain !== null && !!item.hint
    const label = <span className={item.content ? 'flex min-w-0 items-center' : undefined}>{item.content ?? item.label}</span>
    return (
      <button
        key={`${item.label}-${i}`}
        type="button"
        role={item.type === 'checkbox' ? 'menuitemcheckbox' : item.type === 'radio' ? 'menuitemradio' : 'menuitem'}
        data-label={item.label}
        data-autofocus={fromKeys && i === firstEnabled ? '' : undefined}
        aria-checked={choice ? choice.checked : undefined}
        aria-disabled={item.disabled || undefined}
        aria-describedby={hintId}
        aria-keyshortcuts={plain?.shortcut ? (plain.ariaKeyShortcuts ?? toAriaKeyShortcuts(plain.shortcut)) : undefined}
        // One highlight: the item under the pointer takes focus, so Enter runs
        // what the pointer shows (EMIL-06).
        onPointerMove={(e) => { if (document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true }) }}
        onClick={(e) => {
          // A closing menu takes no clicks: one double click must not run an
          // item twice. A disabled item runs nothing and keeps the menu open.
          if (!open || item.disabled) return
          // A setting stays in reach: the menu keeps open for the next one.
          if (item.type === 'checkbox') {
            item.onSelect()
            return
          }
          // The second click of that double click is not a new choice either.
          if (e.detail > 0) swallowFollowUpClick(e)
          setExit('instant')
          close()
          item.onSelect()
        }}
        onKeyDown={(e) => {
          // A held Enter or Space toggles a checkbox item once, not
          // once per repeat (T16's rule: a held key acts once; a radio
          // or plain item is safe already, since it closes the menu on
          // its first press). Native button activation repeats with
          // the key, so this has to stop the repeat before it becomes
          // a click.
          if (item.type === 'checkbox' && e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault()
        }}
        className={cn(
          'group flex w-full items-center gap-[7px] rounded-control px-[8px] py-[5px] text-left text-ui focus:outline-hidden',
          // Forced colors paint outline-hidden as a 2 px ring 2 px out, over
          // the panel's edge and past its inner radius (5u): keep it inside
          // the item. It is the one highlight there too, pointer or keys.
          // `enabled:` outranks outline-hidden's own offset whatever order
          // Tailwind emits them in.
          'forced-colors:enabled:focus:-outline-offset-2',
          // The one highlight is focus, wherever it came from: the pointer
          // moves it (above), so no hover fill of its own (EMIL-06). A
          // disabled item keeps the neutral fill: it can be reached, not run.
          item.disabled
            ? 'text-text-disabled-300 focus:bg-bg-hover'
            : plain?.danger
              ? 'text-error-text focus:bg-error-tint-menu'
              : 'text-text-strong-950 focus:bg-bg-hover enabled:active:bg-bg-active',
        )}
      >
        {/* A plain item keeps its leading icon; a choice item (radio or
            checkbox) starts its label at the row's normal left padding: its
            check mark sits at the end (owner feedback, 2026-09-28: too much
            empty space on the left). The icon takes its item's state from
            currentColor when the item is danger or disabled (UI-35). */}
        {plain?.icon && (
          <span
            className={cn(
              'flex size-3.5 [&>svg]:size-3.5 shrink-0 items-center justify-center',
              item.disabled || plain.danger ? 'text-current' : 'text-icon-sub-600',
            )}
          >
            {plain.icon}
          </span>
        )}
        {secondLine ? (
          <span className="flex min-w-0 flex-1 flex-col">
            {label}
            {/* 240 px wide at most: a sentence wraps instead of widening the menu. */}
            <span id={hintId} aria-hidden="true" className="max-w-[240px] text-pretty text-secondary text-text-soft-400 group-focus:text-text-sub-600">{item.hint}</span>
          </span>
        ) : (
          <>
            {/* A plain label keeps its old box, so today's menus draw the same. */}
            <span className={item.content ? 'flex min-w-0 flex-1 items-center' : 'flex-1'}>{item.content ?? item.label}</span>
            {item.hint && (
              <span id={hintId} aria-hidden="true" className="shrink-0 text-secondary text-text-soft-400 group-focus:text-text-sub-600">{item.hint}</span>
            )}
          </>
        )}
        {/* Decorative: the item declares its key with aria-keyshortcuts. */}
        {plain?.shortcut && <Kbd aria-hidden="true">{plain.shortcut}</Kbd>}
        {choice && (
          // The check mark's own end slot, filled or empty, so labels
          // and hints don't shift when the choice changes.
          <span aria-hidden="true" className="flex size-3.5 shrink-0 items-center justify-center text-icon-sub-600">
            {choice.checked && <CheckIcon className="size-3.5" />}
          </span>
        )}
      </button>
    )
  }

  if (!presence.mounted) return null
  return (
    <Portal>
      <div
        {...presence.rootProps}
        ref={mergeRefs(floatingRef, presence.rootProps.ref)}
        role="menu"
        // Named by its own label, else by the heading that says what it acts on (A11Y-06).
        aria-label={aria['aria-label'] ?? heading}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        // C17: a right-click inside a portaled menu is still, in the React
        // tree, inside whatever rendered the trigger (a row, say) — without
        // this it bubbles through React and can open that ancestor's own
        // context menu over this one.
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        style={{
          left: pos?.x ?? 0,
          top: pos?.y ?? 0,
          visibility: pos ? 'visible' : 'hidden',
          // Grows from the corner at its trigger or the pointer (FEEL-15).
          transformOrigin: originFor(pos?.side, align),
        }}
        className={cn(
          // Owner feedback 5u, UI-19: the surface radius holds its items at
          // the control radius 4 px in (12 = 8 + 4), as Popover and Select.
          // Borderless (owner, 2026-10-01): the float shadow and, in dark, a
          // lit top edge; no ring (forced colors keep a system edge).
          // At least 154 px wide, its width before the 4 px grid (owner: nothing
          // grows past its old size), and at most 320: a long heading (an
          // address) is cut, never widens the menu across the window.
          'fixed z-(--layer-overlay) max-h-[calc(var(--viewport-h)-16px)] min-w-[154px] max-w-[320px] overflow-auto overscroll-contain rounded-surface bg-bg-popover p-[4px] shadow-(--shadow-float) focus-visible:outline-hidden forced-edge',
          'transition-[opacity,scale] duration-(--motion-fast) ease-out',
          'data-starting-style:opacity-0 data-starting-style:scale-(--motion-scale-in) data-[input=keyboard]:data-starting-style:scale-100',
          'data-ending-style:opacity-0 data-ending-style:duration-(--motion-exit-fast) data-ending-style:pointer-events-none',
        )}
      >
        {heading && (
          <div role="presentation" className={cn('px-[8px] py-[5px] text-secondary text-text-soft-400', headingTruncate === 'middle' ? 'flex' : 'truncate')}>
            {headingTruncate === 'middle' ? <MiddleCut text={heading} /> : heading}
          </div>
        )}
        {sections.map((s, k) =>
          s === 'separator' ? (
            <div key={`sep-${k}`} role="separator" className="my-[3px] h-px bg-stroke-soft-200" />
          ) : s.label ? (
            // A label names the items under it: a group, heard as such (A11Y-06).
            <div key={s.key} role="group" aria-labelledby={s.label.id}>
              {/* 22 px: its 22.75 before the 4 px grid, rounded down. */}
              <div id={s.label.id} className="px-[8px] pb-[2px] pt-[4px] text-secondary font-medium text-text-soft-400">
                {s.label.text}
              </div>
              {s.entries.map(renderItem)}
            </div>
          ) : (
            <Fragment key={s.key}>{s.entries.map(renderItem)}</Fragment>
          ),
        )}
      </div>
    </Portal>
  )
}
