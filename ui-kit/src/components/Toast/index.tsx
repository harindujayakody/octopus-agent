import { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useLabels } from '@/lib/labels'
import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon, InfoIcon, SpinnerIcon } from '@/lib/icons'
import CopyButton from '@/components/CopyButton'
import DismissButton from '@/components/DismissButton'
import ProgressBar from '@/components/ProgressBar'

export type ToastStatus = 'success' | 'error' | 'information' | 'warning' | 'progress'

export type ToastProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & {
  status: ToastStatus
  /** What happened, naming its subject. */
  title: React.ReactNode
  /** Why (a backend message): keeps its line breaks, wraps, clamps at four lines, selectable. */
  detail?: React.ReactNode
  progress?: { done: number; total: number }
  /** A button: Undo, Retry, Select failed. It sits before the dismiss button. */
  action?: React.ReactNode
  onDismiss?: () => void
  dismissLabel?: string
  /** Shown as "Copy details" when the detail is clamped; the button says "Copied" once this resolves, and says nothing when it rejects (report it there). */
  onCopyDetail?: () => Promise<void> | void
}

const ICON: Record<ToastStatus, React.ReactNode> = {
  success: <CheckCircleIcon />,
  error: <AlertCircleIcon />,
  information: <InfoIcon />,
  warning: <AlertTriangleIcon />,
  progress: <SpinnerIcon className="animate-spin" />,
}
// The state base holds 3:1 on the raised surface in both themes.
const TONE: Record<ToastStatus, string> = {
  success: 'text-success-base',
  error: 'text-error-base',
  information: 'text-information-base',
  warning: 'text-warning-base',
  progress: 'text-icon-sub-600',
}

/** A compact neutral raised surface; the status is the icon's color (UI-15).
 *  No live role of its own: the app's announcer speaks for it (A11Y-05).
 *
 *  Owner sizes: a 14 px icon, and nothing taller than the old toast. The
 *  icon, the title's first line, the action and the dismiss button share
 *  one 20 px line (the action and the 21 px dismiss button overflow it
 *  evenly), so a one-line toast with Undo stays one row. The detail, the
 *  progress bar and "Copy details" stack under the title. */
const Toast = forwardRef<HTMLDivElement, ToastProps>(function Toast(
  { status, title, detail, progress, action, onDismiss, dismissLabel, onCopyDetail, className, ...rest },
  ref,
) {
  const labels = useLabels()
  const detailRef = useRef<HTMLParagraphElement>(null)
  const [clamped, setClamped] = useState(false)
  useLayoutEffect(() => {
    const el = detailRef.current
    const measure = () => setClamped(!!el && el.scrollHeight > el.clientHeight + 1)
    measure()
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [detail])
  return (
    <div
      ref={ref}
      className={cn(
        'pointer-events-auto flex w-full gap-[10px] rounded-surface bg-bg-raised p-[12px] text-text-strong-950 shadow-(--shadow-float) forced-edge',
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className={cn('mt-[3px] flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5', TONE[status])}>
        {ICON[status]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
        <p className="m-0 min-w-0 select-text break-words text-ui [overflow-wrap:anywhere]">{title}</p>
        {detail != null && (
          // Keeps the detail's line breaks: a bulk result lists one failure a line.
          <p ref={detailRef} className="m-0 line-clamp-4 select-text whitespace-pre-line break-words text-secondary text-text-sub-600 [overflow-wrap:anywhere]">
            {detail}
          </p>
        )}
        {progress && (
          <ProgressBar
            className="mt-[4px]"
            value={progress.done}
            max={Math.max(1, progress.total)}
            aria-label={typeof title === 'string' ? title : undefined}
          />
        )}
        {clamped && onCopyDetail && (
          // Ghost, pulled left by its own padding (the button's 3 px and the
          // label's 3 px): its words line up with the detail above it.
          <CopyButton withText label={labels.copyDetails} className="-ml-[6px] self-start" onCopy={onCopyDetail} />
        )}
      </div>
      {(action || onDismiss) && (
        <div className="flex h-[20px] shrink-0 items-center gap-[8px]">
          {action}
          {onDismiss && <DismissButton onClick={onDismiss} label={dismissLabel ?? labels.dismiss} />}
        </div>
      )}
    </div>
  )
})

export default Toast
