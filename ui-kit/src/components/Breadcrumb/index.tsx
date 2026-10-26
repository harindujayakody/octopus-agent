import { Fragment } from 'react'
import { cn } from '@/lib/cn'
import { ChevronRightIcon } from '@/lib/icons'
import { Link } from '@/lib/link'
import { useLabels } from '@/lib/labels'

export type BreadcrumbItem = {
  label: string
  href?: string
  icon?: React.ReactNode
  onClick?: () => void
}

export type BreadcrumbProps = {
  items: BreadcrumbItem[]
  separator?: React.ReactNode
  className?: string
}

export default function Breadcrumb({ items, separator, className }: BreadcrumbProps) {
  const labels = useLabels()
  return (
    <nav aria-label={labels.breadcrumb} className={className}>
      <ol className="flex items-center gap-[6px]">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          const content = (
            <span
              className={cn(
                'inline-flex items-center gap-[4px] text-ui transition-hover',
                isLast ? 'text-text-strong-950' : 'text-text-sub-600 hover:text-text-strong-950',
              )}
            >
              {item.icon && <span className="flex size-3.5 [&>svg]:size-3.5 items-center justify-center">{item.icon}</span>}
              {item.label}
            </span>
          )
          return (
            <Fragment key={i}>
              <li>
                {isLast || (!item.href && !item.onClick) ? (
                  content
                ) : item.href ? (
                  <Link href={item.href} className="rounded-chip-sm focus-ring">{content}</Link>
                ) : (
                  <button type="button" onClick={item.onClick} className="rounded-chip-sm focus-ring">
                    {content}
                  </button>
                )}
              </li>
              {!isLast && (
                <li aria-hidden className="flex items-center text-text-soft-400">
                  {separator ?? <ChevronRightIcon className="size-3.5" />}
                </li>
              )}
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}
