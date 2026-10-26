import { createContext, useContext, useMemo } from 'react'

/** Every string the kit shows or speaks by default. The dashboard gets the
 *  English below; the launcher passes its translations once (WRITE-03).
 *  An explicit prop on a component always wins. */
export type KitLabels = {
  close: string
  dismiss: string
  cancel: string
  remove: string
  /** A Select with nothing chosen. */
  select: string
  search: string
  noResults: string
  /** The create row at the end of a Combobox; `{query}` is what was typed. */
  create: string
  /** An option only some of the chosen items have (Tags on several profiles). */
  mixed: string
  breadcrumb: string
  pagination: string
  firstPage: string
  previousPage: string
  nextPage: string
  lastPage: string
  /** `{current}` and `{total}`. */
  pageOf: string
  /** A numbered page button; `{page}`. */
  pageN: string
  dontShowAgain: string
  keepEditing: string
  discard: string
  discardTitle: string
  discardDescription: string
  copy: string
  copied: string
  copyDetails: string
  /** Toasts waiting behind the visible ones; `{n}`. */
  moreToasts: string
}

export const DEFAULT_LABELS: KitLabels = {
  close: 'Close',
  dismiss: 'Dismiss',
  cancel: 'Cancel',
  remove: 'Remove',
  select: 'Select…',
  search: 'Search…',
  noResults: 'No results',
  create: 'Create “{query}”',
  mixed: 'Some',
  breadcrumb: 'Breadcrumb',
  pagination: 'Pagination',
  firstPage: 'First page',
  previousPage: 'Previous page',
  nextPage: 'Next page',
  lastPage: 'Last page',
  pageOf: 'Page {current} of {total}',
  pageN: 'Page {page}',
  dontShowAgain: 'Don’t show this again',
  keepEditing: 'Keep editing',
  discard: 'Discard',
  discardTitle: 'Discard your changes?',
  discardDescription: 'What you entered here will be lost.',
  copy: 'Copy',
  copied: 'Copied',
  copyDetails: 'Copy details',
  moreToasts: '{n} more',
}

const LabelsContext = createContext<KitLabels>(DEFAULT_LABELS)

/** Drops explicit `undefined` entries so they cannot blank an inherited label. */
function definedLabels(labels: Partial<KitLabels>): Partial<KitLabels> {
  const out: Partial<KitLabels> = {}
  for (const key of Object.keys(labels) as (keyof KitLabels)[]) {
    const v = labels[key]
    if (v !== undefined) out[key] = v
  }
  return out
}

export function LabelsProvider({ labels, children }: { labels: Partial<KitLabels>; children: React.ReactNode }) {
  const parent = useContext(LabelsContext)
  const value = useMemo(() => ({ ...parent, ...definedLabels(labels) }), [parent, labels])
  return <LabelsContext.Provider value={value}>{children}</LabelsContext.Provider>
}

export const useLabels = (): KitLabels => useContext(LabelsContext)

/** Fills `{name}` placeholders in a label. */
export function fill(label: string, vars: Record<string, string | number>): string {
  return label.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}
