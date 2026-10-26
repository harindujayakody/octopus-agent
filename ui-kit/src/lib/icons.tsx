/**
 * Kit icon set — thin wrappers over @hugeicons/core-free-icons rendered via
 * <HugeiconsIcon>. Export names and the (SVGProps) signature are unchanged, so
 * every component keeps importing the same names; size/colour still come from
 * the parent via `className` (glyphs use currentColor).
 */
import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  Tick02Icon,
  MinusSignIcon,
  PlusSignIcon,
  Cancel01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Search01Icon,
  InformationCircleIcon,
  CheckmarkCircle02Icon,
  Alert02Icon,
  AlertCircleIcon as HugeAlertCircleIcon,
  Copy01Icon,
  Loading03Icon,
  Upload04Icon,
  MoreVerticalIcon as HugeMoreVerticalIcon,
} from '@hugeicons/core-free-icons'

type IconProps = Omit<React.ComponentProps<typeof HugeiconsIcon>, 'icon'>

/** One stroke for every icon, kit and app (UI-08): matched to the 500-weight labels. */
export const ICON_STROKE = 1.8

const icon = (glyph: IconSvgElement, name: string) => {
  // Decorative unless told otherwise: the control around it carries the name
  // (A11Y-21). A meaningful icon passes `role="img"` and an `aria-label`
  // (or `aria-hidden={false}`).
  const Icon = (props: IconProps) => (
    <HugeiconsIcon icon={glyph} strokeWidth={ICON_STROKE} aria-hidden={props.role ? undefined : 'true'} focusable="false" {...props} />
  )
  Icon.displayName = name
  return Icon
}

export const CheckIcon = icon(Tick02Icon, 'CheckIcon')
export const MinusIcon = icon(MinusSignIcon, 'MinusIcon')
export const PlusIcon = icon(PlusSignIcon, 'PlusIcon')
export const CloseIcon = icon(Cancel01Icon, 'CloseIcon')
export const ChevronDownIcon = icon(ArrowDown01Icon, 'ChevronDownIcon')
export const ChevronRightIcon = icon(ArrowRight01Icon, 'ChevronRightIcon')
export const SearchIcon = icon(Search01Icon, 'SearchIcon')
export const InfoIcon = icon(InformationCircleIcon, 'InfoIcon')
export const CheckCircleIcon = icon(CheckmarkCircle02Icon, 'CheckCircleIcon')
export const AlertTriangleIcon = icon(Alert02Icon, 'AlertTriangleIcon')
export const AlertCircleIcon = icon(HugeAlertCircleIcon, 'AlertCircleIcon')
export const CopyIcon = icon(Copy01Icon, 'CopyIcon')
export const SpinnerIcon = icon(Loading03Icon, 'SpinnerIcon')
export const UploadIcon = icon(Upload04Icon, 'UploadIcon')
export const MoreVerticalIcon = icon(HugeMoreVerticalIcon, 'MoreVerticalIcon')
