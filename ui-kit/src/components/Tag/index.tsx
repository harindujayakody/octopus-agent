import { cn } from '@/lib/cn'
import { CloseIcon } from '@/lib/icons'
import { useLabels } from '@/lib/labels'

export type TagVariant = 'stroke' | 'gray'

export type TagProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: TagVariant
  leftIcon?: React.ReactNode
  /** Renders a trailing remove button and calls this on click. */
  onRemove?: () => void
  /** Accessible name of the remove button. Defaults to the kit's "remove" label. */
  removeLabel?: string
  disabled?: boolean
  children?: React.ReactNode
}

export default function Tag({
  variant = 'stroke',
  leftIcon,
  onRemove,
  removeLabel,
  disabled = false,
  children,
  className,
  ...rest
}: TagProps) {
  const labels = useLabels()
  return (
    <span
      className={cn(
        // 21 px, padding 7 and 5, gap 5: never larger than before the 4 px
        // grid (21, 7, 5.25; owner).
        'inline-flex h-[21px] items-center gap-[5px] rounded-chip pl-[7px] pr-[5px] text-secondary font-medium',
        variant === 'stroke'
          ? 'bg-bg-white-0 text-text-sub-600 ring-1 ring-inset ring-stroke-soft-200 forced-edge'
          : 'bg-bg-weak-50 text-text-sub-600',
        disabled && 'opacity-50',
        !onRemove && 'pr-[7px]',
        className,
      )}
      {...rest}
    >
      {leftIcon && <span className="flex size-3.5 [&>svg]:size-3.5 shrink-0 items-center justify-center text-text-soft-400">{leftIcon}</span>}
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={removeLabel ?? labels.remove}
          // PC-092: the 14 px mark keeps its look; the ::after makes it a
          // 24 px target (5 px out each side, to the chip's right edge).
          className="relative flex size-3.5 items-center justify-center rounded-chip-sm text-text-soft-400 focus-ring transition-hover hover:text-text-strong-950 after:absolute after:-inset-[5px] after:content-['']"
        >
          <CloseIcon className="size-3.5" />
        </button>
      )}
    </span>
  )
}
