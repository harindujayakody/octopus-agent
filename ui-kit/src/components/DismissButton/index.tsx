import { cn } from '@/lib/cn'
import Tooltip from '@/components/Tooltip'
import { CloseIcon } from '@/lib/icons'
import { useLabels } from '@/lib/labels'

export type DismissButtonProps = {
  onClick: () => void
  /** Defaults to the kit's "close" label. */
  label?: string
  /** 'onFill': on a filled Alert's solid state color, in its on-alert colors. */
  tone?: 'default' | 'onFill'
  /** A key that does the same ("Esc"), in the tooltip and declared on the button. */
  shortcut?: string
  /** It closes the layer it sits in (a dialog): Esc closes that layer at
   *  once, and its tooltip with it. The tooltip only repeats the button's
   *  name, so it does not take an Esc of its own (MP4 review, M12). */
  closesLayer?: boolean
  className?: string
}

/** The one close or dismiss button: dialogs, toasts, alerts (FEEL-24, UI-32).
 *  Owner (WCAG 2.5.8): it draws at 21 px, its size before the 4 px grid,
 *  with an invisible 24 px hit area (the ::before, 1.5 px out each side),
 *  a 14 px icon, the kit focus ring and a tooltip. It never scales on
 *  press. The resting icon is the sub icon: 3:1 on every surface and state
 *  tint. */
export default function DismissButton({ onClick, label, tone = 'default', shortcut, closesLayer = false, className }: DismissButtonProps) {
  const labels = useLabels()
  const name = label ?? labels.close
  return (
    <Tooltip content={name} shortcut={shortcut} passEscape={closesLayer}>
      <button
        type="button"
        onClick={onClick}
        aria-label={name}
        // A dialog focuses its first field, not its close button.
        data-autofocus-skip=""
        className={cn(
          'relative flex size-[21px] shrink-0 items-center justify-center rounded-control focus-ring transition-hover',
          "before:absolute before:-inset-[1.5px] before:content-['']",
          tone === 'onFill'
            ? 'text-on-alert-soft hover:text-on-alert'
            : 'text-icon-sub-600 hover:bg-bg-hover hover:text-text-strong-950 active:bg-bg-active',
          className,
        )}
      >
        <CloseIcon className="size-3.5" />
      </button>
    </Tooltip>
  )
}
