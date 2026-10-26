import { forwardRef } from 'react'
import { cn } from '@/lib/cn'

export type CardLook = {
  /** `tile` (the default): a card inside a panel, the weak fill with no
   *  border and no shadow (borderless, owner 2026-10-01). `surface`: the
   *  framed white card, for one that stands on the gray ground. */
  variant?: 'tile' | 'surface'
  padding?: 'none' | 'sm' | 'md'
  /** The whole card is one control (a fingerprint): pointer, hover lift, focus ring. */
  interactive?: boolean
  /** The card the page is about (open in Peek). It keeps its own surface and
   *  colors; one ring, the focus ring's, says so (owner), never a stripe. */
  selected?: boolean
}

export type CardProps = React.HTMLAttributes<HTMLDivElement> & CardLook

// md: 18 px sides (17.5 before the 4 px grid, rounded up so the inner width
// never grows; owner), 16 top and bottom. sm: 12 px sides, 10 top and bottom,
// what the fingerprint card had (owner: nothing grows).
const paddings = { none: '', sm: 'px-cell py-[10px]', md: 'px-inset-side py-inset' }

/** An interactive surface card's lift, apart from its frame: the shadow
 *  steps up on hover and back down while pressed (the surface never takes
 *  the page's gray: owner feedback 5p); in dark, where a shadow does not
 *  read, the hover and active fills do; forced colors drop shadows and
 *  fills, so an outline marks hover there. Every framed card that answers
 *  the pointer takes it, framed by a border (`cardClass({ variant:
 *  'surface' })`) or a ring (the automation step choices), so a restyle
 *  reaches them all from here. A tile has no shadow: it steps its fill. */
export const cardLiftClass = cn(
  'transition-[border-color,background-color,box-shadow] duration-(--motion-base) ease-out',
  'hover:shadow-[var(--shadow-sm)] active:shadow-[var(--shadow-xs)]',
  'dark:hover:bg-bg-hover dark:active:bg-bg-active',
  'forced-colors:hover:outline forced-colors:focus-visible:outline-2',
)

/** The one card look (UI-14), as classes: every card, whatever its element,
 *  is dressed here, so a restyle happens in one place.
 *
 *  Tile (the default): the kit's `tile` at the tile radius: white on the
 *  gray ground with the softest shadow in light, the weak fill in dark.
 *  Interactive, it steps up on hover and while pressed: in light it stays
 *  white and its shadow lifts (never the ground's gray, owner feedback 5p),
 *  in dark its fill steps to the active fill; forced colors outline it on
 *  hover.
 *
 *  Surface: framed by a border, not an inset ring (a child with a
 *  background, a table header, would paint over a ring). Interactive, the
 *  border steps up on hover, with the lift (`cardLiftClass`).
 *
 *  Selected: the focus ring's own outline at rest (`selected-ring`), so a
 *  focused selected card still shows one ring, not two. */
export function cardClass({ variant = 'tile', padding = 'none', interactive = false, selected = false }: CardLook = {}): string {
  return cn(
    variant === 'tile' ? 'tile' : 'rounded-surface border border-stroke-soft-200 bg-bg-white-0 shadow-[var(--shadow-xs)]',
    interactive && cn(
      'cursor-pointer text-left focus-ring',
      variant === 'tile'
        ? 'transition-[background-color,box-shadow] duration-(--motion-base) ease-out hover:bg-[var(--bg-tile-hover)] active:bg-[var(--bg-tile-hover)] hover:shadow-[var(--shadow-tile-hover)] forced-colors:hover:outline forced-colors:focus-visible:outline-2'
        : cn('hover:border-stroke-sub-300', cardLiftClass),
    ),
    selected && 'selected-ring',
    paddings[padding],
  )
}

/** The one surface for grouped content: tables, settings sections, panels,
 *  and cards that open something (`interactive`). */
const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ variant = 'tile', padding = 'none', interactive = false, selected = false, className, ...rest }, ref) {
  return (
    <div
      ref={ref}
      data-selected={selected ? '' : undefined}
      className={cn(cardClass({ variant, padding, interactive, selected }), className)}
      {...rest}
    />
  )
})

export default Card
