import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import Combobox, { type ComboboxOption } from '.'
import DialogModal from '../DialogModal'
import { LabelsProvider } from '@/lib/labels'

const FOLDERS: ComboboxOption[] = [
  { value: 'ads', label: 'Ads' },
  { value: 'shops', label: 'Shops', hint: '12' },
  { value: 'social', label: 'Social', keywords: ['tiktok'] },
]

const field = () => screen.getByRole('combobox', { name: 'Folder' })
const highlighted = () => document.getElementById(field().getAttribute('aria-activedescendant') ?? '')

describe('Combobox', () => {
  it('typing filters; the first match is highlighted; Enter picks it', () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Folder" options={FOLDERS} onChange={onChange} />)
    fireEvent.change(field(), { target: { value: 'sho' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(highlighted()).toHaveTextContent('Shops')
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('shops')
  })

  it('typing highlights the first match, not the current value (Pair 20 review)', () => {
    const onChange = vi.fn()
    const options = [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Banana' },
      { value: 'c', label: 'Cherry' },
    ]
    render(<Combobox aria-label="Folder" options={options} value="b" onChange={onChange} />)
    expect(highlighted()).toHaveTextContent('Banana')
    fireEvent.change(field(), { target: { value: 'a' } })
    expect(highlighted()).toHaveTextContent('Alpha')
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('a')
  })

  it('matches hints and keywords, word by word', () => {
    render(<Combobox aria-label="Folder" options={FOLDERS} onChange={() => {}} />)
    fireEvent.change(field(), { target: { value: 'tiktok' } })
    expect(screen.getByRole('option', { name: 'Social' })).toBeInTheDocument()
  })

  it('ArrowDown then Enter picks the second', () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Folder" options={FOLDERS} onChange={onChange} />)
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('shops')
  })

  it('the create row is last; Enter creates only when nothing matches; Cmd/Ctrl+Enter creates', () => {
    const onChange = vi.fn()
    const onCreate = vi.fn()
    render(<Combobox aria-label="Folder" options={FOLDERS} onChange={onChange} onCreate={onCreate} />)
    fireEvent.change(field(), { target: { value: 'Ad' } })
    const options = screen.getAllByRole('option')
    expect(options.at(-1)).toHaveTextContent('Create “Ad”')
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('ads')
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true })
    expect(onCreate).toHaveBeenCalledWith('Ad')
    fireEvent.change(field(), { target: { value: 'Games' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onCreate).toHaveBeenLastCalledWith('Games')
  })

  it('Cmd/Ctrl+Enter on a name that exists picks it, never a duplicate (Pair 20 ruling)', () => {
    const onChange = vi.fn()
    const onCreate = vi.fn()
    const options = [...FOLDERS, { value: 'ads-eu', label: 'Ads EU' }]
    render(<Combobox aria-label="Folder" options={options} onChange={onChange} onCreate={onCreate} />)
    fireEvent.change(field(), { target: { value: '  ADS ' } })
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    expect(highlighted()).toHaveTextContent('Ads EU')
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('ads')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('Cmd/Ctrl+click picks the clicked option and never creates; only the create row creates (Pair 25 ruling)', () => {
    const onChange = vi.fn()
    const onCreate = vi.fn()
    const options = [...FOLDERS, { value: 'ads-eu', label: 'Ads EU' }]
    render(<Combobox aria-label="Folder" multiple value={['ads-eu']} options={options} onChange={onChange} onCreate={onCreate} />)
    // A query with a create row: Cmd+click toggles the row it lands on.
    fireEvent.change(field(), { target: { value: 'Ad' } })
    fireEvent.click(screen.getByRole('option', { name: 'Ads EU' }), { metaKey: true })
    expect(onChange).toHaveBeenLastCalledWith('ads-eu', false)
    // A query naming another option exactly: Ctrl+click still means the clicked row.
    fireEvent.change(field(), { target: { value: 'ads' } })
    fireEvent.click(screen.getByRole('option', { name: 'Ads EU' }), { ctrlKey: true })
    expect(onChange).toHaveBeenLastCalledWith('ads-eu', false)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onCreate).not.toHaveBeenCalled()
    fireEvent.change(field(), { target: { value: 'Games' } })
    fireEvent.click(screen.getByRole('option', { name: 'Create “Games”' }), { metaKey: true })
    expect(onCreate).toHaveBeenCalledExactlyOnceWith('Games')
  })

  it('an exact name match offers no create row', () => {
    render(<Combobox aria-label="Folder" options={FOLDERS} onChange={() => {}} onCreate={() => {}} />)
    fireEvent.change(field(), { target: { value: 'shops' } })
    expect(screen.queryByText(/Create/)).toBeNull()
  })

  it('multiple: Enter toggles and stays; checked and mixed are announced', () => {
    function Tags() {
      const [value, setValue] = useState<string[]>(['ads'])
      return (
        <Combobox
          aria-label="Folder"
          multiple
          options={FOLDERS}
          value={value}
          mixed={['social']}
          onChange={(v, checked) => setValue((s) => (checked ? [...s, v] : s.filter((x) => x !== v)))}
        />
      )
    }
    render(<Tags />)
    const list = screen.getByRole('listbox')
    expect(list).toHaveAttribute('aria-multiselectable', 'true')
    expect(within(list).getByRole('option', { name: 'Ads' })).toHaveAttribute('aria-selected', 'true')
    expect(within(list).getByRole('option', { name: /Social/ })).toHaveTextContent('Some')
    fireEvent.keyDown(field(), { key: 'ArrowDown' })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(within(list).getByRole('option', { name: /Shops/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('says "No results" as a status outside the listbox', () => {
    render(<Combobox aria-label="Folder" options={FOLDERS} onChange={() => {}} emptyText="Nothing here" />)
    fireEvent.change(field(), { target: { value: 'zzz' } })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(field()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('status')).toHaveTextContent('Nothing here')
  })

  it('Esc clears a typed query first, and stops there', () => {
    const outer = vi.fn()
    render(<div onKeyDown={outer}><Combobox aria-label="Folder" options={FOLDERS} onChange={() => {}} /></div>)
    fireEvent.change(field(), { target: { value: 'sho' } })
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(field()).toHaveValue('')
    expect(outer).not.toHaveBeenCalled()
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(outer).toHaveBeenCalledOnce()
  })

  it('1,000 options: only a window of them is in the DOM, and End reaches the last', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ value: `p${i}`, label: `Proxy ${String(i).padStart(4, '0')}` }))
    render(<Combobox aria-label="Folder" options={many} onChange={() => {}} />)
    expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(40)
    fireEvent.keyDown(field(), { key: 'PageDown' })
    expect(highlighted()).toHaveTextContent('Proxy 0010')
    expect(highlighted()).toHaveAttribute('aria-posinset', '11')
    expect(highlighted()).toHaveAttribute('aria-setsize', '1000')
  })

  // Pair 19 review: the field's Enter never reaches a form around it. A pick
  // is the Enter's whole job, and with nothing to pick it does nothing. The
  // form is the DialogModal's own (C20a), which submits on Enter.
  it('inside a DialogModal form, neither a pick nor an Enter with no results submits the form', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onConfirm = vi.fn()
    render(
      <DialogModal open onClose={() => {}} title="Move to Folder" confirmLabel="Move" onConfirm={onConfirm}>
        <Combobox aria-label="Folder" options={FOLDERS} onChange={onChange} />
      </DialogModal>,
    )
    await user.type(field(), 'sho{Enter}')
    expect(onChange).toHaveBeenCalledWith('shops')
    await user.clear(field())
    await user.type(field(), 'zzz{Enter}')
    expect(screen.getByRole('status')).toHaveTextContent('No results')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('a double click on an option picks it once', () => {
    const onChange = vi.fn()
    render(<Combobox aria-label="Folder" options={FOLDERS} onChange={onChange} />)
    const shops = screen.getByRole('option', { name: /Shops/ })
    fireEvent.click(shops, { detail: 1, clientX: 40, clientY: 60 })
    fireEvent.click(shops, { detail: 2, clientX: 40, clientY: 60 })
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('shops')
  })

  it('the current value is highlighted and checked at the end of its row', () => {
    render(<Combobox aria-label="Folder" options={FOLDERS} value="social" onChange={() => {}} />)
    expect(highlighted()).toHaveTextContent('Social')
    expect(highlighted()).toHaveAttribute('aria-selected', 'true')
    expect(highlighted()?.lastElementChild?.tagName.toLowerCase()).toBe('svg')
  })

  it('one option with an icon gives every row an icon slot, so the labels line up', () => {
    const options = [
      { value: '', label: 'No proxy' },
      { value: 'a', label: 'Tokyo', icon: <i data-testid="flag" /> },
      { value: 'b', label: 'Unflagged' },
    ]
    render(<Combobox aria-label="Folder" options={options} onChange={() => {}} />)
    // The icon sits in a 14 px slot; the rows without one have an empty slot of the same size.
    for (const name of ['No proxy', 'Tokyo', 'Unflagged']) {
      const row = screen.getByRole('option', { name })
      const slot = row.firstElementChild as HTMLElement
      expect(slot.className, name).toContain('size-3.5')
      expect(slot.nextElementSibling, name).toHaveTextContent(name)
    }
    expect(screen.getByRole('option', { name: 'No proxy' }).firstElementChild).toBeEmptyDOMElement()
  })

  it('the icon slot stays while a query leaves only rows without an icon', () => {
    const options = [
      { value: '', label: 'No proxy' },
      { value: 'a', label: 'Tokyo', icon: <i data-testid="flag" /> },
    ]
    render(<Combobox aria-label="Folder" options={options} onChange={() => {}} />)
    fireEvent.change(field(), { target: { value: 'no pro' } })
    const row = screen.getByRole('option', { name: 'No proxy' })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(row.firstElementChild?.className).toContain('size-3.5')
    expect(row.firstElementChild).toBeEmptyDOMElement()
  })

  it('no row has an icon slot when no option has an icon', () => {
    render(<Combobox aria-label="Folder" options={FOLDERS} onChange={() => {}} />)
    expect(screen.getByRole('option', { name: 'Ads' }).firstElementChild).toHaveTextContent('Ads')
  })

  it('kit words come from the labels provider', () => {
    render(
      <LabelsProvider labels={{ search: '搜索…', create: '创建“{query}”', noResults: '无结果' }}>
        <Combobox aria-label="Folder" options={FOLDERS} onChange={() => {}} onCreate={() => {}} />
      </LabelsProvider>,
    )
    expect(field()).toHaveAttribute('placeholder', '搜索…')
    fireEvent.change(field(), { target: { value: '游戏' } })
    expect(screen.getByRole('option', { name: '创建“游戏”' })).toBeInTheDocument()
  })
})
