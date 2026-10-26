import { cn } from '@/lib/cn'
import { Link } from '@/lib/link'
import { ICON_STROKE } from '@/lib/icons'
import { fill, useLabels } from '@/lib/labels'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowLeftDoubleIcon,
  ArrowRightDoubleIcon,
} from '@hugeicons/core-free-icons'

export type PaginationProps = {
  /** Current page (1-based). Derive from your router, e.g. `Number(searchParams.get('page') ?? 1)`. */
  page: number
  totalPages: number
  onPageChange?: (page: number) => void
  /** Query-param name used in the generated hrefs. Default `'page'`. */
  paramName?: string
  /**
   * Base path to build hrefs on (e.g. `/proxies/residential`). When provided,
   * links are `${basePath}?page=N` (page 1 omits the param) instead of being
   * derived from the current URL. May include its own query string, which is
   * preserved. Ignored when `getPageHref` is set.
   */
  basePath?: string
  /**
   * Build the href for a page. Default: uses `basePath` if given, otherwise the
   * current URL; sets `?page=N` and REMOVES the param for page 1 (clean URL).
   */
  getPageHref?: (page: number) => string
  /** Render controls as links (default). Set false for pure state-driven SPA (buttons only). */
  asLinks?: boolean
  /** Pages shown on each side of the current page. Default 1. */
  siblingCount?: number
  /** Pages pinned at the start/end. Default 1. */
  boundaryCount?: number
  /** «/» arrows to first/last page. Default true. */
  showFirstLast?: boolean
  /** ‹/› arrows to prev/next page. Default true. */
  showPrevNext?: boolean
  /** "Page X of Y" text on the left. Default true. */
  showInfo?: boolean
  infoLabel?: (page: number, total: number) => React.ReactNode
  /** Cell shape. Default 'default' (the control radius, 8 px); 'full' → pills. */
  rounded?: 'default' | 'full'
  className?: string
}

const range = (start: number, end: number) =>
  Array.from({ length: Math.max(end - start + 1, 0) }, (_, i) => start + i)

type Item = number | 'ellipsis'

// MUI-style pagination range with boundary + sibling counts.
function getItems(page: number, total: number, siblingCount: number, boundaryCount: number): Item[] {
  const startPages = range(1, Math.min(boundaryCount, total))
  const endPages = range(Math.max(total - boundaryCount + 1, boundaryCount + 1), total)

  const siblingsStart = Math.max(
    Math.min(page - siblingCount, total - boundaryCount - siblingCount * 2 - 1),
    boundaryCount + 2,
  )
  const siblingsEnd = Math.min(
    Math.max(page + siblingCount, boundaryCount + siblingCount * 2 + 2),
    endPages.length > 0 ? endPages[0] - 2 : total - 1,
  )

  return [
    ...startPages,
    ...(siblingsStart > boundaryCount + 2
      ? (['ellipsis'] as Item[])
      : boundaryCount + 1 < total - boundaryCount
        ? [boundaryCount + 1]
        : []),
    ...range(siblingsStart, siblingsEnd),
    ...(siblingsEnd < total - boundaryCount - 1
      ? (['ellipsis'] as Item[])
      : total - boundaryCount > boundaryCount
        ? [total - boundaryCount]
        : []),
    ...endPages,
  ]
}

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  paramName = 'page',
  basePath,
  getPageHref,
  asLinks = true,
  siblingCount = 1,
  boundaryCount = 1,
  showFirstLast = true,
  showPrevNext = true,
  showInfo = true,
  infoLabel,
  rounded = 'default',
  className,
}: PaginationProps) {
  const labels = useLabels()
  const current = Math.min(Math.max(page, 1), Math.max(totalPages, 1))
  const items = getItems(current, totalPages, siblingCount, boundaryCount)
  const cellRadius = rounded === 'full' ? 'rounded-full' : 'rounded-control'

  const defaultHref = (p: number): string => {
    // basePath mode — build the URL from the provided path (+ its own query).
    if (basePath != null) {
      const hashIndex = basePath.indexOf('#')
      const hash = hashIndex >= 0 ? basePath.slice(hashIndex) : ''
      const withoutHash = hashIndex >= 0 ? basePath.slice(0, hashIndex) : basePath
      const [path, qs = ''] = withoutHash.split('?')
      const params = new URLSearchParams(qs)
      if (p <= 1) params.delete(paramName)
      else params.set(paramName, String(p))
      const search = params.toString()
      return `${path}${search ? `?${search}` : ''}${hash}`
    }
    if (typeof window === 'undefined') return '#'
    const url = new URL(window.location.href)
    if (p <= 1) url.searchParams.delete(paramName)
    else url.searchParams.set(paramName, String(p))
    return `${url.pathname}${url.search}${url.hash}`
  }
  const hrefFor = getPageHref ?? defaultHref

  const cellBase = cn(
    'flex size-8 shrink-0 items-center justify-center text-ui focus-ring transition-hover select-none',
    cellRadius,
  )

  // A page cell / arrow control — link (default) or button, with disabled + active states.
  function Control({
    targetPage,
    disabled,
    active,
    ariaLabel,
    children,
  }: {
    targetPage: number
    disabled?: boolean
    active?: boolean
    ariaLabel?: string
    children: React.ReactNode
  }) {
    const classes = cn(
      cellBase,
      disabled
        ? 'pointer-events-none text-text-disabled-300'
        : active
          ? 'bg-bg-active text-text-strong-950'
          : 'bg-bg-white-0 text-text-sub-600 ring-1 ring-inset ring-stroke-soft-200 hover:bg-bg-hover hover:text-text-strong-950',
    )
    const handleClick = (e: React.MouseEvent) => {
      if (disabled || active) {
        if (disabled) e.preventDefault()
        return
      }
      onPageChange?.(targetPage)
    }

    if (asLinks && !disabled) {
      return (
        <Link href={hrefFor(targetPage)} aria-label={ariaLabel} aria-current={active ? 'page' : undefined} className={classes} onClick={handleClick}>
          {children}
        </Link>
      )
    }
    return (
      <button type="button" disabled={disabled} aria-label={ariaLabel} aria-current={active ? 'page' : undefined} className={classes} onClick={handleClick}>
        {children}
      </button>
    )
  }

  // Arrow controls have no border by default (match Figma) — override cell ring.
  function Arrow({ targetPage, disabled, ariaLabel, children }: { targetPage: number; disabled?: boolean; ariaLabel: string; children: React.ReactNode }) {
    const classes = cn(
      cellBase,
      disabled
        ? 'pointer-events-none text-text-disabled-300'
        : 'text-text-sub-600 hover:bg-bg-hover hover:text-text-strong-950',
    )
    if (asLinks && !disabled) {
      return (
        <Link href={hrefFor(targetPage)} aria-label={ariaLabel} className={classes} onClick={() => onPageChange?.(targetPage)}>
          {children}
        </Link>
      )
    }
    return (
      <button type="button" disabled={disabled} aria-label={ariaLabel} className={classes} onClick={() => !disabled && onPageChange?.(targetPage)}>
        {children}
      </button>
    )
  }

  return (
    <nav aria-label={labels.pagination} className={cn('flex w-full items-center justify-between gap-[16px]', className)}>
      {showInfo ? (
        <div className="hidden w-[200px] shrink-0 text-body text-text-sub-600 sm:block">
          {infoLabel ? infoLabel(current, totalPages) : fill(labels.pageOf, { current, total: totalPages })}
        </div>
      ) : null}

      <div className="flex flex-1 items-center justify-center gap-[6px] sm:gap-[12px]">
        {showFirstLast && (
          <Arrow targetPage={1} disabled={current <= 1} ariaLabel={labels.firstPage}>
            <HugeiconsIcon icon={ArrowLeftDoubleIcon} strokeWidth={ICON_STROKE} className="size-3.5" />
          </Arrow>
        )}
        {showPrevNext && (
          <Arrow targetPage={current - 1} disabled={current <= 1} ariaLabel={labels.previousPage}>
            <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={ICON_STROKE} className="size-3.5" />
          </Arrow>
        )}

        {items.map((item, i) =>
          item === 'ellipsis' ? (
            <span key={`e${i}`} className={cn(cellBase, 'text-text-sub-600')} aria-hidden>
              …
            </span>
          ) : (
            <Control key={item} targetPage={item} active={item === current} ariaLabel={fill(labels.pageN, { page: item })}>
              {item}
            </Control>
          ),
        )}

        {showPrevNext && (
          <Arrow targetPage={current + 1} disabled={current >= totalPages} ariaLabel={labels.nextPage}>
            <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={ICON_STROKE} className="size-3.5" />
          </Arrow>
        )}
        {showFirstLast && (
          <Arrow targetPage={totalPages} disabled={current >= totalPages} ariaLabel={labels.lastPage}>
            <HugeiconsIcon icon={ArrowRightDoubleIcon} strokeWidth={ICON_STROKE} className="size-3.5" />
          </Arrow>
        )}
      </div>

      {showInfo ? <div className="hidden w-[200px] shrink-0 sm:block" aria-hidden /> : null}
    </nav>
  )
}
