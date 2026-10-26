import { useRef } from 'react'
import { cn } from '@/lib/cn'
import { ICON_STROKE } from '@/lib/icons'
import { useLabels } from '@/lib/labels'
import Button, { type ButtonVariant } from '@/components/Button'
import Checkbox from '@/components/Checkbox'
import Modal from '@/components/Modal'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertCircleIcon,
  Alert02Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  AiMagicIcon,
} from '@hugeicons/core-free-icons'

export type AlertModalStatus =
  | 'feature'
  | 'information'
  | 'success'
  | 'warning'
  | 'error'

export type AlertModalProps = {
  open: boolean
  onClose?: () => void
  onOpenChange?: (open: boolean) => void
  status?: AlertModalStatus
  /** Override the default status icon. */
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  isLoading?: boolean

  /** Secondary/cancel action. Hidden when `hideCancel`. */
  cancelLabel?: string
  onCancel?: () => void
  hideCancel?: boolean

  /** Situational "Don’t show this again" checkbox. */
  showDontShowAgain?: boolean
  dontShowAgain?: boolean
  onDontShowAgainChange?: (checked: boolean) => void
  dontShowAgainLabel?: string

  className?: string

  /** Element to focus on open, instead of Cancel. */
  initialFocusRef?: React.RefObject<HTMLElement | null>
} & (
  /** The confirm names its action: no default words (WRITE-02). */
  | { onConfirm: () => void; confirmLabel: string; confirmVariant?: ButtonVariant }
  | { onConfirm?: undefined; confirmLabel?: undefined; confirmVariant?: undefined }
)

// Static class maps (no dynamic class names, so Tailwind sees them). The
// status color is on the icon only (UI-15's rule for every status surface).
const tone: Record<AlertModalStatus, string> = {
  feature: 'text-primary-text',
  information: 'text-information-base',
  success: 'text-success-base',
  warning: 'text-warning-base',
  error: 'text-error-base',
}

const statusIcon: Record<AlertModalStatus, React.ReactNode> = {
  feature: <HugeiconsIcon icon={AiMagicIcon} strokeWidth={ICON_STROKE} aria-hidden="true" />,
  information: <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={ICON_STROKE} aria-hidden="true" />,
  success: <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={ICON_STROKE} aria-hidden="true" />,
  warning: <HugeiconsIcon icon={Alert02Icon} strokeWidth={ICON_STROKE} aria-hidden="true" />,
  error: <HugeiconsIcon icon={AlertCircleIcon} strokeWidth={ICON_STROKE} aria-hidden="true" />,
}

/** A question in the one shell: `alertdialog`, first focus on Cancel (PC-003). */
export default function AlertModal({
  open, onClose, onOpenChange, status = 'feature', icon, title, description, onConfirm, confirmLabel, confirmVariant,
  isLoading = false, cancelLabel, onCancel, hideCancel = false, showDontShowAgain = false, dontShowAgain = false,
  onDontShowAgainChange, dontShowAgainLabel, className, initialFocusRef,
}: AlertModalProps) {
  const labels = useLabels()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const close = () => {
    onOpenChange?.(false)
    onClose?.()
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      onClose={onClose}
      role="alertdialog"
      size="sm"
      showClose={false}
      icon={<span className={cn('flex [&>svg]:size-3.5', tone[status])}>{icon ?? statusIcon[status]}</span>}
      title={title}
      description={description}
      initialFocusRef={initialFocusRef ?? (hideCancel ? undefined : cancelRef)}
      className={className}
      footer={
        <>
          {showDontShowAgain && (
            <Checkbox
              label={dontShowAgainLabel ?? labels.dontShowAgain}
              checked={dontShowAgain}
              onChange={(e) => onDontShowAgainChange?.(e.target.checked)}
              wrapperClassName="mr-auto"
            />
          )}
          {!hideCancel && (
            <Button ref={cancelRef} size="xsmall" mode="stroke" variant="neutral" onClick={onCancel ?? close}>
              {cancelLabel ?? labels.cancel}
            </Button>
          )}
          {onConfirm && (
            <Button size="xsmall" variant={confirmVariant ?? (status === 'error' ? 'error' : 'primary')} isLoading={isLoading} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          )}
        </>
      }
    />
  )
}
