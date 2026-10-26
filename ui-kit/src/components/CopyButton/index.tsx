import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useLabels } from '@/lib/labels'
import { CheckIcon, CopyIcon } from '@/lib/icons'
import Button, { type ButtonProps } from '@/components/Button'
import IconButton from '@/components/IconButton'
import IconSwap from '@/components/IconSwap'

export type CopyButtonProps = Omit<ButtonProps, 'children' | 'onClick' | 'leftIcon' | 'rightIcon' | 'onlyIcon' | 'aria-label'> & {
  /** Writes the value. Resolve when copied; reject (after reporting it) when not. */
  onCopy: () => Promise<void> | void
  /** The idle name (and tooltip, or words with `withText`). Default: the labels' "Copy". */
  label?: string
  /** Default: the labels' "Copied". */
  copiedLabel?: string
  /** A text button (label next to the icon), not only an icon with a tooltip. */
  withText?: boolean
}

/** How long "Copied" stays. */
const COPIED_MS = 1500

/** Copy, confirmed where the click was: the icon turns into a check and the
 *  label into "Copied" for 1.5 s, and a screen reader hears it (EMIL-18).
 *  Nothing is said when the copy failed: the caller reports that. */
export default function CopyButton({ onCopy, label, copiedLabel, withText = false, variant = 'neutral', mode = 'ghost', size = '2xsmall', ...rest }: CopyButtonProps) {
  const labels = useLabels()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await onCopy()
    } catch {
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_MS)
  }
  const idle = label ?? labels.copy
  const done = copiedLabel ?? labels.copied
  const icon = <IconSwap on={copied} onIcon={<CheckIcon className="size-3.5" />} offIcon={<CopyIcon className="size-3.5" />} />
  return (
    <>
      {withText ? (
        <Button {...rest} variant={variant} mode={mode} size={size} leftIcon={icon} onClick={() => void copy()}>
          {/* Both words hold the same cell, so the button keeps its width
              when one turns into the other; the hidden one is not in its name. */}
          <span className="inline-grid">
            <span aria-hidden={copied || undefined} className={cn('[grid-area:1/1]', copied && 'invisible')}>{idle}</span>
            <span aria-hidden={!copied || undefined} className={cn('[grid-area:1/1]', !copied && 'invisible')}>{done}</span>
          </span>
        </Button>
      ) : (
        <IconButton {...rest} variant={variant} mode={mode} size={size} icon={icon} label={copied ? done : idle} onClick={() => void copy()} />
      )}
      <span role="status" className="sr-only">{copied ? done : ''}</span>
    </>
  )
}
