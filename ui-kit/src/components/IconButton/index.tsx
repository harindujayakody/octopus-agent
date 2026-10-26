import { forwardRef } from 'react'
import Button, { type ButtonProps } from '@/components/Button'
import Tooltip from '@/components/Tooltip'
import type { Side } from '@/lib/overlay/position'

export type IconButtonProps = Omit<ButtonProps, 'children' | 'onlyIcon' | 'leftIcon' | 'rightIcon' | 'aria-label'> & {
  icon: React.ReactNode
  /** Accessible name and tooltip text. Required: an icon alone names nothing. */
  label: string
  tooltipSide?: Side
  /** A key that does the same, shown in the tooltip and declared on the button. */
  shortcut?: string
  tooltipDelay?: number
  /** false for buttons repeated down a list (no warm-up). */
  tooltipWarm?: boolean
}

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, tooltipSide = 'top', shortcut, tooltipDelay, tooltipWarm, variant = 'neutral', mode = 'ghost', size = 'xsmall', ...rest },
  ref,
) {
  return (
    <Tooltip content={label} side={tooltipSide} shortcut={shortcut} delay={tooltipDelay} warm={tooltipWarm}>
      <Button ref={ref} {...rest} variant={variant} mode={mode} size={size} onlyIcon leftIcon={icon} aria-label={label} />
    </Tooltip>
  )
})

export default IconButton
