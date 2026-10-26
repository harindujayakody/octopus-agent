import { useId } from 'react'
import { cn } from '@/lib/cn'
import Button, { type ButtonVariant } from '@/components/Button'
import Modal, { type ModalProps } from '@/components/Modal'
import { useRequestClose } from '@/components/Modal/closeRequest'
import { useLabels } from '@/lib/labels'

type Confirm =
  /** The confirm names its action ("Save", "Delete proxy"): no default words (WRITE-02). */
  | { onConfirm: () => void; confirmLabel: string; confirmVariant?: ButtonVariant }
  | { onConfirm?: undefined; confirmLabel?: undefined; confirmVariant?: undefined }

export type DialogModalProps = Omit<ModalProps, 'description' | 'role' | 'form'> & Confirm & {
  subtitle?: React.ReactNode
  hideFooter?: boolean
  isLoading?: boolean
  isDisabled?: boolean
  cancelLabel?: string
  onCancel?: () => void
  hideCancel?: boolean
  /** Words at the footer's start, before Cancel: why the confirm is
   *  disabled, or why the last try failed. Never a grey button alone. The
   *  confirm is described by it. It belongs to the default footer: a custom
   *  `footer` or `hideFooter` shows no note. */
  footerNote?: React.ReactNode
  /** The confirm button itself, for a dialog with no field that wants the
   *  keyboard on it at open (`initialFocusRef`): the kit's own footer builds
   *  the button, so there is no other way to name it. */
  confirmRef?: React.Ref<HTMLButtonElement>
}

/** A task in a dialog: the shell, a form (Enter submits, Cmd/Ctrl+Enter from
 *  a text area; EMIL-10), Cancel and a confirm that names its action. The
 *  body draws its own top and bottom (each call site's content pads it). */
export default function DialogModal({
  subtitle, footer, hideFooter = false, isLoading = false, isDisabled = false, cancelLabel, onCancel, hideCancel = false, footerNote, confirmRef,
  onConfirm, confirmLabel, confirmVariant = 'primary', bodyClassName, ...modal
}: DialogModalProps) {
  const labels = useLabels()
  const noteId = useId()
  // A disabled or busy confirm stops Enter too (PC-045): the submit button
  // is `aria-disabled` and cancels the implicit submit, and this guard
  // covers Cmd/Ctrl+Enter.
  const submit = () => {
    if (!isDisabled && !isLoading) onConfirm?.()
  }
  const defaultFooter = onConfirm != null || !hideCancel ? (
    <>
      {footerNote != null && <div id={noteId} className="mr-auto min-w-0 text-pretty text-help text-text-sub-600">{footerNote}</div>}
      {!hideCancel && (
        <CancelButton onCancel={onCancel}>{cancelLabel ?? labels.cancel}</CancelButton>
      )}
      {onConfirm && (
        <Button ref={confirmRef} type="submit" size="xsmall" variant={confirmVariant} disabled={isDisabled} isLoading={isLoading} aria-describedby={footerNote != null ? noteId : undefined}>{confirmLabel}</Button>
      )}
    </>
  ) : null
  return (
    <Modal
      {...modal}
      role={confirmVariant === 'error' ? 'alertdialog' : 'dialog'}
      description={subtitle}
      padded={false}
      bodyClassName={cn('px-inset-dialog', bodyClassName)}
      footer={hideFooter ? undefined : footer ?? defaultFooter}
      form={{
        // An Enter a field kept for itself (a Combobox pick, a Select) has
        // its default prevented and submits nothing.
        onSubmit: (e) => {
          const handled = e.defaultPrevented
          e.preventDefault()
          if (!handled) submit()
        },
        onKeyDown: (e) => {
          if (e.defaultPrevented || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.nativeEvent.isComposing) return
          if (!(e.target instanceof HTMLTextAreaElement)) return
          e.preventDefault()
          submit()
        },
      }}
    />
  )
}

/** Cancel closes the way the close button does: a dirty dialog asks
 *  Discard / Keep editing first, and `onCancel` (else the plain close) runs
 *  only once the close is agreed. */
function CancelButton({ onCancel, children }: { onCancel?: () => void; children: React.ReactNode }) {
  const requestClose = useRequestClose()
  return <Button size="xsmall" mode="stroke" variant="neutral" onClick={() => requestClose?.(onCancel)}>{children}</Button>
}
