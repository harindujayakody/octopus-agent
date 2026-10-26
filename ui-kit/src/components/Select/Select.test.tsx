import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import Select, { type SelectOption } from '.'
import DialogModal from '../DialogModal'

const LANGS: SelectOption[] = [
  { label: 'English', value: 'en' },
  { label: 'Deutsch', value: 'de', disabled: true },
  { label: 'Español', value: 'es' },
  { label: '中文', value: 'zh' },
]

function Harness({ onChange = () => {}, ...rest }: { onChange?: (v: string) => void } & Partial<React.ComponentProps<typeof Select>>) {
  const [value, setValue] = useState('en')
  return (
    <>
      <Select label="Interface language" options={LANGS} value={value} onChange={(v) => { setValue(v); onChange(v) }} {...rest} />
      <button>next field</button>
    </>
  )
}
const trigger = () => screen.getByRole('combobox', { name: 'Interface language' })
const active = () => document.getElementById(trigger().getAttribute('aria-activedescendant') ?? '')

describe('Select', () => {
  it('is a combobox named by its label, showing its value', () => {
    render(<Harness />)
    expect(trigger()).toHaveTextContent('English')
    expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('ArrowDown opens on the current value; ArrowDown then Enter changes it; focus never leaves', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    trigger().focus()
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    expect(active()).toHaveTextContent('English')
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    expect(active()).toHaveTextContent('Español') // Deutsch is disabled
    fireEvent.keyDown(trigger(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('es')
    expect(trigger()).toHaveTextContent('Español')
    expect(trigger()).toHaveFocus()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('inside a disabled fieldset it is off, as a native select would be', () => {
    const onChange = vi.fn()
    render(<fieldset disabled><Harness onChange={onChange} /></fieldset>)
    expect(trigger()).toHaveAttribute('aria-disabled', 'true')
    expect(trigger()).not.toHaveAttribute('tabindex')
    fireEvent.click(trigger())
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('typing a letter while closed opens on the match', async () => {
    render(<Harness />)
    trigger().focus()
    fireEvent.keyDown(trigger(), { key: 'e' })
    await screen.findByRole('listbox')
    expect(active()).toHaveTextContent('Español')
  })

  it('Tab closes the list and changes nothing', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    trigger().focus()
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    await screen.findByRole('listbox')
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    fireEvent.keyDown(trigger(), { key: 'Tab' })
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(onChange).not.toHaveBeenCalled()
  })

  // C16 reset: a list closed on a moved highlight opens on the value again.
  it('reopens on the current value, whatever was highlighted when it closed', async () => {
    render(<Harness />)
    trigger().focus()
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    await screen.findByRole('listbox')
    fireEvent.keyDown(trigger(), { key: 'End' })
    expect(active()).toHaveTextContent('中文')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    await screen.findByRole('listbox')
    expect(active()).toHaveTextContent('English')
  })

  it('a mouse pick puts focus back on the field', async () => {
    render(<Harness />)
    fireEvent.click(trigger())
    fireEvent.click(await screen.findByRole('option', { name: '中文' }))
    expect(trigger()).toHaveTextContent('中文')
    await waitFor(() => expect(trigger()).toHaveFocus())
  })

  it('a double click on an option picks it once', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(trigger())
    const zh = await screen.findByRole('option', { name: '中文' })
    fireEvent.click(zh, { detail: 1, clientX: 40, clientY: 60 })
    fireEvent.click(zh, { detail: 2, clientX: 40, clientY: 60 })
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('searchable: focus moves into the search; Enter picks the first match; Esc closes and returns focus', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} isSearchable searchPlaceholder="Search languages" />)
    expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog')
    trigger().focus()
    fireEvent.keyDown(trigger(), { key: 'Enter' })
    const search = await screen.findByRole('combobox', { name: 'Search languages' })
    await waitFor(() => expect(search).toHaveFocus())
    fireEvent.change(search, { target: { value: 'esp' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('es')
    await waitFor(() => expect(trigger()).toHaveFocus())

    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    const again = await screen.findByRole('combobox', { name: 'Search languages' })
    await waitFor(() => expect(again).toHaveFocus())
    fireEvent.keyDown(again, { key: 'Escape' })
    await waitFor(() => expect(trigger()).toHaveFocus())
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('inside a dialog, Tab with the list open closes the list and keeps the dialog', async () => {
    render(
      <DialogModal open onClose={() => {}} title="Proxy">
        <Select label="Interface language" options={LANGS} value="en" onChange={() => {}} />
      </DialogModal>,
    )
    trigger().focus()
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    await screen.findByRole('listbox')
    fireEvent.keyDown(trigger(), { key: 'Tab' })
    // Tab keeps the short fade (as the Menu does); the list is gone after it.
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Proxy' })).toBeInTheDocument()
  })

  it('1,000 options open with only a window of them in the DOM', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ label: `Proxy ${i}`, value: `p${i}` }))
    render(<Select aria-label="Proxy" options={many} value="p500" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Proxy' }))
    await screen.findByRole('listbox')
    expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(40)
  })

  it('shows an option hint in the list and on the field', async () => {
    render(<Select aria-label="Proxy" options={[{ label: 'DC Tokyo', value: 't', hint: '103.152.11.90:1080' }]} value="t" onChange={() => {}} />)
    const field = screen.getByRole('combobox', { name: 'Proxy' })
    expect(field).toHaveTextContent('103.152.11.90:1080')
    fireEvent.click(field)
    expect(await screen.findByRole('option', { name: /DC Tokyo/ })).toHaveTextContent('103.152.11.90:1080')
  })

  it('an error marks it invalid and describes it', () => {
    render(<Harness error="Pick a language" />)
    expect(trigger()).toHaveAttribute('aria-invalid', 'true')
    expect(trigger()).toHaveAccessibleDescription('Pick a language')
  })

  it('can be named without a visible label', () => {
    render(<Select aria-label="HTTP method" value="GET" options={[{ label: 'GET', value: 'GET' }, { label: 'POST', value: 'POST' }]} />)
    expect(screen.getByRole('combobox', { name: 'HTTP method' })).toBeInTheDocument()
  })

  it('says there are no matches in the caller\'s words', async () => {
    render(<Select aria-label="Proxy" isSearchable noResultsText="没有匹配的代理。" value="a" options={[{ label: 'Alpha', value: 'a' }]} />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Proxy' }))
    const search = await screen.findByRole('combobox', { name: /Search/ })
    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(screen.getByText('没有匹配的代理。')).toBeInTheDocument()
  })

  // Fix round 1 (I1), kept through the rebuild: an option can render a full
  // custom look (a tinted chip); `label` stays the text search matches.
  it('an option\'s `content` renders in the row, and in the field once picked; search still matches `label`', async () => {
    render(
      <Select
        aria-label="Tag"
        isSearchable
        value="warm"
        onChange={() => {}}
        options={[
          { label: 'Warm-up', value: 'warm', content: <span data-testid="chip-warm">Warm-up chip</span> },
          { label: 'VIP', value: 'vip', content: <span data-testid="chip-vip">VIP chip</span> },
        ]}
      />,
    )
    const field = screen.getByRole('combobox', { name: 'Tag' })
    expect(within(field).getByTestId('chip-warm')).toBeInTheDocument()
    fireEvent.click(field)
    const list = await screen.findByRole('listbox')
    expect(within(list).getByTestId('chip-vip')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: /Search/ }), { target: { value: 'vip' } })
    expect(within(screen.getByRole('listbox')).getByTestId('chip-vip')).toBeInTheDocument()
    expect(within(screen.getByRole('listbox')).queryByTestId('chip-warm')).toBeNull()
  })

  // Fix round 1 (I2), kept: a disabled option picks nothing, and keeps its
  // pointer events so the not-allowed cursor shows.
  it('a disabled option cannot be picked, and keeps pointer events', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.click(trigger())
    const deutsch = await screen.findByRole('option', { name: 'Deutsch' })
    expect(deutsch).toHaveAttribute('aria-disabled', 'true')
    expect(deutsch.className).not.toContain('pointer-events-none')
    fireEvent.click(deutsch)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a disabled Select neither opens nor takes focus', () => {
    render(<Harness disabled />)
    expect(trigger()).toHaveAttribute('aria-disabled', 'true')
    expect(trigger()).not.toHaveAttribute('tabindex')
    fireEvent.click(trigger())
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })
  it('a badge is whole in the row and in the field; the list may grow past its field, up to 360 px', async () => {
    const opts: SelectOption[] = [
      { label: 'ip-api.com (HTTP, 45 requests/min)', value: 'a', badge: { label: 'Not encrypted', color: 'warning' } },
      { label: 'ipapi.co (HTTPS, 1,000/day)', value: 'b' },
    ]
    render(<Select label="Geo checker" options={opts} value="a" />)
    const field = screen.getByRole('combobox', { name: 'Geo checker' })
    expect(within(field).getByText('Not encrypted').className).toContain('shrink-0')
    fireEvent.click(field)
    const row = await screen.findByRole('option', { name: /ip-api/ })
    expect(within(row).getByText('Not encrypted').className).toContain('shrink-0')
    const popup = screen.getByRole('listbox').parentElement!
    expect(popup.style.width).toBe('max-content')
    expect(popup.style.maxWidth).toBe('360px')
  })
})
