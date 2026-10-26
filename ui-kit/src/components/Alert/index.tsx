import { cn } from '@/lib/cn'
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  InfoIcon,
} from '@/lib/icons'
import DismissButton from '@/components/DismissButton'
import { useLabels } from '@/lib/labels'

export type AlertStatus = 'information' | 'success' | 'warning' | 'error' | 'feature'
export type AlertVariant = 'filled' | 'light' | 'lighter' | 'stroke'

export type AlertProps = {
  status?: AlertStatus
  variant?: AlertVariant
  title?: React.ReactNode
  children?: React.ReactNode
  icon?: React.ReactNode
  /** A button (Undo, Retry) shown before the close button. */
  action?: React.ReactNode
  onClose?: () => void
  /** Accessible name of the dismiss button. Defaults to the kit's "dismiss" label. */
  dismissLabel?: string
  /** Its live role (A11Y-05): an error alerts, anything else is a polite
   *  status. `none` when an announcer elsewhere speaks for it. */
  role?: 'alert' | 'status' | 'none'
  className?: string
}

const statusIcon: Record<AlertStatus, React.ReactNode> = {
  information: <InfoIcon className="size-3.5" />,
  success: <CheckCircleIcon className="size-3.5" />,
  warning: <AlertTriangleIcon className="size-3.5" />,
  error: <AlertCircleIcon className="size-3.5" />,
  feature: <InfoIcon className="size-3.5" />,
}

// Tints are translucent state colors, so a tinted alert reads the same on any
// layer in both themes and keeps the theme's own text colors: no dark-mode
// overrides (COLOR-04). The icon is the state's text color (Phase A 5b: the
// base falls under 3:1 on some tints). A filled alert reads the Alert tokens:
// a solid state fill with white text and icon in light, the state's tint in
// dark (owner: no solid block in dark) with the theme's text and, as on every
// tinted surface, the icon in the state's text color. Text 4.5:1 or better.
// `npm run check:contrast` measures every pair.
const palette: Record<AlertStatus, { fill: string; fillIcon: string; tint: string; tintStrong: string; icon: string }> = {
  information: { fill: 'bg-information-alert', fillIcon: 'text-information-alert-icon', tint: 'bg-information-tint', tintStrong: 'bg-information-tint-hover', icon: 'text-information-text' },
  success: { fill: 'bg-success-alert', fillIcon: 'text-success-alert-icon', tint: 'bg-success-tint', tintStrong: 'bg-success-tint-hover', icon: 'text-success-text' },
  warning: { fill: 'bg-warning-alert', fillIcon: 'text-warning-alert-icon', tint: 'bg-warning-tint', tintStrong: 'bg-warning-tint-hover', icon: 'text-warning-text' },
  error: { fill: 'bg-error-alert', fillIcon: 'text-error-alert-icon', tint: 'bg-error-tint', tintStrong: 'bg-error-tint-hover', icon: 'text-error-text' },
  feature: { fill: 'bg-primary-alert', fillIcon: 'text-primary-alert-icon', tint: 'bg-primary-tint', tintStrong: 'bg-primary-tint-hover', icon: 'text-primary-text' },
}

export default function Alert({
  status = 'information',
  variant = 'lighter',
  title,
  children,
  icon,
  action,
  onClose,
  dismissLabel,
  role,
  className,
}: AlertProps) {
  const labels = useLabels()
  const p = palette[status]
  const filled = variant === 'filled'
  const container = filled
    ? cn(p.fill, 'text-on-alert')
    : variant === 'light'
      ? cn(p.tintStrong, 'text-text-strong-950')
      : variant === 'stroke'
        ? 'bg-bg-raised text-text-strong-950 ring-1 ring-inset ring-stroke-soft-200 shadow-[var(--shadow-xs)]'
        : cn(p.tint, 'text-text-strong-950')

  return (
    <div
      className={cn('flex w-full gap-[12px] rounded-surface p-[16px]', container, className)}
      role={role === 'none' ? undefined : role ?? (status === 'error' ? 'alert' : 'status')}
    >
      <span className={cn('mt-[5px] flex size-3.5 [&>svg]:size-3.5 shrink-0 items-center justify-center', filled ? p.fillIcon : p.icon)}>
        {icon ?? statusIcon[status]}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
        {title && <div className="text-section-title">{title}</div>}
        {/* A long path or id wraps anywhere instead of running out of the alert (WIG-07). */}
        {children && <div className={cn('min-w-0 break-words text-body [overflow-wrap:anywhere]', filled ? 'text-on-alert' : 'text-text-sub-600')}>{children}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center self-center">{action}</div>}
      {onClose && (
        // The one dismiss button. The sub icon holds 3:1 on every tint; a
        // filled alert draws it in its on-alert colors.
        <DismissButton onClick={onClose} label={dismissLabel ?? labels.dismiss} tone={filled ? 'onFill' : 'default'} />
      )}
    </div>
  )
}
