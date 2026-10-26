import { useRef } from 'react'
import { cn } from '@/lib/cn'
import { mergeRefs } from '@/lib/mergeRefs'
import { Portal } from '@/lib/overlay/Portal'
import { usePresence } from '@/lib/overlay/usePresence'
import { useDismiss } from '@/lib/overlay/useDismiss'
import { useFocusTrap } from '@/lib/overlay/useFocusTrap'
import { originFor, useFloatingPosition, type Align, type Point, type Side } from '@/lib/overlay/position'

export type PopoverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The trigger. Presses on it never count as "outside". Give this or `anchorPoint`. */
  anchorRef?: React.RefObject<HTMLElement | null>
  /** A viewport point to open at, when there is no trigger element (a row's menu, a canvas): a pointer position, or a rect point through `layoutToPointer`. */
  anchorPoint?: Point
  /** With `anchorPoint`: the control that toggles the popover, so a press on it is not "outside". */
  triggerRef?: React.RefObject<HTMLElement | null>
  side?: Side
  align?: Align
  offset?: number
  initialFocusRef?: React.RefObject<HTMLElement | null>
  className?: string
  'aria-label'?: string
  children: React.ReactNode
}

/** Floating panel next to a trigger: filters, pickers, small forms. */
export default function Popover({
  open,
  onOpenChange,
  anchorRef,
  anchorPoint,
  triggerRef,
  side = 'bottom',
  align = 'start',
  offset = 6,
  initialFocusRef,
  className,
  children,
  ...aria
}: PopoverProps) {
  const floatingRef = useRef<HTMLDivElement>(null)
  const presence = usePresence(open, { group: 'overlay' })
  const pos = useFloatingPosition(anchorRef ?? anchorPoint ?? { x: 0, y: 0 }, floatingRef, { open: presence.mounted, side, align, offset })
  const inside = [floatingRef, anchorRef, triggerRef].filter((r): r is React.RefObject<HTMLElement | null> => !!r)
  useDismiss({ enabled: open, onDismiss: () => onOpenChange(false), refs: inside, layer: floatingRef })
  // Focus moves in only once the panel is positioned: a hidden element cannot take focus.
  // Popovers here are small forms (Filters, Display, pickers): Tab stays
  // inside; Esc and a press outside close and return focus (A11Y-06).
  useFocusTrap(floatingRef, open && presence.mounted && pos !== null, { initialFocusRef, restoreFocus: true, trapTab: true })

  if (!presence.mounted) return null
  return (
    <Portal>
      <div
        {...presence.rootProps}
        ref={mergeRefs(floatingRef, presence.rootProps.ref)}
        role="dialog"
        aria-label={aria['aria-label']}
        tabIndex={-1}
        style={{
          left: pos?.x ?? 0,
          top: pos?.y ?? 0,
          visibility: pos ? 'visible' : 'hidden',
          // Grows from the corner at its trigger or point (FEEL-15).
          transformOrigin: originFor(pos?.side, align),
        }}
        className={cn(
          // Owner feedback 5u: the surface radius (12 px), so a field (8 px)
          // 4 px inside it stays concentric.
          'fixed z-(--layer-overlay) max-h-[calc(var(--viewport-h)-16px)] overflow-auto overscroll-contain rounded-surface bg-bg-popover shadow-(--shadow-float) focus-visible:outline-hidden forced-edge white-surface',
          'transition-[opacity,scale] duration-(--motion-base) ease-out',
          'data-starting-style:opacity-0 data-starting-style:scale-(--motion-scale-in) data-[input=keyboard]:data-starting-style:scale-100',
          'data-ending-style:opacity-0 data-ending-style:duration-(--motion-fast) data-ending-style:pointer-events-none',
          className,
        )}
      >
        {children}
      </div>
    </Portal>
  )
}
