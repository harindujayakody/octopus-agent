import { cn } from '@/lib/cn'

/** `label` (default) names one control through htmlFor; `span` or `div` names a group through aria-labelledby, so htmlFor is a type error there. */
export type LabelProps = React.HTMLAttributes<HTMLElement> &
  ({ as?: 'label'; htmlFor?: string } | { as: 'span' | 'div'; htmlFor?: never })

/** A field's label: 12/16 medium in the secondary color (ruling 4), so it never reads as a section title. */
export default function Label({ as: Tag = 'label', htmlFor, className, ...rest }: LabelProps) {
  return <Tag className={cn('text-field-label text-text-sub-600', className)} {...(Tag === 'label' ? { htmlFor } : {})} {...rest} />
}
