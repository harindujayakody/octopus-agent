import { cn } from '@/lib/cn'

export type InputSize = 'medium' | 'small' | 'xsmall'

const FIELD_BOX: Record<InputSize, string> = {
  // Owner (Task 14 fix round): xsmall 30 and small 34, never larger than
  // before the 4 px grid (31.5 and 35); side padding and gap too.
  medium: 'h-10 px-[12px]',
  small: 'h-[34px] px-[10px]',
  xsmall: 'h-[30px] px-[8px]',
}
const WRAP_BOX: Record<InputSize, string> = {
  medium: 'min-h-10 px-[12px]',
  small: 'min-h-[34px] px-[10px]',
  xsmall: 'min-h-[30px] px-[8px]',
}

/** The frame around a text field, for the kit and for field-like app controls
 *  (a token input) that must look and focus the same (UI-34). `wrap` is a
 *  field whose content wraps onto more lines (a token list): the size's
 *  height is its minimum and it grows; the caller sets its vertical padding
 *  and gap. `focusSelf` is a field-like control that takes focus itself (a
 *  Select): it rings on :focus-visible, 2 px out, as a button does, so a
 *  pointer pick that hands focus back leaves no ring. The kit's `cn` does
 *  not merge classes, so a caller never overrides one of these with a class
 *  of the same property. */
export function inputFrameClass({
  size = 'medium',
  error = false,
  disabled = false,
  variant = 'field',
  density = 'default',
  wrap = false,
  focusSelf = false,
}: {
  size?: InputSize
  error?: boolean
  disabled?: boolean
  variant?: 'field' | 'bare'
  density?: 'default' | 'inline'
  wrap?: boolean
  focusSelf?: boolean
} = {}): string {
  const box = density === 'inline' ? 'h-7 gap-[6px] px-[6px]' : wrap ? WRAP_BOX[size] : cn(FIELD_BOX[size], 'gap-[7px]')
  if (variant === 'bare') {
    // forced-focus-within: in forced colors the frame, not the text box,
    // marks focus, inside the frame (the text box's own would cross the
    // edge of the panel that holds it).
    return cn('flex items-center bg-transparent text-text-strong-950 forced-focus-within', box, wrap && 'flex-wrap', disabled && 'pointer-events-none text-text-disabled-300')
  }
  if (density === 'inline') {
    // Shown only while it is being edited (focused), so its focus ring is
    // its one ring. Every other field's ring is 2 px and reaches 1 px past
    // the frame: a halo in a dense row. Here it is 1 px on the frame's own
    // edge (2 px under Increase contrast, 1 px past it, still inside a 36 px
    // row's 4 px above and below). focus-ring-within also hides the text
    // box's forced-colors outline, as on every field.
    return cn(
      'flex items-center overflow-hidden rounded-control bg-bg-white-0 text-text-strong-950 forced-edge',
      'focus-ring-within [--focus-width:1px] contrast-more:[--focus-width:2px]',
      box,
      error && 'ring-1 ring-inset ring-error-base [--focus-color:var(--error-base)]',
      disabled && 'pointer-events-none bg-bg-weak-50 text-text-disabled-300',
    )
  }
  // The field look (moved here from the wrapper div). Borderless (owner,
  // 2026-10-01): no ring at rest, the weak fill (one step up on a tile,
  // `control-fill`); the focus ring on focus, the error ring on error, and
  // its 1 px edge back under Increase contrast (the fill alone is 1.09:1 on
  // its panel; a person finds it by its label and placeholder too).
  return cn(
    'flex items-center overflow-hidden text-text-strong-950 forced-edge',
    'rounded-control control-fill',
    !error && 'contrast-more:ring-1 contrast-more:ring-inset contrast-more:ring-stroke-sub-300',
    box,
    wrap && 'flex-wrap',
    // Always, disabled too (a disabled field can't take focus): it also
    // hides the text box's outline-hidden, which forced colors paint.
    focusSelf ? 'focus-ring' : 'focus-ring-within',
    // Fix round 1 (M10): a field in the error state shows focus too, in
    // the error color.
    error && 'ring-1 ring-inset ring-error-base [--focus-color:var(--error-base)]',
    disabled && 'pointer-events-none text-text-disabled-300',
  )
}
