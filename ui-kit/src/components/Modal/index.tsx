import { useId, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useLabels } from '@/lib/labels'
import { useLatched } from '@/lib/overlay/useLatched'
import Button from '@/components/Button'
import DismissButton from '@/components/DismissButton'
import { DialogFrame, type DialogMotion } from './DialogFrame'
import { RequestCloseContext } from './closeRequest'

export type DialogSize = 'sm' | 'md' | 'lg'
// 2 px under the round sizes: the panel lost its 1 px border (borderless,
// owner 2026-10-01), and its content keeps the width it had (never bigger).
const WIDTH: Record<DialogSize, string> = { sm: 'max-w-[398px]', md: 'max-w-[478px]', lg: 'max-w-[718px]' }

export type ModalProps = {
  open: boolean
  /** Called with false when the dialog asks to close: Esc, the backdrop, the close button. */
  onOpenChange?: (open: boolean) => void
  /** The same, in the older API; kept as an alias (EMIL-21). */
  onClose?: () => void
  title?: React.ReactNode
  /** Linked to the dialog by `aria-describedby`: read with the title on open. */
  description?: React.ReactNode
  /** A round icon before the title. */
  icon?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  /** sm 400, md 480 (default), lg 720: the width says what kind of task it is (LAYOUT-07). */
  size?: DialogSize
  /** @deprecated Use `size`. Only the command palette keeps a width of its own. */
  maxWidthClassName?: string
  showClose?: boolean
  /** Accessible name of the close button. Defaults to the kit's "close" label. */
  closeLabel?: string
  /** Element to focus on open, instead of the first focusable one. */
  initialFocusRef?: React.RefObject<HTMLElement | null>
  /** Names a dialog that has no `title` (its heading lives in the body). */
  'aria-label'?: string
  /** Centered (default), or near the top of the window (a command palette). */
  placement?: 'center' | 'top'
  /** False: the body draws its own padding (a list edge to edge). */
  padded?: boolean
  /** "instant": gone the moment it closes, with no fade (a palette whose command ran). */
  exit?: 'animate' | 'instant'
  /** 'quick': 100 ms in, 75 ms out, fade only (the palette and the shortcut sheet). */
  motion?: DialogMotion
  /** 'alertdialog' for a question about a destructive or irreversible action. */
  role?: 'dialog' | 'alertdialog'
  /** Unsaved input: Esc, the backdrop, the close button and a DialogModal's Cancel ask before it is thrown away (IFACE-08). */
  dirty?: boolean
  className?: string
  bodyClassName?: string
  /** A form around body and footer (DialogModal). */
  form?: Pick<React.FormHTMLAttributes<HTMLFormElement>, 'onSubmit' | 'onKeyDown'>
}

/** The one dialog shell (UI-13): raised surface, dialog radius, a hairline,
 *  a header (icon, title, description, close), a body and a footer. Every
 *  inset is its size before the 4 px grid (owner): 14 px sides for header,
 *  body and footer (the header's "14 px in"), so the title lines up with
 *  the body; 14 px above the header and around the footer's buttons. */
export default function Modal({
  open, onOpenChange, onClose, title, description, icon, children, footer, size = 'md', maxWidthClassName,
  showClose = true, closeLabel, initialFocusRef, 'aria-label': ariaLabel, placement = 'center', padded = true,
  exit = 'animate', motion = 'default', role = 'dialog', dirty = false, className, bodyClassName, form,
}: ModalProps) {
  const labels = useLabels()
  const panelRef = useRef<HTMLDivElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descId = useId()
  const [asking, setAsking] = useState(false)
  // What runs once Discard is chosen: the plain close, or a DialogModal's
  // own Cancel (`onCancel`), which asked through the same request.
  const thenRef = useRef<(() => void) | null>(null)
  const close = () => {
    onOpenChange?.(false)
    onClose?.()
  }
  const requestClose = (then?: () => void) => {
    const done = then ?? close
    if (!dirty) return done()
    thenRef.current = done
    setAsking(true)
  }
  const keepEditing = () => {
    thenRef.current = null
    setAsking(false)
  }
  const discard = () => {
    const done = thenRef.current ?? close
    thenRef.current = null
    setAsking(false)
    done()
  }

  // What it shows is held while it leaves: a save that ends with the close
  // does not flip a busy label back ("Adding…" to "Add 3") under the fade.
  const live = { title, description, icon, children, footer }
  const shown = useLatched(open ? live : null) ?? live

  const hasHeader = shown.title != null || shown.icon != null || showClose
  const content = (
    <>
      {shown.children != null && (
        <div className={cn('min-h-0 flex-1 overflow-auto overscroll-contain text-body text-text-sub-600', padded ? 'px-inset-dialog py-inset' : null, bodyClassName)}>
          {shown.children}
        </div>
      )}
      {/* No rule over the footer (borderless, owner 2026-10-01): under a
          body, whose own bottom padding parts them (a padded body's 16, a
          DialogModal body's own), it starts 2 px down; a question with no
          body (a confirm) keeps the bar's 14 under its words. */}
      {shown.footer != null && (
        <div className={cn('flex shrink-0 items-center justify-end gap-bar px-inset-dialog pb-inset-bar', shown.children != null ? 'pt-[2px]' : 'pt-inset-bar')}>
          {shown.footer}
        </div>
      )}
    </>
  )

  return (
    <>
      <DialogFrame
        open={open}
        onClose={() => requestClose()}
        panelRef={panelRef}
        initialFocusRef={initialFocusRef}
        exit={exit}
        motion={motion}
        placement={placement}
        role={role}
        aria-labelledby={shown.title != null ? titleId : undefined}
        aria-label={shown.title != null ? undefined : ariaLabel}
        aria-describedby={shown.description != null ? descId : undefined}
        // A raised surface: the shadow says it floats (Live layer: shadows
        // only on raised things); in dark a lit top edge keeps it off the
        // dimmed page (FEEL-14). No border (borderless, owner 2026-10-01);
        // forced colors keep a system edge.
        panelClassName={cn(
          // A white surface: a tile in it is the weak fill, its fields too.
          'w-full max-h-[calc(var(--viewport-h)-2rem)] overflow-hidden rounded-dialog bg-bg-raised shadow-(--shadow-float) forced-edge white-surface',
          maxWidthClassName ?? WIDTH[size],
          className,
        )}
      >
        <RequestCloseContext.Provider value={requestClose}>
          {hasHeader && (
            // One line: the icon, a one-line title and the close button share
            // its center (FEEL-28, UI-21). Under a description the close button
            // stays by the title.
            <div className={cn('flex shrink-0 items-center gap-inset-bar px-inset-dialog pt-inset-bar', shown.children == null && 'pb-inset-bar')}>
              {shown.icon != null && (
                // A fill, not a ring: one border fewer beside the fields (owner).
                <span aria-hidden="true" className="flex size-dialog-icon shrink-0 items-center justify-center rounded-full bg-bg-weak-50 text-icon-sub-600">
                  <span className="flex size-3.5 items-center justify-center [&>svg]:size-3.5">{shown.icon}</span>
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-caption">
                {shown.title != null && <h2 id={titleId} className="m-0 text-panel-title text-text-strong-950">{shown.title}</h2>}
                {shown.description != null && <p id={descId} className="m-0 text-pretty text-help text-text-sub-600">{shown.description}</p>}
              </div>
              {showClose && (
                // 15 px in from the panel's outer edge (its hairline and the
                // 14 px side inset), as the dialog close was.
                <DismissButton closesLayer onClick={() => requestClose()} label={closeLabel ?? labels.close} className={cn(shown.description != null && 'self-start')} />
              )}
            </div>
          )}
          {form ? <form noValidate className="flex min-h-0 flex-1 flex-col" {...form}>{content}</form> : content}
        </RequestCloseContext.Provider>
      </DialogFrame>
      {dirty && (
        <Modal
          open={asking}
          onOpenChange={(o) => { if (!o) keepEditing() }}
          role="alertdialog"
          size="sm"
          showClose={false}
          title={labels.discardTitle}
          description={labels.discardDescription}
          initialFocusRef={keepRef}
          footer={
            <>
              <Button variant="error" mode="stroke" size="xsmall" onClick={discard}>{labels.discard}</Button>
              <Button ref={keepRef} size="xsmall" onClick={keepEditing}>{labels.keepEditing}</Button>
            </>
          }
        />
      )}
    </>
  )
}
