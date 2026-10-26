import { cn } from '@/lib/cn'
import Button from '@/components/Button'

export type EmptyStateProps = {
  icon?: React.ReactNode
  title: React.ReactNode
  hint?: React.ReactNode
  /** A custom row of controls under the hint: a no-match state's Clear button.
   *  A first run's way in is `action`, so every page draws it the same. */
  actions?: React.ReactNode
  /** The page's main action, a filled primary button (a 14 px icon and the
   *  verb). Every first-run empty page draws it the same, in its list card. */
  action?: { label: React.ReactNode; icon?: React.ReactNode; onClick: () => void }
  /** A second, quieter way in: a stroke button after the primary one. */
  secondary?: { label: React.ReactNode; onClick: () => void }
  className?: string
  /** The title's heading level: 2 for a state that sits under a page title
   *  (the default), 3 inside a panel that has its own h2 (Peek). */
  headingLevel?: 2 | 3
  /** The icon tile: neutral by default (COLOR-10: a decoration is not an
   *  action); brand only where the state is the way in (a first run). */
  tone?: 'neutral' | 'brand'
}

export default function EmptyState({ icon, title, hint, actions, action, secondary, className, headingLevel = 2, tone = 'neutral' }: EmptyStateProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const hasControls = !!(action || secondary || actions)
  return (
    // Never larger than before the 4 px grid (owner): the tile 48 (was 49),
    // padding 49 and 21, gaps 8 and 7. Its icon is 21 (owner: empty screens
    // want a readable icon; size-6 at the 14 px root before Phase B).
    <div data-empty-state className={cn('flex flex-col items-center gap-[8px] px-[21px] py-[49px] text-center', className)}>
      {icon && (
        // COLOR-10: an icon tile is not an action, so it is neutral. No ring (owner feedback 5o).
        <div className={cn('grid size-12 place-items-center rounded-surface [&>svg]:size-[21px]', tone === 'brand' ? 'bg-primary-tint text-primary-text' : 'bg-bg-weak-50 text-icon-sub-600')}>
          {icon}
        </div>
      )}
      <Heading className="m-0 text-balance text-section-title text-text-strong-950">{title}</Heading>
      {hint && <p className="m-0 max-w-[420px] break-words text-balance text-body text-text-sub-600 [overflow-wrap:anywhere]">{hint}</p>}
      {hasControls && (
        <div className="mt-[7px] flex flex-wrap items-center justify-center gap-[7px]">
          {action && (
            <Button variant="primary" mode="filled" size="xsmall" data-empty-action leftIcon={action.icon} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {secondary && (
            <Button variant="neutral" mode="stroke" size="xsmall" data-empty-secondary onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
          {actions}
        </div>
      )}
    </div>
  )
}
