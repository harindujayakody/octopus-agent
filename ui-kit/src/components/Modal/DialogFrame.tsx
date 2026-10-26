import { useRef } from 'react'
import { cn } from '@/lib/cn'
import { Portal } from '@/lib/overlay/Portal'
import { useModal } from '@/lib/overlay/useModal'

export type DialogMotion = 'default' | 'quick'

export type DialogFrameProps = {
  open: boolean
  onClose: () => void
  panelRef: React.RefObject<HTMLDivElement | null>
  initialFocusRef?: React.RefObject<HTMLElement | null>
  exit?: 'animate' | 'instant'
  motion?: DialogMotion
  placement?: 'center' | 'top'
  role?: 'dialog' | 'alertdialog'
  'aria-labelledby'?: string
  'aria-label'?: string
  'aria-describedby'?: string
  /** The panel's look and width (radius, surface, border, shadow, max width). */
  panelClassName?: string
  children?: React.ReactNode
}

/**
 * What every dialog shares: a portal, a backdrop that fades by opacity with
 * the panel's duration and curve (ANIM-04), and the panel. The root is one
 * presence root: it enters on the first painted frame and, from the commit
 * that closes it, takes no pointer, focus or screen-reader presence (ANIM-01,
 * ANIM-03). Keyboard-opened dialogs fade only (ANIM-07); `quick` is the
 * palette's 100 ms in, 75 ms out, fade only (UI-23, FEEL-16).
 */
export function DialogFrame({
  open,
  onClose,
  panelRef,
  initialFocusRef,
  exit = 'animate',
  motion = 'default',
  placement = 'center',
  role = 'dialog',
  panelClassName,
  children,
  ...aria
}: DialogFrameProps) {
  const pressedBackdrop = useRef(false)
  const { mounted, rootProps, attrs, isTopmost } = useModal({ open, onClose, panelRef, initialFocusRef, exit })
  if (!mounted) return null
  const timing = motion === 'quick'
    ? 'duration-(--motion-fast) data-ending-style:duration-(--motion-exit-fast)'
    : 'duration-(--motion-slow) data-ending-style:duration-(--motion-base)'
  return (
    <Portal>
      <div
        {...rootProps}
        data-motion={motion}
        data-placement={placement}
        className={cn(
          'fixed inset-0 z-(--layer-overlay) flex justify-center p-[16px] data-ending-style:pointer-events-none',
          placement === 'top' ? 'items-start pt-[calc(var(--viewport-h)*0.12)]' : 'items-center',
        )}
      >
        <div
          aria-hidden="true"
          data-dialog-backdrop=""
          {...attrs}
          // Only a press that starts on the backdrop while this dialog is
          // topmost closes it; a press that closes a list or menu above it does not.
          onPointerDown={() => { pressedBackdrop.current = isTopmost() }}
          onClick={() => {
            if (pressedBackdrop.current) onClose()
            pressedBackdrop.current = false
          }}
          className={cn(
            'absolute inset-0 bg-[var(--backdrop)] transition-opacity ease-out',
            'data-starting-style:opacity-0 data-ending-style:opacity-0',
            timing,
          )}
        />
        <div
          ref={panelRef}
          role={role}
          aria-modal="true"
          tabIndex={-1}
          {...attrs}
          {...aria}
          className={cn(
            // Only on focus-visible, as Phase B had it: forced colors draw
            // `outline-hidden` as a 2 px ring, which must not sit on every panel.
            'relative flex flex-col focus-visible:outline-hidden transition-[opacity,scale] ease-out',
            timing,
            'data-starting-style:opacity-0 data-ending-style:opacity-0',
            motion === 'quick'
              ? null
              : 'data-starting-style:scale-(--motion-scale-in) data-[input=keyboard]:data-starting-style:scale-100',
            panelClassName,
          )}
        >
          {children}
        </div>
      </div>
    </Portal>
  )
}
