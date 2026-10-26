import type { ComboboxOption } from '.'

export function defaultFilter(option: ComboboxOption, query: string): boolean {
  const hay = [option.label, option.hint ?? '', ...(option.keywords ?? [])].join(' ').toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}
